// ─── Existing Types ────────────────────────────────────────────

export interface Section {
  header: string;
  headerLower: string;
  body: string;
  bodyLower: string;
}

export type DataSource = 'org' | 'personal_drive' | 'uploads';

export interface ChatRequest {
  message: string;
  provider: 'gemini' | 'gemini-flash' | 'groq' | 'claude' | 'openai' | 'openrouter';
  conversationId?: number;    // If provided, appends to existing conversation
  sources?: DataSource[];     // Phase 3.3: which data sources to query (default: all enabled)
}

export interface SSEChunk {
  type: 'chunk' | 'done' | 'error';
  content?: string;
}

export interface IndexStatus {
  loaded: boolean;
  sectionCount: number;
  charCount: number;
  lastRefresh: string | null;
  dataLastUpdated: string | null;
  vectorCount?: number;
  embeddingModel?: string;
}

// ─── Data Connector Types ──────────────────────────────────────

export interface Document {
  id: string;
  content: string;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  source: string;        // e.g., 'google_drive', 'bigquery', 'vertex_ai'
  sourceId?: string;     // e.g., Drive file ID, BQ table name
  title?: string;
  section?: string;
  updatedAt?: string;
  [key: string]: any;    // extensible for future sources
}

// ─── Chunking Types ────────────────────────────────────────────

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata extends DocumentMetadata {
  chunkIndex: number;
  headerPath: string[];   // hierarchical header context e.g., ["Clients", "Fauji"]
  contentHash: string;    // for detecting changes on re-index
}

// ─── Vector Store Types ────────────────────────────────────────

export interface VectorEntry {
  chunkId: string;
  vector: number[];
  chunk: Chunk;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

// ─── PII Types ─────────────────────────────────────────────────

export interface PIIEntity {
  type: string;          // e.g., 'PERSON', 'ORG', 'EMPLOYEE_ID', 'AMOUNT', 'EMAIL', 'PHONE'
  value: string;
  placeholder: string;   // e.g., '[PERSON_1]'
}

export interface PIIMask {
  maskedText: string;
  entities: PIIEntity[];
  mapping: Record<string, string>;  // placeholder → real value
}
