/**
 * Model2 PROFILE_TARGET_ABSENT — TEST_FIXTURE_ONLY LexiconRuntimeV2 bundle.
 * Copies operational v3 schema; seeds controlled terms; never writes production lexicon.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { copyV3BundleToTemp } from '../lexicon-patch-v3/bundle-snapshot';
import { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';
import { sha256File } from '../lexicon/lexicon-manifest';
import {
  LEXICON_RUNTIME_CHECKSUM,
  LEXICON_RUNTIME_MANIFEST,
  LEXICON_RUNTIME_SQLITE,
} from '../lexicon-v2/lexicon-v2-bundle-path';
import { ACTIVE_SET_V1 } from './relation-direction';

const REPO_ROOT = path.resolve(__dirname, '../../../../../');
export const MODEL2_E2E_V3_SOURCE = path.join(REPO_ROOT, 'node_runtime', 'lexicon', 'v3');

export const FIXTURE_SOURCE_TAG = 'TEST_FIXTURE_ONLY_MODEL2_RUNTIME_E2E';

export type FixtureTermSeed = {
  id: string;
  word: string;
  pinyinKey: string;
  tonePinyinKey: string;
  priorScore?: number;
  /** If set, also write domain_lexicon + term + term_domain_tags */
  domains?: readonly string[];
  role: 'target' | 'distractor' | 'duplicate_base';
};

export type ProfileTargetAbsentCaseDef = {
  case_id: string;
  relation: string;
  observedSyllables: string[];
  windowText: string;
  targetId: string;
  targetWord: string;
  targetPinyinKey: string;
  distractorIds: string[];
  phoneticBias: Record<string, number>;
  multiTag?: boolean;
  domainScope: string[];
  /** Tone numbers for observed FineSpan (Batch 1.1C). */
  observedTonePattern: number[];
  /** Tone numbers for intended/target key. */
  intendedTonePattern: number[];
};

export type Model2E2EFixture = {
  bundleDir: string;
  sqlitePath: string;
  cases: ProfileTargetAbsentCaseDef[];
  cleanup: () => void;
  loadRuntime: () => LexiconRuntimeV2;
  manifest: Record<string, unknown>;
};

