/**
 * CurrencyService — live PKR/USD exchange rate with 1-hour cache.
 * Uses free API (no key needed). Falls back to last cached or default.
 */

const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
let cachedRate: { rate: number; fetchedAt: number } | null = null;

export async function getPKRperUSD(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_DURATION_MS) {
    return cachedRate.rate;
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    const pkrPerUsd = data.rates?.PKR;

    if (pkrPerUsd && pkrPerUsd > 0) {
      cachedRate = { rate: pkrPerUsd, fetchedAt: Date.now() };
      console.log(`[Currency] Live rate: 1 USD = ${pkrPerUsd} PKR`);
      return pkrPerUsd;
    }
  } catch (e: any) {
    console.error('[Currency] Rate fetch failed:', e.message);
  }

  // Fallback: last cached rate or default
  if (cachedRate) return cachedRate.rate;
  return 278;
}
