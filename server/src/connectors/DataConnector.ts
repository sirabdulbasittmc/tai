import { Document } from '../types';

/**
 * Source-agnostic interface for fetching documents.
 * Each data source (Google Drive, BigQuery, Vertex AI, etc.) implements this.
 * RAG and PII layers never change — only new connectors are added.
 */
export interface DataConnector {
  /** Unique name for this data source */
  readonly name: string;

  /** Fetch all documents from this source */
  fetchDocuments(): Promise<Document[]>;

  /** Check if this connector is ready (authorized, configured, etc.) */
  isReady(): boolean;
}