function rewriteChecksum(bundleDir: string): void {
  const sqlitePath = path.join(bundleDir, LEXICON_RUNTIME_SQLITE);
  const manifestPath = path.join(bundleDir, LEXICON_RUNTIME_MANIFEST);
  const checksumPath = path.join(bundleDir, LEXICON_RUNTIME_CHECKSUM);
  const digest = sha256File(sqlitePath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  manifest.checksum = `sha256:${digest}`;
  (manifest as { testFixtureOnly?: boolean }).testFixtureOnly = true;
  (manifest as { fixtureTag?: string }).fixtureTag = FIXTURE_SOURCE_TAG;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(checksumPath, `sha256:${digest}\n`, 'utf-8');
}

function upsertTerm(db: Database.Database, t: FixtureTermSeed): void {
  db.prepare(
    `INSERT OR REPLACE INTO term (
      id, word, pinyin_key, tone_pinyin_key, prior_score, repair_target, enabled, source, tier
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'base')`
  ).run(t.id, t.word, t.pinyinKey, t.tonePinyinKey, t.priorScore ?? 0.95, FIXTURE_SOURCE_TAG);

  db.prepare(
    `INSERT OR REPLACE INTO base_lexicon (
      id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
      repair_target, enabled, aliases, source, canonical_word, is_alias
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, NULL, ?, ?, 0)`
  ).run(
    t.id,
    t.pinyinKey,
    t.tonePinyinKey,
    t.word,
    t.word,
    t.priorScore ?? 0.95,
    FIXTURE_SOURCE_TAG,
    t.word
  );

  if (t.domains?.length) {
    const domStmt = db.prepare(
      `INSERT OR REPLACE INTO domain_lexicon (
        id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
        repair_target, enabled, aliases, source, canonical_word, is_alias
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, ?, ?, 0)`
    );
    const tagStmt = db.prepare(
      `INSERT OR REPLACE INTO term_domain_tags (term_id, domain_id, weight) VALUES (?, ?, ?)`
    );
    for (const d of t.domains) {
      domStmt.run(
        t.id,
        d,
        t.pinyinKey,
        t.tonePinyinKey,
        t.word,
        t.word,
        t.priorScore ?? 0.97,
        FIXTURE_SOURCE_TAG,
        t.word
      );
      tagStmt.run(t.id, d, 1.0);
    }
  }
}

/**
 * Build ≥20 PROFILE_TARGET_ABSENT case defs covering ACTIVE_SET_V1.
 * observed = confused (Y); target indexed only under intended (X) after reverse transform.
 */
export function buildProfileTargetAbsentCaseDefs(): {
  cases: ProfileTargetAbsentCaseDef[];
  terms: FixtureTermSeed[];
} {
  const terms: FixtureTermSeed[] = [];
  const cases: ProfileTargetAbsentCaseDef[] = [];

  function tonesFromKey(toneKey: string): number[] {
    return toneKey.split('|').map((p) => {
      const m = p.match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
  }

  type RelSpec = {
    relation: string;
    observed: string[];
    intended: string[];
    targetWord: string;
    distractorWords: [string, string];
    toneObs: string;
    toneInt: string;
  };

  // observed uses Y side; intended/target uses X side after reverse of ACTIVE relation.
  // Tone digits MUST match between observedTonePattern and intended tone_pinyin_key so
  // Batch 1.1C tone_exact recall can hit after initial/final transform.
  const specs: RelSpec[] = [
    {
      relation: 'n_l',
      observed: ['lai', 'zi'],
      intended: ['nai', 'zi'],
      targetWord: '奶籽',
      distractorWords: ['来籽', '赖籽'],
      toneObs: 'lai3|zi3',
      toneInt: 'nai3|zi3',
    },
    {
      relation: 'n_l',
      observed: ['li', 'zi'],
      intended: ['ni', 'zi'],
      targetWord: '泥籽',
      distractorWords: ['梨籽', '俐籽'],
      toneObs: 'li2|zi3',
      toneInt: 'ni2|zi3',
    },
    {
      relation: 'n_l',
      observed: ['lan', 'hua'],
      intended: ['nan', 'hua'],
      targetWord: '南花',
      distractorWords: ['兰花', '栏花'],
      toneObs: 'lan2|hua1',
      toneInt: 'nan2|hua1',
    },
    {
      relation: 'sh_s',
      observed: ['si', 'zi'],
      intended: ['shi', 'zi'],
      targetWord: '石籽',
      distractorWords: ['四籽', '丝籽'],
      toneObs: 'si2|zi3',
      toneInt: 'shi2|zi3',
    },
    {
      relation: 'sh_s',
      observed: ['su', 'cai'],
      intended: ['shu', 'cai'],
      targetWord: '蔬菜',
      distractorWords: ['素菜', '速菜'],
      toneObs: 'su1|cai4',
      toneInt: 'shu1|cai4',
    },
    {
      relation: 'sh_s',
      observed: ['san', 'zi'],
      intended: ['shan', 'zi'],
      targetWord: '山籽',
      distractorWords: ['三籽', '散籽'],
      toneObs: 'san1|zi3',
      toneInt: 'shan1|zi3',
    },
    {
      relation: 'h_f',
      observed: ['fei', 'ji'],
      intended: ['hei', 'ji'],
      targetWord: '黑机',
      distractorWords: ['飞机', '废机'],
      toneObs: 'fei1|ji1',
      toneInt: 'hei1|ji1',
    },
    {
      relation: 'h_f',
      observed: ['fu', 'zi'],
      intended: ['hu', 'zi'],
      targetWord: '湖籽',
      distractorWords: ['福籽', '付籽'],
      toneObs: 'fu2|zi3',
      toneInt: 'hu2|zi3',
    },
    {
      relation: 'h_f',
      observed: ['fang', 'zi'],
      intended: ['hang', 'zi'],
      targetWord: '航籽',
      distractorWords: ['房籽', '方籽'],
      toneObs: 'fang2|zi3',
      toneInt: 'hang2|zi3',
    },
    {
      relation: 'z_zh',
      observed: ['zhong', 'zi'],
      intended: ['zong', 'zi'],
      targetWord: '棕籽',
      distractorWords: ['中籽', '忠籽'],
      toneObs: 'zhong1|zi3',
      toneInt: 'zong1|zi3',
    },
    {
      relation: 'z_zh',
      observed: ['zhu', 'zi'],
      intended: ['zu', 'zi'],
      targetWord: '祖籽',
      distractorWords: ['竹籽', '珠籽'],
      toneObs: 'zhu3|zi3',
      toneInt: 'zu3|zi3',
    },
    {
      relation: 'z_zh',
      observed: ['zhang', 'zi'],
      intended: ['zang', 'zi'],
      targetWord: '脏籽',
      distractorWords: ['章籽', '张籽'],
      toneObs: 'zhang1|zi3',
      toneInt: 'zang1|zi3',
    },
    {
      relation: 'ch_c',
      observed: ['ci', 'zi'],
      intended: ['chi', 'zi'],
      targetWord: '池籽',
      distractorWords: ['词籽', '次籽'],
      toneObs: 'ci2|zi3',
      toneInt: 'chi2|zi3',
    },
    {
      relation: 'ch_c',
      observed: ['can', 'zi'],
      intended: ['chan', 'zi'],
      targetWord: '禅籽',
      distractorWords: ['残籽', '餐籽'],
      toneObs: 'can2|zi3',
      toneInt: 'chan2|zi3',
    },
    {
      relation: 'ch_c',
      observed: ['cu', 'zi'],
      intended: ['chu', 'zi'],
      targetWord: '初籽',
      distractorWords: ['粗籽', '促籽'],
      toneObs: 'cu1|zi3',
      toneInt: 'chu1|zi3',
    },
    {
      relation: 'eng_en',
      observed: ['chen', 'zi'],
      intended: ['cheng', 'zi'],
      targetWord: '橙籽',
      distractorWords: ['尘籽', '陈籽'],
      toneObs: 'chen2|zi3',
      toneInt: 'cheng2|zi3',
    },
    {
      relation: 'eng_en',
      observed: ['fen', 'zi'],
      intended: ['feng', 'zi'],
      targetWord: '风籽',
      distractorWords: ['分子', '粉籽'],
      toneObs: 'fen1|zi3',
      toneInt: 'feng1|zi3',
    },
    {
      relation: 'in_ing',
      observed: ['xing', 'zi'],
      intended: ['xin', 'zi'],
      targetWord: '心籽',
      distractorWords: ['星籽', '幸籽'],
      toneObs: 'xing1|zi3',
      toneInt: 'xin1|zi3',
    },
    {
      relation: 'in_ing',
      observed: ['ping', 'zi'],
      intended: ['pin', 'zi'],
      targetWord: '拼籽',
      distractorWords: ['平籽', '评籽'],
      toneObs: 'ping1|zi3',
      toneInt: 'pin1|zi3',
    },
    {
      relation: 'in_ing',
      observed: ['ying', 'zi'],
      intended: ['yin', 'zi'],
      targetWord: '音籽',
      distractorWords: ['影子', '盈籽'],
      toneObs: 'ying1|zi3',
      toneInt: 'yin1|zi3',
    },
    {
      relation: 'n_l',
      observed: ['lao', 'shi'],
      intended: ['nao', 'shi'],
      targetWord: '闹市',
      distractorWords: ['老师', '老是'],
      toneObs: 'lao4|shi4',
      toneInt: 'nao4|shi4',
    },
    {
      relation: 'sh_s',
      observed: ['sao', 'zi'],
      intended: ['shao', 'zi'],
      targetWord: '勺籽',
      distractorWords: ['臊籽', '扫籽'],
      toneObs: 'sao2|zi3',
      toneInt: 'shao2|zi3',
    },
  ];

  // Ensure all ACTIVE_SET covered
  const covered = new Set(specs.map((s) => s.relation));
  for (const r of ACTIVE_SET_V1) {
    if (!covered.has(r)) {
      throw new Error(`ACTIVE_SET relation missing from fixture specs: ${r}`);
    }
  }

  specs.forEach((spec, idx) => {
    const caseId = `pta_${spec.relation}_${String(idx + 1).padStart(2, '0')}`;
    const targetId = `m2fix_t_${caseId}`;
    const d0 = `m2fix_d_${caseId}_a`;
    const d1 = `m2fix_d_${caseId}_b`;
    const multiTag = idx % 4 === 0; // every 4th → multi-tag (≥5 across set)
    const domains = multiTag ? (['coffee', 'milk_tea'] as const) : undefined;

    terms.push({
      id: targetId,
      word: spec.targetWord,
      pinyinKey: spec.intended.join('|'),
      tonePinyinKey: spec.toneInt,
      priorScore: 0.99,
      domains,
      role: 'target',
    });
    terms.push({
      id: d0,
      word: spec.distractorWords[0],
      pinyinKey: spec.observed.join('|'),
      tonePinyinKey: spec.toneObs,
      priorScore: 0.9,
      role: 'distractor',
    });
    terms.push({
      id: d1,
      word: spec.distractorWords[1],
      pinyinKey: spec.observed.join('|'),
      tonePinyinKey: spec.toneObs,
      priorScore: 0.88,
      role: 'distractor',
    });

    cases.push({
      case_id: caseId,
      relation: spec.relation,
      observedSyllables: spec.observed,
      windowText: spec.distractorWords[0],
      targetId,
      targetWord: spec.targetWord,
      targetPinyinKey: spec.intended.join('|'),
      distractorIds: [d0, d1],
      phoneticBias: { [spec.relation]: 0.9 },
      multiTag: Boolean(domains),
      domainScope: multiTag ? ['coffee', 'milk_tea', 'food_order'] : ['coffee', 'food_order'],
      observedTonePattern: tonesFromKey(spec.toneObs),
      intendedTonePattern: tonesFromKey(spec.toneInt),
    });
  });

  // Duplicate-merge helper term: same target also as distractor path? We'll add a shared term
  // that exists on BOTH observed and intended for a dedicated merge case (same termId).
  terms.push({
    id: 'm2fix_dup_shared',
    word: '奶子',
    pinyinKey: 'nai|zi',
    tonePinyinKey: 'nai3|zi3',
    priorScore: 0.96,
    role: 'duplicate_base',
  });
  // Also index same id under observed key? Can't — base PK is (pinyin_key, word).
  // For duplicate merge: base recalls term X; profile also returns term X.
  // Seed: target already on intended; add base hit by putting SAME id on observed... 
  // Actually base and profile return same termId from different queries.
  // Put m2fix_dup_shared only on nai|zi; base for lai|zi won't get it.
  // Dedicated merge case: manually inject base candidate with same termId as profile hit.

  return { cases, terms };
}

export function createModel2RuntimeE2EFixture(): Model2E2EFixture {
  if (!fs.existsSync(path.join(MODEL2_E2E_V3_SOURCE, LEXICON_RUNTIME_SQLITE))) {
    throw new Error(`[MODEL2_E2E] missing v3 bundle at ${MODEL2_E2E_V3_SOURCE}`);
  }
  const { cases, terms } = buildProfileTargetAbsentCaseDefs();
  const bundleDir = copyV3BundleToTemp(MODEL2_E2E_V3_SOURCE, 'model2-runtime-e2e-');
  const sqlitePath = path.join(bundleDir, LEXICON_RUNTIME_SQLITE);
  const db = new Database(sqlitePath);
  try {
    const tx = db.transaction((list: FixtureTermSeed[]) => {
      for (const t of list) upsertTerm(db, t);
    });
    tx(terms);
  } finally {
    db.close();
  }
  rewriteChecksum(bundleDir);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundleDir, LEXICON_RUNTIME_MANIFEST), 'utf-8')
  ) as Record<string, unknown>;

  return {
    bundleDir,
    sqlitePath,
    cases,
    manifest: {
      ...manifest,
      TEST_FIXTURE_ONLY: true,
      fixtureTag: FIXTURE_SOURCE_TAG,
      caseCount: cases.length,
      termCount: terms.length,
    },
    cleanup: () => {
      try {
        fs.rmSync(bundleDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
    loadRuntime: () => {
      const runtime = new LexiconRuntimeV2();
      const state = runtime.loadFromBundleDir(bundleDir);
      if (state.status !== 'ok') {
        runtime.close();
        throw new Error(`LexiconRuntimeV2 load failed: ${state.errorMessage ?? state.status}`);
      }
      return runtime;
    },
  };
}
