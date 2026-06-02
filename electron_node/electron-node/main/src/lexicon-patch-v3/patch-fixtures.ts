import type { LexiconPatchV3, PatchOperation } from './patch-types';
import { computePatchHash } from './patch-hash';

export const PATCH_WORDS = {
  base: '测试热词甲',
  domain: '皇后镇测试点',
  domainAlias: '皇后城测试点',
} as const;

export const PATCH_KEYS = {
  basePinyin: 'ce|shi|re|ci|jia',
  domainPinyin: 'huang|hou|zhen|ce|shi|dian',
} as const;

function withHash(
  patchId: string,
  baseVersion: number,
  operations: PatchOperation[]
): LexiconPatchV3 {
  const patch: LexiconPatchV3 = {
    patchId,
    baseVersion,
    nextVersion: baseVersion + 1,
    hash: '',
    operations,
  };
  patch.hash = computePatchHash(patch);
  return patch;
}

export function buildPatchA(baseVersion: number): LexiconPatchV3 {
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

export function buildPatchB(baseVersion: number): LexiconPatchV3 {
  return withHash('patch-e2e-b-domain-add', baseVersion, [
    {
      op: 'add',
      table: 'domain',
      word: PATCH_WORDS.domain,
      entry: {
        id: 'patch-e2e-domain-1',
        word: PATCH_WORDS.domain,
        pinyinKey: PATCH_KEYS.domainPinyin,
        tonePinyinKey: 'huang2|hou4|zhen4|ce4|shi4|dian3',
        priorScore: 0.96,
        domainId: 'travel',
        aliases: [PATCH_WORDS.domainAlias],
        repairTarget: true,
        enabled: true,
      },
    },
  ]);
}

export function buildPatchC(baseVersion: number): LexiconPatchV3 {
  return withHash('patch-e2e-c-domain-update', baseVersion, [
    {
      op: 'update',
      table: 'domain',
      word: PATCH_WORDS.domain,
      domainId: 'travel',
      fields: { priorScore: 0.98 },
    },
  ]);
}

export function buildPatchD(baseVersion: number): LexiconPatchV3 {
  return withHash('patch-e2e-d-domain-disable', baseVersion, [
    {
      op: 'disable',
      table: 'domain',
      word: PATCH_WORDS.domain,
      domainId: 'travel',
    },
  ]);
}

export function buildPatchE(baseVersion: number): LexiconPatchV3 {
  return withHash('patch-e2e-e-base-delete', baseVersion, [
    {
      op: 'delete',
      table: 'base',
      word: PATCH_WORDS.base,
      pinyinKey: PATCH_KEYS.basePinyin,
    },
  ]);
}

export function buildPatchFDuplicate(patchA: LexiconPatchV3): LexiconPatchV3 {
  return { ...patchA, baseVersion: patchA.nextVersion, nextVersion: patchA.nextVersion + 1 };
}

export function buildPatchGWrongVersion(currentVersion: number): LexiconPatchV3 {
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

export function buildPatchHInvalidDomain(baseVersion: number): LexiconPatchV3 {
  return withHash('patch-e2e-h-invalid-domain', baseVersion, [
    {
      op: 'add',
      table: 'domain',
      word: '非法域词',
      entry: {
        id: 'patch-e2e-h',
        word: '非法域词',
        pinyinKey: 'fei|fa|yu|ci',
        priorScore: 0.9,
        domainId: 'not_a_real_domain_xyz',
      },
    },
  ]);
}

/** Valid ops only — gate failure is injected in rollback E2E test. */
export function buildPatchRollbackProbe(baseVersion: number): LexiconPatchV3 {
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
