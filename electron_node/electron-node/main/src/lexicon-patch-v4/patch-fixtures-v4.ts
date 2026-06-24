import type { LexiconPatchV4, PatchOperationV4 } from './patch-types-v4';
import { PATCH_SCHEMA_VERSION_V4 } from './patch-types-v4';
import { computePatchHashV4 } from './patch-hash-v4';

export const PATCH_V4_YUYUE_WORD = '预约';
export const PATCH_V4_YUYUE_PINYIN_KEY = 'yu|yue';
export const PATCH_V4_SAOMA_WORD = '扫码';
export const PATCH_V4_HUIGUN_WORD = '回滚';
export const PATCH_V4_HUIGUN_PINYIN_KEY = 'hui|gun';

function withHash(patchId: string, baseVersion: number, operations: PatchOperationV4[]): LexiconPatchV4 {
  const patch: LexiconPatchV4 = {
    patchId,
    patchSchemaVersion: PATCH_SCHEMA_VERSION_V4,
    baseVersion,
    nextVersion: baseVersion + 1,
    hash: '',
    operations,
  };
  patch.hash = computePatchHashV4(patch);
  return patch;
}

/** Patch N — append tech_ai to 预约 (requires term_id in op). */
export function buildPatchNAppendYuyueTechAi(baseVersion: number, termId: string) {
  return withHash('patch-v4-e2e-n-append-yuyue-tech', baseVersion, [
    {
      op: 'appendDomainTags',
      word: PATCH_V4_YUYUE_WORD,
      term_id: termId,
      domain_tags: ['tech_ai'],
      domain_weights: { tech_ai: 0.6 },
    },
  ]);
}

/** Patch N+1 — append tech_ai to 扫码 (multi-domain seed word). */
export function buildPatchN1AppendSaomaTechAi(baseVersion: number, termId: string) {
  return withHash('patch-v4-e2e-n1-append-saoma-tech', baseVersion, [
    {
      op: 'appendDomainTags',
      word: PATCH_V4_SAOMA_WORD,
      term_id: termId,
      domain_tags: ['tech_ai'],
      domain_weights: { tech_ai: 0.7 },
    },
  ]);
}

/** Patch N+2 — duplicate addTerm 预约 → must FAIL. */
export function buildPatchN2DuplicateAddYuyue(baseVersion: number) {
  return withHash('patch-v4-e2e-n2-duplicate-add-yuyue', baseVersion, [
    {
      op: 'addTerm',
      word: PATCH_V4_YUYUE_WORD,
      pinyin_key: PATCH_V4_YUYUE_PINYIN_KEY,
      domain_tags: ['tech_ai'],
      prior_score: 0.9,
    },
  ]);
}

/** Patch N+3 — new term 回滚. */
export function buildPatchN3AddHuigun(baseVersion: number) {
  return withHash('patch-v4-e2e-n3-add-huigun', baseVersion, [
    {
      op: 'addTerm',
      word: PATCH_V4_HUIGUN_WORD,
      pinyin_key: PATCH_V4_HUIGUN_PINYIN_KEY,
      tone_pinyin_key: 'hui2|gun3',
      domain_tags: ['tech_ai'],
      source: 'expansion_v4_e2e',
      prior_score: 0.9,
    },
  ]);
}

/** Patch N+4 — append tech_ai again with lower weight (max merge). */
export function buildPatchN4AppendYuyueTechAiLowWeight(baseVersion: number, termId: string) {
  return withHash('patch-v4-e2e-n4-append-weight-merge', baseVersion, [
    {
      op: 'appendDomainTags',
      word: PATCH_V4_YUYUE_WORD,
      term_id: termId,
      domain_tags: ['tech_ai'],
      domain_weights: { tech_ai: 0.3 },
    },
  ]);
}
