import type { PatchBundleTableCounts, PatchOperation } from './patch-types';
import { computePatchHash } from './patch-hash';

export const PATCH_WORDS = {
  base: '测试热词甲',
  term: '皇后镇测试点',
  termAlias: '皇后城测试点',
} as const;

export const PATCH_KEYS = {
  basePinyin: 'ce|shi|re|ci|jia',
  termPinyin: 'huang|hou|zhen|ce|shi|dian',
} as const;

export const PATCH_TERM_ID = 'patch-e2e-term-travel';
export const PATCH_MULTI_TERM_ID = 'patch-e2e-term-multi';

export const PATCH_MULTI_WORD = '多维测试词';
export const PATCH_MULTI_PINYIN = 'duo|wei|ce|shi|ci';

function withHash(
  patchId: string,
  baseVersion: number,
  operations: PatchOperation[]
): import('./patch-types').LexiconPatchV3 {
  const patch = {
    patchId,
    baseVersion,
    nextVersion: baseVersion + 1,
    hash: '',
    operations,
  };
  patch.hash = computePatchHash(patch);
  return patch;
}

export function buildPatchA(baseVersion: number) {
  return withHash('patch-e2e-a-base-add', baseVersion, [
    {
      op: 'add',
      table: 'base',
      word: PATCH_WORDS.base,
      entry: {
        id: 'patch-e2e-base-1',
        word: PATCH_WORDS.base,
        pinyinKey: PATCH_KEYS.basePinyin,
        tonePinyinKey: 'ce4|shi4|re4|ci2|jia3',
        priorScore: 0.95,
        repairTarget: true,
        enabled: true,
      },
    },
  ]);
}

export function buildPatchB(baseVersion: number) {
  return withHash('patch-e2e-b-term-add', baseVersion, [
    {
      op: 'add',
      table: 'term',
      word: PATCH_WORDS.term,
      entry: {
        termId: PATCH_TERM_ID,
        word: PATCH_WORDS.term,
        pinyinKey: PATCH_KEYS.termPinyin,
        tonePinyinKey: 'huang2|hou4|zhen4|ce4|shi4|dian3',
        priorScore: 0.96,
        domainTags: ['travel'],
        domainWeights: { travel: 1.0 },
        aliases: [PATCH_WORDS.termAlias],
        repairTarget: true,
        enabled: true,
      },
    },
  ]);
}

export function buildPatchC(baseVersion: number) {
  return withHash('patch-e2e-c-term-update', baseVersion, [
    {
      op: 'update',
      table: 'term',
      word: PATCH_WORDS.term,
      termId: PATCH_TERM_ID,
      fields: { priorScore: 0.98 },
    },
  ]);
}

export function buildPatchIMultiDomain(baseVersion: number) {
  return withHash('patch-e2e-i-multidomain-add', baseVersion, [
    {
      op: 'add',
      table: 'term',
      word: PATCH_MULTI_WORD,
      entry: {
        termId: PATCH_MULTI_TERM_ID,
        word: PATCH_MULTI_WORD,
        pinyinKey: PATCH_MULTI_PINYIN,
        tonePinyinKey: 'duo1|wei2|ce4|shi4|ci2',
        priorScore: 0.91,
        domainTags: ['travel', 'restaurant'],
        domainWeights: { travel: 0.8, restaurant: 0.6 },
        repairTarget: true,
        enabled: true,
      },
    },
  ]);
}

export function buildPatchJUpdateDomainWeights(baseVersion: number) {
  return withHash('patch-e2e-j-update-domain-weights', baseVersion, [
    {
      op: 'update',
      table: 'term',
      word: PATCH_MULTI_WORD,
      termId: PATCH_MULTI_TERM_ID,
      fields: {
        domainWeights: { travel: 0.5, restaurant: 1.0 },
      },
    },
  ]);
}

export function buildPatchKDeleteSingleTag(baseVersion: number) {
  return withHash('patch-e2e-k-delete-tag', baseVersion, [
    {
      op: 'delete',
      table: 'term',
      word: PATCH_MULTI_WORD,
      termId: PATCH_MULTI_TERM_ID,
      domainId: 'restaurant',
    },
  ]);
}

export function buildPatchLDeleteFullTerm(baseVersion: number) {
  return withHash('patch-e2e-l-delete-term', baseVersion, [
    {
      op: 'delete',
      table: 'term',
      word: PATCH_MULTI_WORD,
      termId: PATCH_MULTI_TERM_ID,
    },
  ]);
}

export function buildPatchMEnableTerm(baseVersion: number) {
  return withHash('patch-e2e-m-term-enable', baseVersion, [
    {
      op: 'enable',
      table: 'term',
      word: PATCH_WORDS.term,
      termId: PATCH_TERM_ID,
    },
  ]);
}

export function buildPatchD(baseVersion: number) {
  return withHash('patch-e2e-d-term-disable', baseVersion, [
    {
      op: 'disable',
      table: 'term',
      word: PATCH_WORDS.term,
      termId: PATCH_TERM_ID,
    },
  ]);
}

export function buildPatchE(baseVersion: number) {
  return withHash('patch-e2e-e-base-delete', baseVersion, [
    {
      op: 'delete',
      table: 'base',
      word: PATCH_WORDS.base,
      pinyinKey: PATCH_KEYS.basePinyin,
    },
  ]);
}

export function buildPatchFDuplicate(patchA: import('./patch-types').LexiconPatchV3) {
  return { ...patchA, baseVersion: patchA.nextVersion, nextVersion: patchA.nextVersion + 1 };
}

export function buildPatchGWrongVersion(currentVersion: number) {
  return withHash('patch-e2e-g-wrong-version', currentVersion + 99, [
    {
      op: 'add',
      table: 'base',
      word: '不应写入',
      entry: {
        id: 'patch-e2e-g',
        word: '不应写入',
        pinyinKey: 'bu|ying|xie|ru',
        priorScore: 0.9,
      },
    },
  ]);
}

export function buildPatchHInvalidDomain(baseVersion: number) {
  return withHash('patch-e2e-h-invalid-domain', baseVersion, [
    {
      op: 'add',
      table: 'term',
      word: '非法域词',
      entry: {
        termId: 'patch-e2e-h',
        word: '非法域词',
        pinyinKey: 'fei|fa|yu|ci',
        priorScore: 0.9,
        domainTags: ['not_a_real_domain_xyz'],
      },
    },
  ]);
}

export function buildPatchRollbackProbe(baseVersion: number) {
  return withHash('patch-e2e-rollback-probe', baseVersion, [
    {
      op: 'add',
      table: 'base',
      word: '回滚探测词',
      entry: {
        id: 'patch-e2e-rollback',
        word: '回滚探测词',
        pinyinKey: 'hui|gun|tan|ce|ci',
        priorScore: 0.9,
        repairTarget: true,
        enabled: true,
      },
    },
  ]);
}
