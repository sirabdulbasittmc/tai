import { DataConnector } from './DataConnector';
import { Document } from '../types';
import { fetchIndexFileContent, isAuthorized } from '../services/driveService';
import crypto from 'crypto';

/**
 * Google Drive connector — fetches the TMC_Drive_Index.md file and
 * normalizes it into the source-agnostic Document format.
 *
 * When BigQuery or Vertex AI connectors are added later, they implement
 * the same DataConnector interface. The RAG pipeline doesn't change.
 */
export class DriveConnector implements DataConnector {
  readonly name = 'google_drive';

  isReady(): boolean {
    // Drive connector works even without auth (falls back to local file)
    return true;
  }

  async fetchDocuments(): Promise<Document[]> {
    const rawContent = await fetchIndexFileContent();

    // Extract timestamp from the markdown
    const timestampMatch = rawContent.match(/_Last updated:\s*(.+?)_/);
    const updatedAt = timestampMatch ? timestampMatch[1].trim() : new Date().toISOString();

    // Split into sections by ## headers — each section becomes a Document
    const documents: Document[] = [];
    const lines = rawContent.split('\n');
    let currentLines: string[] = [];
    let currentHeader = '';

    for (const line of lines) {
      if (line.startsWith('## ') && currentLines.length > 0) {
        documents.push(this.buildDocument(currentHeader, currentLines.join('\n'), updatedAt));
        currentLines = [];
        currentHeader = line.replace(/^##\s*/, '').trim();
      }
      if (line.startsWith('## ') && currentLines.length === 0) {
        currentHeader = line.replace(/^##\s*/, '').trim();
      }
      currentLines.push(line);
    }

    // Last section
    if (currentLines.length > 0) {
      documents.push(this.buildDocument(currentHeader, currentLines.join('\n'), updatedAt));
    }

    console.log(`[DriveConnector] Fetched ${documents.length} documents from ${isAuthorized() ? 'Google Drive' : 'local file'}`);
    return documents;
  }

  private buildDocument(header: string, content: string, updatedAt: string): Document {
    return {
      id: `drive_${crypto.createHash('md5').update(header || content.slice(0, 100)).digest('hex').slice(0, 12)}`,
      content,
      metadata: {
        source: this.name,
        title: header || 'Untitled Section',
        section: header,
        updatedAt,
      },
    };
  }
}
