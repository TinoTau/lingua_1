import { computePatchHash, verifyPatchHash } from './patch-hash';
import type { LexiconPatchV3 } from './patch-types';

function samplePatch(operationsOrder: 'ab' | 'ba'): LexiconPatchV3 {
  const opA = {
    op: 'disable' as const,
    table: 'domain' as const,
    word: '测试词',
    domainId: 'travel',
  };
  const opB = {
    op: 'enable' as const,
    table: 'domain' as const,
    word: '测试词',
    domainId: 'travel',
  };
  const operations = operationsOrder === 'ab' ? [opA, opB] : [opB, opA];
  const patch: LexiconPatchV3 = {
    patchId: 'test-patch-1',
    baseVersion: 1,
    nextVersion: 2,
    hash: '',
    operations,
  };
  patch.hash = computePatchHash(patch);
  return patch;
}

describe('patch-hash', () => {
  it('hash is stable regardless of operations order', () => {
    const a = samplePatch('ab');
    const b = samplePatch('ba');
    expect(computePatchHash(a)).toBe(computePatchHash(b));
    expect(verifyPatchHash(a)).toBe(true);
  });

  it('rejects tampered hash', () => {
    const patch = samplePatch('ab');
    patch.hash = 'sha256:deadbeef';
    expect(verifyPatchHash(patch)).toBe(false);
  });
});
