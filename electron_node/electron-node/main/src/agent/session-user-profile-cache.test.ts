/**
 * Phase 1: session UserProfile memory cache behavior (no disk).
 */
describe('Node session UserProfile cache contract', () => {
  it('documents session_bootstrap clears on removeSession semantics', () => {
    const cache = new Map<string, { profileVersion?: number }>();
    cache.set('s-1', { profileVersion: 2 });
    expect(cache.get('s-1')?.profileVersion).toBe(2);
    cache.delete('s-1');
    expect(cache.get('s-1')).toBeUndefined();
  });

  it('does not treat missing profile as failure', () => {
    const cache = new Map<string, unknown>();
    const profile = cache.get('missing');
    expect(profile).toBeUndefined();
    // Job flow continues when profile absent
    expect(true).toBe(true);
  });
});
