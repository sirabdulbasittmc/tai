import prisma from '../db/prisma';
import crypto from 'crypto';

/**
 * ArtifactService — manages general + user artifact templates.
 *
 * Flow:
 * 1. User prompt → match against general_artifacts.match_intents
 * 2. If matched → check user_artifacts for user's copy
 *    a. user_artifacts exists + data_hash valid → serve cached (instant)
 *    b. user_artifacts exists + data_hash stale → regenerate data JSON only
 *    c. user_artifacts missing → copy template from general, generate data, save
 * 3. If no general match → AI generates widget normally → save to user_artifacts
 *    AND save to general_artifacts as new template (auto-discovery)
 */

interface GeneralArtifact {
  id: number;
  artifact_key: string;
  title: string;
  description: string;
  match_intents: string;
  html_template: string;
  data_schema: string;
  version: number;
}

interface UserArtifact {
  id: number;
  client_number: string;
  user_id: number;
  artifact_key: string;
  source_general_id: number | null;
  title: string;
  html_content: string;
  data_json: string | null;
  data_hash: string | null;
  customizations: string | null;
  use_count: number;
}

// ─── Match user query against general artifacts ───────────────

export async function findMatchingArtifact(query: string): Promise<GeneralArtifact | null> {
  const artifacts: GeneralArtifact[] = await prisma.$queryRawUnsafe(
    'SELECT * FROM general_artifacts WHERE is_active = true'
  );

  const queryLower = query.toLowerCase();
  // Skip generic words that cause false positives
  const STOP_WORDS = new Set(['show','give','provide','list','tell','what','how','many','all','the','for','with','have','from','about','into','your','this','that','does','where','which']);
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));

  // If no meaningful words remain after stop-word removal, no match
  if (queryWords.length === 0) return null;

  let bestMatch: GeneralArtifact | null = null;
  let bestScore = 0;

  for (const art of artifacts) {
    const keywords = art.match_intents.split(',').map(k => k.trim().toLowerCase());
    let score = 0;

    for (const keyword of keywords) {
      // Exact phrase match (strongest signal)
      if (queryLower.includes(keyword)) {
        score += keyword.length * 2;
        continue;
      }

      // Word-level overlap: require at least 50% of keyword words to match
      const kwWords = keyword.split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w));
      if (kwWords.length === 0) continue;
      const matchedWords = kwWords.filter(w => queryWords.some(qw => qw === w || (qw.length > 4 && (qw.includes(w) || w.includes(qw)))));
      const matchRatio = matchedWords.length / kwWords.length;
      if (matchRatio >= 0.5 && matchedWords.length >= 1) {
        score += matchedWords.length * 6;
      }
    }

    // Artifact key match (e.g., "project_dashboard" words match query)
    const keyWords = art.artifact_key.split('_').filter(w => w.length > 2);
    const keyMatch = keyWords.filter(w => queryWords.some(qw => qw === w || (qw.length > 4 && (qw.includes(w) || w.includes(qw)))));
    if (keyMatch.length >= 1) {
      score += keyMatch.length * 8;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = art;
    }
  }

  // Higher threshold — need strong signal to trigger artifact path
  return bestScore >= 12 ? bestMatch : null;
}

// ─── Get user's artifact (or create from general) ─────────────

export async function getUserArtifact(
  userId: number,
  clientNumber: string,
  artifactKey: string
): Promise<UserArtifact | null> {
  const rows: UserArtifact[] = await prisma.$queryRawUnsafe(
    'SELECT * FROM user_artifacts WHERE user_id = $1 AND artifact_key = $2',
    userId, artifactKey
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── Save user artifact ───────────────────────────────────────

export async function saveUserArtifact(
  userId: number,
  clientNumber: string,
  artifactKey: string,
  title: string,
  htmlContent: string,
  dataJson: string | null,
  dataHash: string | null,
  sourceGeneralId: number | null
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    INSERT INTO user_artifacts (client_number, user_id, artifact_key, source_general_id, title, html_content, data_json, data_hash, use_count)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
    ON CONFLICT (user_id, artifact_key) DO UPDATE SET
      html_content = $6, data_json = $7, data_hash = $8,
      use_count = user_artifacts.use_count + 1, updated_at = NOW()
  `, clientNumber, userId, artifactKey, sourceGeneralId, title, htmlContent, dataJson, dataHash);
}

// ─── Update user artifact with new widget (from AI regeneration) ──

export async function updateUserArtifactHtml(
  userId: number,
  artifactKey: string,
  htmlContent: string,
  dataJson: string | null,
  dataHash: string | null
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE user_artifacts SET html_content = $1, data_json = $2, data_hash = $3,
    use_count = use_count + 1, updated_at = NOW()
    WHERE user_id = $4 AND artifact_key = $5
  `, htmlContent, dataJson, dataHash, userId, artifactKey);
}

// ─── Record feedback on artifact ──────────────────────────────

export async function recordArtifactFeedback(
  userId: number,
  artifactKey: string,
  feedback: string
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'UPDATE user_artifacts SET last_feedback = $1, updated_at = NOW() WHERE user_id = $2 AND artifact_key = $3',
    feedback, userId, artifactKey
  );
}

// ─── Auto-discover new general artifact from user widget ──────

export async function autoCreateGeneralArtifact(
  artifactKey: string,
  title: string,
  description: string,
  matchIntents: string,
  htmlTemplate: string,
  dataSchema: string
): Promise<void> {
  // Only create if not already exists
  const existing: any[] = await prisma.$queryRawUnsafe(
    'SELECT id FROM general_artifacts WHERE artifact_key = $1',
    artifactKey
  );
  if (existing.length > 0) return;

  await prisma.$executeRawUnsafe(`
    INSERT INTO general_artifacts (artifact_key, title, description, match_intents, html_template, data_schema, version, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, 1, true)
  `, artifactKey, title, description, matchIntents, htmlTemplate, dataSchema);

  console.log(`[Artifact] Auto-created general artifact: ${artifactKey}`);
}

// ─── Hash data context for cache invalidation ─────────────────

export function hashDataContext(context: string): string {
  return crypto.createHash('md5').update(context).digest('hex');
}

// ─── Build widget HTML from template + data ───────────────────

export function buildWidgetFromTemplate(template: string, dataJson: string): string {
  return template.replace('{{DATA}}', dataJson);
}

// ─── Get all general artifacts (for admin/debug) ──────────────

export async function getAllGeneralArtifacts(): Promise<GeneralArtifact[]> {
  return prisma.$queryRawUnsafe('SELECT * FROM general_artifacts WHERE is_active = true ORDER BY id');
}

// ─── Get all user artifacts for a user ────────────────────────

export async function getUserArtifacts(userId: number): Promise<UserArtifact[]> {
  return prisma.$queryRawUnsafe(
    'SELECT * FROM user_artifacts WHERE user_id = $1 ORDER BY updated_at DESC',
    userId
  );
}
