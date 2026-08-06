export const INDEX_PATHS = [
  '/v1/indices/one-piece',
  '/v1/indices/one-piece/series?window=365',
  '/v1/indices/pokemon',
  '/v1/indices/pokemon/series?window=365'
];

export const INDEX_CACHE_TTL_MS = 15 * 60 * 1000;
export const INDEX_CACHE_MAX_STALE_MS = 24 * 60 * 60 * 1000;

export class IndexResponseCache {
  constructor({ fetcher, now = Date.now, ttlMs = INDEX_CACHE_TTL_MS, maxStaleMs = INDEX_CACHE_MAX_STALE_MS }) {
    this.fetcher = fetcher;
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxStaleMs = maxStaleMs;
    this.entries = new Map();
    this.pending = new Map();
  }

  async get(key) {
    const entry = this.entries.get(key);
    const ageMs = entry ? Math.max(0, this.now() - entry.storedAt) : 0;
    if (entry && ageMs <= this.ttlMs) return { entry, status: 'HIT', ageMs };

    if (entry && ageMs <= this.maxStaleMs) {
      this.refresh(key).catch(() => {});
      return { entry, status: 'STALE', ageMs };
    }

    if (entry) this.entries.delete(key);
    const refreshed = await this.refresh(key);
    return { entry: refreshed, status: 'MISS', ageMs: 0 };
  }

  refresh(key) {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const pending = this.fetcher(key).then((entry) => {
      if (entry.status === 200) {
        const stored = { ...entry, storedAt: this.now() };
        this.entries.set(key, stored);
        return stored;
      }
      return entry;
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, pending);
    return pending;
  }
}
