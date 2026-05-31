/**
 * Simple LRU cache for V2 pinyin bucket query results.
 */

export type LruBucketCacheStats = {
  size: number;
  hits: number;
  misses: number;
};

export class LruBucketCache<T> {
  private readonly maxSize: number;
  private readonly map = new Map<string, T>();
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  get(key: string): T | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): LruBucketCacheStats {
    return { size: this.map.size, hits: this.hits, misses: this.misses };
  }
}
