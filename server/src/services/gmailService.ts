import { google } from 'googleapis';
import { getAuthenticatedClient } from './integrationService';

/**
 * GmailService — read, search, and send emails for a user.
 * Uses per-user OAuth tokens from integrationService.
 */

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  labels: string[];
}

export interface EmailDetail extends EmailSummary {
  body: string;        // Plain text or stripped HTML
  cc?: string;
  attachments: { filename: string; mimeType: string; size: number }[];
}

// ─── Get inbox emails ─────────────────────────────────────────

export async function getInbox(userId: number, maxResults = 10, query?: string): Promise<{ emails: EmailSummary[]; error?: string }> {
  const { client, error } = await getAuthenticatedClient(userId);
  if (!client) return { emails: [], error };

  try {
    const gmail = google.gmail({ version: 'v1', auth: client });
    const q = query || 'in:inbox';
    const response = await gmail.users.messages.list({ userId: 'me', maxResults, q });

    if (!response.data.messages) return { emails: [] };

    const emails: EmailSummary[] = [];
    for (const msg of response.data.messages.slice(0, maxResults)) {
      try {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
        const headers = detail.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        emails.push({
          id: msg.id!,
          threadId: msg.threadId!,
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          snippet: detail.data.snippet || '',
          date: getHeader('Date'),
          isUnread: detail.data.labelIds?.includes('UNREAD') || false,
          labels: detail.data.labelIds || [],
        });
      } catch { /* skip individual email errors */ }
    }

    return { emails };
  } catch (err: any) {
    return { emails: [], error: `Gmail error: ${err.message}` };
  }
}

// ─── Read full email ──────────────────────────────────────────

export async function readEmail(userId: number, messageId: string): Promise<{ email?: EmailDetail; error?: string }> {
  const { client, error } = await getAuthenticatedClient(userId);
  if (!client) return { error };

  try {
    const gmail = google.gmail({ version: 'v1', auth: client });
    const detail = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    // Extract body
    let body = '';
    const payload = detail.data.payload;
    if (payload?.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload?.parts) {
      const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
      const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      } else if (htmlPart?.body?.data) {
        body = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    // Extract attachments
    const attachments = (payload?.parts || [])
      .filter(p => p.filename && p.filename.length > 0)
      .map(p => ({ filename: p.filename!, mimeType: p.mimeType || '', size: parseInt(p.body?.size?.toString() || '0') }));

    return {
      email: {
        id: messageId,
        threadId: detail.data.threadId!,
        from: getHeader('From'),
        to: getHeader('To'),
        cc: getHeader('Cc') || undefined,
        subject: getHeader('Subject'),
        snippet: detail.data.snippet || '',
        date: getHeader('Date'),
        isUnread: detail.data.labelIds?.includes('UNREAD') || false,
        labels: detail.data.labelIds || [],
        body: body.slice(0, 5000), // Limit body size for AI context
        attachments,
      },
    };
  } catch (err: any) {
    return { error: `Gmail error: ${err.message}` };
  }
}

// ─── Send email ───────────────────────────────────────────────

export async function sendUserEmail(userId: number, to: string, subject: string, body: string, cc?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { client, error } = await getAuthenticatedClient(userId);
  if (!client) return { success: false, error };

  try {
    const gmail = google.gmail({ version: 'v1', auth: client });

    // Build RFC 2822 message
    const headers = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : '',
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
    ].filter(Boolean).join('\r\n');

    const message = `${headers}\r\n\r\n${body}`;
    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    return { success: true, messageId: response.data.id || undefined };
  } catch (err: any) {
    return { success: false, error: `Send failed: ${err.message}` };
  }
}

// ─── Search emails ────────────────────────────────────────────

export async function searchEmails(userId: number, query: string, maxResults = 10): Promise<{ emails: EmailSummary[]; error?: string }> {
  return getInbox(userId, maxResults, query);
}

// ─── Get unread count ─────────────────────────────────────────

export async function getUnreadCount(userId: number): Promise<{ count: number; error?: string }> {
  const { client, error } = await getAuthenticatedClient(userId);
  if (!client) return { count: 0, error };

  try {
    const gmail = google.gmail({ version: 'v1', auth: client });
    const response = await gmail.users.messages.list({ userId: 'me', q: 'is:unread in:inbox', maxResults: 1 });
    return { count: response.data.resultSizeEstimate || 0 };
  } catch (err: any) {
    return { count: 0, error: err.message };
  }
}
