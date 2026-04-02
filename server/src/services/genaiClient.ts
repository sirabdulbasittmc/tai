import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI {
  if (!client) {
    const useVertex = process.env.USE_VERTEX_AI === 'true';
    if (useVertex) {
      client = new GoogleGenAI({
        vertexai: true,
        project: process.env.GCP_PROJECT_ID || 'tmcai-491811',
        location: process.env.GCP_LOCATION || 'us-central1',
      });
    } else {
      client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    }
  }
  return client;
}

export function resetClient(): void {
  client = null;
}
