import { Request, Response } from 'express';
import * as indexCacheService from '../services/indexCacheService';

export async function getStatus(_req: Request, res: Response) {
  try {
    const status = indexCacheService.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function getSectionStats(_req: Request, res: Response) {
  try {
    const sections = indexCacheService.getCachedSections();
    const stats = sections.map(s => {
      const header = s.header.replace(/^#+\s*/, '').trim();
      const lines = s.body.split('\n');
      const totalLines = lines.length;
      const tableRows = lines.filter(l => l.trim().startsWith('|') && !l.includes('---')).length;
      const empIds = lines.filter(l => /\bC-\d{3,4}\b/.test(l)).length;
      const nonEmpty = lines.filter(l => l.trim() && !l.startsWith('#')).length;
      // Show first 3 data lines as sample
      const sample = lines.filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('_')).slice(0, 10).map(l => l.slice(0, 150));
      return { header, chars: s.body.length, totalLines, tableRows: Math.max(0, tableRows - 1), empIds, nonEmpty, sample };
    });
    res.json({ sectionCount: sections.length, sections: stats, dataSummary: indexCacheService.getDataSummary() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function forceRefresh(_req: Request, res: Response) {
  try {
    await indexCacheService.refreshIndex();
    const status = indexCacheService.getStatus();
    res.json({ message: 'Index refreshed successfully', ...status });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to refresh index: ' + error.message });
  }
}
