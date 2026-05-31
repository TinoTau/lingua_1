import { describe, expect, it } from '@jest/globals';
import { LruBucketCache } from './lru-bucket-cache';

describe('LruBucketCache', () => {
  it('evicts oldest entry when max size exceeded', () => {
    const cache = new LruBucketCache<string>(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a');
    cache.set('c', '3');

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('c')).toBe('3');
    expect(cache.stats().size).toBe(2);
  });

  it('tracks hits and misses', () => {
    const cache = new LruBucketCache<number>(4);
    cache.set('k', 1);
    expect(cache.get('k')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();

    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});
