/**
 * NewsService — fetches news from NewsAPI.org
 *
 * Supports:
 * - Top headlines by country (default: Pakistan)
 * - Category filter (business, technology, sports, health, science, entertainment)
 * - Keyword search
 * - Summarized for AI consumption
 */

const NEWS_API_BASE = 'https://newsapi.org/v2';

interface NewsArticle {
  title: string;
  source: string;
  description: string;
  url: string;
  publishedAt: string;
}

/**
 * Fetch top headlines
 */
export async function getTopHeadlines(options?: {
  country?: string;
  category?: string;
  query?: string;
  pageSize?: number;
}): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams();
    params.set('apiKey', apiKey);
    params.set('pageSize', String(options?.pageSize || 5));

    if (options?.query) {
      // Search mode
      params.set('q', options.query);
      params.set('language', 'en');
      const url = `${NEWS_API_BASE}/everything?${params}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return formatArticles(data.articles || []);
    }

    // Headlines mode — country OR category (not both when country has no results)
    const country = options?.country;
    if (country) {
      params.set('country', country);
    } else if (!options?.category) {
      params.set('country', 'pk'); // default to Pakistan only when no category specified
    }
    if (options?.category) params.set('category', options.category);

    const url = `${NEWS_API_BASE}/top-headlines?${params}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return formatArticles(data.articles || []);
  } catch (err: any) {
    console.error('[News] Fetch failed:', err.message);
    return [];
  }
}

/**
 * Get news summary as text (for AI prompt injection or welcome screen)
 */
export async function getNewsSummary(options?: {
  country?: string;
  category?: string;
  query?: string;
  count?: number;
}): Promise<string> {
  const articles = await getTopHeadlines({ ...options, pageSize: options?.count || 5 });
  if (articles.length === 0) return '';

  return articles.map((a, i) =>
    `${i + 1}. ${a.title} (${a.source})`
  ).join('\n');
}

/**
 * Get news for welcome screen (brief, 3 headlines)
 */
export async function getWelcomeNews(country = 'pk', category?: string): Promise<string[]> {
  const articles = await getTopHeadlines({ country: country || undefined, category, pageSize: 3 });
  return articles.map(a => a.title);
}

/**
 * Detect if a message is asking about news
 */
export function isNewsQuery(message: string): boolean {
  return /\b(news|headlines|happening|whats going on|what's going on|current events|latest updates|today.s news)\b/i.test(message);
}

/**
 * Extract news category/query from message
 */
export function parseNewsIntent(message: string): { category?: string; query?: string; country?: string } {
  const lower = message.toLowerCase();

  // Category detection
  if (/\b(tech|technology|software|ai|startup)\b/.test(lower)) return { category: 'technology' };
  if (/\b(business|economy|market|stock|finance)\b/.test(lower)) return { category: 'business' };
  if (/\b(sport|cricket|football|match|psl)\b/.test(lower)) return { category: 'sports' };
  if (/\b(health|medical|covid|disease)\b/.test(lower)) return { category: 'health' };
  if (/\b(science|space|research)\b/.test(lower)) return { category: 'science' };
  if (/\b(entertainment|movie|drama|bollywood|lollywood)\b/.test(lower)) return { category: 'entertainment' };

  // Country detection
  if (/\b(international|world|global)\b/.test(lower)) return { country: 'us' };
  if (/\b(pakistan|local|pk)\b/.test(lower)) return { country: 'pk' };
  if (/\b(india|indian)\b/.test(lower)) return { country: 'in' };

  // Keyword search
  const searchMatch = lower.match(/news (?:about|on|regarding) (.+)/i);
  if (searchMatch) return { query: searchMatch[1].trim() };

  return {};
}

function formatArticles(articles: any[]): NewsArticle[] {
  return articles
    .filter(a => a.title && a.title !== '[Removed]')
    .map(a => ({
      title: a.title || '',
      source: a.source?.name || '',
      description: (a.description || '').slice(0, 200),
      url: a.url || '',
      publishedAt: a.publishedAt || '',
    }));
}
