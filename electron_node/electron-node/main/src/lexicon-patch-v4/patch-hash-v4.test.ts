import { computePatchHashV4, verifyPatchHashV4 } from './patch-hash-v4';
import type { LexiconPatchV4 } from './patch-types-v4';
import { PATCH_SCHEMA_VERSION_V4 } from './patch-types-v4';

function samplePatch(order: 'ab' | 'ba'): LexiconPatchV4 {
  const opA = {
    op: 'addTerm' as const,
    word: '测试词',
    pinyin_key: 'ce|shi|ci',
    domain_tags: ['tech_ai'],
  };
  const opB = {
    op: 'appendDomainTags' as const,
    word: '预约',
    term_id: 'term-test-1',
    domain_tags: ['medical'],
  };
  const operations = order === 'ab' ? [opA, opB] : [opB, opA];
  const patch: LexiconPatchV4 = {
    patchId: 'test-patch-v4-1',
    patchSchemaVersion: PATCH_SCHEMA_VERSION_V4,
    baseVersion: 1,
    nextVersion: 2,
    hash: '',
    operations,
  };
  patch.hash = computePatchHashV4(patch);
  return patch;
}

describe('patch-hash-v4', () => {
  it('hash is stable regardless of operations order', () => {
    const a = samplePatch('ab');
    const b = samplePatch('ba');
    expect(computePatchHashV4(a)).toBe(computePatchHashV4(b));
    expect(verifyPatchHashV4(a)).toBe(true);
  });

  it('rejects tampered hash', () => {
    const patch = samplePatch('ab');
    patch.hash = 'sha256:deadbeef';
    expect(verifyPatchHashV4(patch)).toBe(false);
  });
});
