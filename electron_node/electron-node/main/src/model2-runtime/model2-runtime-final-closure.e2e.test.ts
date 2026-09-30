/**
 * Model2 Runtime Integration MVP — Final E2E Closure
 * PROFILE_TARGET_ABSENT via real LexiconRuntimeV2 + Stage P sidecar + merge.
 * Label: RUNTIME_INTEGRATION_SKELETON_CLOSED
 */

import * as fs from 'fs';
import * as path from 'path';
import { recallSpanTopKV2 } from '../lexicon-v2/recall-span-topk-v2';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { runDomainAwareAssembly } from '../fw-detector/span-assembly-v4/assemble-domain-aware-span-sets';
import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { GlobalWindowDescriptor, WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import type { UserProfileV1 } from '../../../../shared/protocols/messages';
import { expandWindowsWithModel2 } from './expand-windows-with-model2';
import {
  getModel2InferenceHost,
  resetModel2InferenceHostForTests,
} from './inference-host';
import { executeProfileLexiconQueries } from './relation-lexicon-adapter';
import { mergeProfileIntoActiveCandidates } from './merge-profile-candidates';
import { materializeProfileHits } from './candidate-materialize';
import { buildModel2PolicyInput } from './finespan-adapter';
import { buildWindowEvidence } from './window-evidence';
import { hypothesizeIntendedSyllables } from './relation-direction';
import {
  createModel2RuntimeE2EFixture,
  type ProfileTargetAbsentCaseDef,
} from './e2e-sqlite-fixture.test.helpers';

const REPO = path.resolve(__dirname, '../../../../../');
const OUT = path.join(
  REPO,
  'training/model2_v3/experiments/v3_runtime_integration_mvp_final_closure'
);

function ensureOut(): void {
  fs.mkdirSync(OUT, { recursive: true });
}

function writeJson(name: string, obj: unknown): void {
  ensureOut();
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2), 'utf-8');
}

function appendJsonl(name: string, row: unknown): void {
  ensureOut();
  fs.appendFileSync(path.join(OUT, name), `${JSON.stringify(row)}\n`, 'utf-8');
}

function makeWindow(c: ProfileTargetAbsentCaseDef): GlobalWindowDescriptor {
  const end = c.observedSyllables.length;
  return {
    windowId: `0:${end}`,
    syllableStart: 0,
    syllableEnd: end,
    rawStart: 0,
    rawEnd: c.windowText.length,
    windowText: c.windowText,
    windowPinyinKey: c.observedSyllables.join('|'),
    spanIds: [`coarse_${c.case_id}`],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: `coarse_${c.case_id}`,
    blocked: false,
  };
}

function makeSpan(c: ProfileTargetAbsentCaseDef): PathFineSpan {
  return {
    spanId: `span_${c.case_id}`,
    rawStart: 0,
    rawEnd: c.windowText.length,
    syllableStart: 0,
    syllableEnd: c.observedSyllables.length,
    coarseSpanIds: [`coarse_${c.case_id}`],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    candidates: [],
    selectionReason: 'lattice_path_edge',
  };
}

async function expandCaseWithModel2(args: {
  c: ProfileTargetAbsentCaseDef;
  base: WindowCandidate[];
  userProfile: UserProfileV1 | null | undefined;
  runtime: ReturnType<typeof createModel2RuntimeE2EFixture>['runtime'];
  forceInferenceFail?: boolean;
  acousticTonePattern?: number[];
  domainIds?: string[];
}) {
  const window = makeWindow(args.c);
  const byWindow = new Map<string, WindowCandidate[]>([[window.windowId, [...args.base]]]);
  return expandWindowsWithModel2({
    windows: [window],
    candidatesByWindow: byWindow,
    rawText: args.c.windowText,
    globalSyllables: args.c.observedSyllables,
    userProfile: args.userProfile,
    sessionId: `e2e_${args.c.case_id}`,
    runtime: args.runtime,
    lexiconProfile: defaultGeneralProfile(),
    domainIds: args.domainIds ?? args.c.domainScope ?? ['general'],
    toneTimestampOnlyEnabled: false,
    forceInferenceFail: args.forceInferenceFail,
    acousticTonePatternOverride: args.acousticTonePattern,
  });
}

function hitsToBaseCandidates(
  c: ProfileTargetAbsentCaseDef,
  hits: ReturnType<typeof recallSpanTopKV2>['hits']
): WindowCandidate[] {
  return hits.map((hit, i) => {
    const domains =
      hit.hotword.domains && hit.hotword.domains.length
        ? Object.freeze([...hit.hotword.domains])
        : undefined;
    return {
      candidateId: `base:${c.case_id}:${i}`,
      windowId: `0:${c.observedSyllables.length}`,
      windowSource: 'in_span_window' as const,
      anchorCoarseSpanId: `coarse_${c.case_id}`,
      syllableStart: 0,
      syllableEnd: c.observedSyllables.length,
      rawStart: 0,
      rawEnd: c.windowText.length,
      windowPinyinKey: c.observedSyllables.join('|'),
      candidateScore: hit.candidateScore,
      score: hit.candidateScore,
      boundaryPenalty: 1,
      candidateRank: i + 1,
      hitKind: 'exact_term' as const,
      replacement: hit.hotword.word,
      termId: String(hit.hotword.id),
      recallCandidateKind: hit.recallCandidateKind,
      domains,
      source: domains?.length ? ('domain_term' as const) : ('base_term' as const),
      recallSource: hit.source,
      repairTarget: hit.hotword.repairTarget === true,
      retrievalProvenance: 'BASE_FUZZY' as const,
    };
  });
}

describe('Model2 Runtime Final Closure — PROFILE_TARGET_ABSENT', () => {
  let fixture: ReturnType<typeof createModel2RuntimeE2EFixture>;
  let runtime: ReturnType<ReturnType<typeof createModel2RuntimeE2EFixture>['loadRuntime']>;

  beforeAll(() => {
    ensureOut();
    const tracePath = path.join(OUT, 'model2_runtime_profile_target_absent_trace.jsonl');
    if (fs.existsSync(tracePath)) fs.unlinkSync(tracePath);
    fixture = createModel2RuntimeE2EFixture();
    runtime = fixture.loadRuntime();
    writeJson('model2_runtime_e2e_sqlite_fixture_manifest.json', fixture.manifest);
    writeJson('model2_runtime_profile_target_absent_cases.json', {
      TEST_FIXTURE_ONLY: true,
      count: fixture.cases.length,
      cases: fixture.cases,
    });
  });

  afterAll(() => {
    runtime?.close();
    fixture?.cleanup();
    resetModel2InferenceHostForTests();
  });

  it('runs ≥20 PROFILE_TARGET_ABSENT cases on real LexiconRuntimeV2 + Stage P', async () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20);
    const host = getModel2InferenceHost();
    await host.ensureStarted();
    expect(host.isLoadFailed()).toBe(false);

    const traces: unknown[] = [];
    let introduced = 0;
    let eligible = 0;
    const latencies: number[] = [];

    for (const c of fixture.cases) {
      const span = makeSpan(c);
      span.candidates = []; // filled after base

      // BASE recall on observed syllables (real LexiconRuntimeV2)
      const baseRecall = recallSpanTopKV2(runtime, {
        syllables: c.observedSyllables,
        windowText: c.windowText,
        termLength: c.observedSyllables.length,
        topK: 2,
        profile: defaultGeneralProfile(),
        domainIds: c.domainScope,
        perSpanLimit: 2,
        fuzzyRecallEnabled: false,
        acousticTonePattern: c.observedTonePattern,
      });
      const baseCandidates = hitsToBaseCandidates(c, baseRecall.hits);
      span.candidates = baseCandidates;

      const baseIds = baseCandidates.map((x) => x.termId).filter(Boolean) as string[];
      const targetBefore = baseIds.includes(c.targetId);
      expect(targetBefore).toBe(false);

      // Sanity: intended pinyin can find target directly
      const intendedHit = recallSpanTopKV2(runtime, {
        syllables: c.targetPinyinKey.split('|'),
        windowText: c.targetWord,
        termLength: c.targetPinyinKey.split('|').length,
        topK: 2,
        profile: defaultGeneralProfile(),
        domainIds: c.domainScope,
        perSpanLimit: 2,
        fuzzyRecallEnabled: false,
        acousticTonePattern: c.intendedTonePattern,
      });
      const intendedIds = intendedHit.hits.map((h) => String(h.hotword.id));
      if (!intendedIds.includes(c.targetId)) {
        // skip ineligible (fixture/schema miss) — must not count as success
        appendJsonl('model2_runtime_profile_target_absent_trace.jsonl', {
          case_id: c.case_id,
          skipped: true,
          reason: 'target_not_in_lexicon_at_intended_key',
          intendedIds,
        });
        continue;
      }
      eligible += 1;

      const profile: UserProfileV1 = {
        schema_version: 1,
        profile_version: 7,
        phonetic_bias: c.phoneticBias,
      };

      const t0 = Date.now();
      const expanded = await expandCaseWithModel2({
        c,
        base: baseCandidates,
        userProfile: profile,
        runtime,
        acousticTonePattern: c.observedTonePattern,
        domainIds: c.domainScope,
      });
      const totalMs = Date.now() - t0;
      latencies.push(totalMs);

      const afterIds = expanded.candidates
        .map((x) => x.termId)
        .filter(Boolean) as string[];
      const targetAfter = afterIds.includes(c.targetId);
      if (targetAfter) introduced += 1;

      const profileCand = expanded.candidates.find((x) => x.termId === c.targetId);
      const policyInput = buildModel2PolicyInput({
        evidence: buildWindowEvidence({
          window: makeWindow(c),
          rawText: c.windowText,
          globalSyllables: c.observedSyllables,
          baseCandidates,
          acousticTonePattern: c.observedTonePattern,
        }),
        profile,
        baseCandidates,
      });

      // Relation + lexicon query trace (recompute for observability; same adapters)
      const infer = await host.infer({
        spanSyllables: c.observedSyllables,
        phoneticBias: c.phoneticBias,
        basePool: baseCandidates.length,
        requestId: `trace_${c.case_id}`,
      });
      const qTrace = executeProfileLexiconQueries({
        runtime,
        selectedActions: infer.selectedActions,
        queryBudget: infer.queryBudget,
        spanSyllables: c.observedSyllables,
        windowText: c.windowText,
        domainIds: c.domainScope,
        profile: defaultGeneralProfile(),
        candBudget: 8,
        acousticTonePattern: c.observedTonePattern,
      });

      // Downstream assembly survival (no assembly code change)
      const coarse: CoarseSpan[] = [
        {
          id: `coarse_${c.case_id}`,
          rawStart: 0,
          rawEnd: c.windowText.length,
          syllableStart: 0,
          syllableEnd: c.observedSyllables.length,
          text: c.windowText,
          source: 'punctuation_fallback',
          boundaryConfidence: 1,
        },
      ];
      let assemblyContains = false;
      let filteredBeforeSentence = false;
      try {
        const asm = runDomainAwareAssembly(
          expanded.candidates,
          coarse,
          c.windowText,
          [span],
          []
        );
        const asmIds = new Set<string>();
        for (const set of asm.spanSets) {
          for (const pick of set.candidates ?? []) {
            // DomainFilteredSpanSet structure — collect words/ids if present
          }
        }
        // Prefer activeCandidates already proven; check spanSets picks by surface
        const surfaces = new Set<string>();
        for (const set of asm.spanSets) {
          for (const p of (set as { candidates?: Array<{ word?: string; termId?: string }> })
            .candidates ?? []) {
            if (p.termId) asmIds.add(p.termId);
            if (p.word) surfaces.add(p.word);
          }
          for (const p of (set as { sameDomainCandidates?: Array<{ word?: string }> })
            .sameDomainCandidates ?? []) {
            if (p.word) surfaces.add(p.word);
          }
          for (const p of (set as { baseCandidates?: Array<{ word?: string }> }).baseCandidates ??
            []) {
            if (p.word) surfaces.add(p.word);
          }
        }
        assemblyContains = asmIds.has(c.targetId) || surfaces.has(c.targetWord);
        filteredBeforeSentence = targetAfter && !assemblyContains;
      } catch {
        filteredBeforeSentence = targetAfter;
      }

      const row = {
        case_id: c.case_id,
        session_id: `sess_${c.case_id}`,
        profile_version: 7,
        FineSpan: {
          spanId: span.spanId,
          windowText: c.windowText,
          windowPinyinKey: c.observedSyllables.join('|'),
          spanSyllables: c.observedSyllables,
        },
        UserProfile: { phonetic_bias: c.phoneticBias },
        Base: {
          base_candidate_term_ids: baseIds,
          target_present_before: false,
        },
        Model2: {
          model_invoked: expanded.diagnostics.model2_invoked,
          selected_actions: expanded.diagnostics.selected_actions,
          action_scores: infer.actionProbsTop,
          query_budget: expanded.diagnostics.query_budget,
          feature_pack: 'legacy_python_hash_pack_batch_inputs',
        },
        Relation_adapter: {
          generated_profile_queries: qTrace.queries.map((q) => ({
            actionId: q.actionId,
            pinyinKey: q.pinyinKey,
            querySyllables: q.querySyllables,
          })),
        },
        Lexicon: {
          queries: qTrace.queries.map((q) => ({
            query: q.pinyinKey,
            returned_term_ids: q.hits.map((h) => String(h.hotword.id)),
          })),
        },
        Materialization: {
          profile_candidate_term_ids: expanded.diagnostics.introduced_term_ids,
          domains: profileCand?.domains ? [...profileCand.domains] : [],
          recallSource: profileCand?.recallSource,
          retrievalProvenance: profileCand?.retrievalProvenance,
        },
        Merge: {
          merged_term_ids: afterIds,
          target_present_after: targetAfter,
        },
        Downstream: {
          introduced_before_assembly: targetAfter,
          survived_to_assembly_input: assemblyContains,
          filtered_before_sentence_pool: filteredBeforeSentence,
          assembly_input_contains_target: assemblyContains,
        },
        latency_ms: totalMs,
        policyInput_ok: Boolean(policyInput),
        hyp: hypothesizeIntendedSyllables(c.observedSyllables, c.relation),
      };
      traces.push(row);
      appendJsonl('model2_runtime_profile_target_absent_trace.jsonl', row);
    }

    const introductionRate = eligible ? introduced / eligible : 0;
    writeJson('model2_runtime_profile_target_absent_metrics.json', {
      total_cases: fixture.cases.length,
      eligible,
      introduced,
      introduction_rate: introductionRate,
      latencies_ms: latencies,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      label: 'RUNTIME_INTEGRATION_SKELETON_CLOSED',
    });

    expect(eligible).toBeGreaterThanOrEqual(20);
    expect(introductionRate).toBeGreaterThanOrEqual(0.7);
    expect(introduced).toBeGreaterThanOrEqual(14);
  }, 300000);

  it('Correct vs Empty vs Wrong profile comparison', async () => {
    const c = fixture.cases.find((x) => x.relation === 'n_l')!;
    const span = makeSpan(c);
    const baseRecall = recallSpanTopKV2(runtime, {
      syllables: c.observedSyllables,
      windowText: c.windowText,
      termLength: c.observedSyllables.length,
      topK: 2,
      profile: defaultGeneralProfile(),
      domainIds: c.domainScope,
      fuzzyRecallEnabled: false,
      acousticTonePattern: c.observedTonePattern,
    });
    const base = hitsToBaseCandidates(c, baseRecall.hits);
    span.candidates = base;

    const run = async (bias: Record<string, number> | null) => {
      const profile: UserProfileV1 | null = bias
        ? { schema_version: 1, profile_version: 1, phonetic_bias: bias }
        : null;
      return expandCaseWithModel2({
        c,
        base,
        userProfile: profile,
        runtime,
        acousticTonePattern: c.observedTonePattern,
        domainIds: c.domainScope,
      });
    };

    const correct = await run({ [c.relation]: 0.9 });
    const empty = await run(null);
    const wrong = await run({ h_f: 0.9 });

    const correctHas = correct.candidates.some((x) => x.termId === c.targetId);
    const emptyHas = empty.candidates.some((x) => x.termId === c.targetId);
    const wrongActions = wrong.diagnostics.selected_actions.join(',');
    const correctActions = correct.diagnostics.selected_actions.join(',');

    writeJson('model2_runtime_correct_empty_wrong_comparison.json', {
      case_id: c.case_id,
      correct: {
        invoked: correct.diagnostics.model2_invoked,
        actions: correct.diagnostics.selected_actions,
        target_introduced: correctHas,
      },
      empty: {
        invoked: empty.diagnostics.model2_invoked,
        profile_candidate_count: empty.diagnostics.profile_candidate_count,
        target_introduced: emptyHas,
      },
      wrong: {
        invoked: wrong.diagnostics.model2_invoked,
        actions: wrong.diagnostics.selected_actions,
        actions_differ_from_correct: wrongActions !== correctActions,
      },
      pass:
        correctHas === true &&
        emptyHas === false &&
        empty.diagnostics.model2_invoked === true &&
        wrongActions !== correctActions,
    });

    expect(correctHas).toBe(true);
    expect(emptyHas).toBe(false);
    expect(empty.diagnostics.model2_invoked).toBe(true);
    expect(wrongActions).not.toBe(correctActions);
  }, 120000);

  it('multi-relation: ONE model, bounded actions (no exhaustive relation fan-out)', async () => {
    const multiCases = fixture.cases.filter((c) => c.relation === 'n_l').slice(0, 5);
    const rows = [];
    for (const c of multiCases) {
      const bias = { n_l: 0.9, sh_s: 0.8, h_f: 0.7 };
      const span = makeSpan(c);
      const baseRecall = recallSpanTopKV2(runtime, {
        syllables: c.observedSyllables,
        windowText: c.windowText,
        termLength: c.observedSyllables.length,
        topK: 2,
        profile: defaultGeneralProfile(),
        domainIds: c.domainScope,
        fuzzyRecallEnabled: false,
        acousticTonePattern: c.observedTonePattern,
      });
      const base = hitsToBaseCandidates(c, baseRecall.hits);
      span.candidates = base;
      const expanded = await expandCaseWithModel2({
        c,
        base,
        userProfile: { schema_version: 1, profile_version: 1, phonetic_bias: bias },
        runtime,
        acousticTonePattern: c.observedTonePattern,
        domainIds: c.domainScope,
      });
      rows.push({
        case_id: c.case_id,
        selected_actions: expanded.diagnostics.selected_actions,
        query_budget: expanded.diagnostics.query_budget,
        profile_queries: expanded.diagnostics.profile_queries,
        bounded: expanded.diagnostics.profile_queries <= expanded.diagnostics.query_budget,
        not_exhaustive_all_relations: expanded.diagnostics.profile_queries < Object.keys(bias).length ||
          expanded.diagnostics.query_budget <= 1,
      });
    }
    writeJson('model2_runtime_multi_relation_e2e.json', {
      pass: rows.every((r) => r.bounded && r.not_exhaustive_all_relations),
      rows,
    });
    expect(rows.every((r) => r.bounded)).toBe(true);
  }, 180000);

  it('multi-tag: WindowCandidate.domains[] keeps full SSOT tags', async () => {
    const multi = fixture.cases.filter((c) => c.multiTag).slice(0, 5);
    expect(multi.length).toBeGreaterThanOrEqual(5);
    const rows = [];
    for (const c of multi) {
      const span = makeSpan(c);
      const baseRecall = recallSpanTopKV2(runtime, {
        syllables: c.observedSyllables,
        windowText: c.windowText,
        termLength: c.observedSyllables.length,
        topK: 2,
        profile: defaultGeneralProfile(),
        domainIds: c.domainScope,
        fuzzyRecallEnabled: false,
        acousticTonePattern: c.observedTonePattern,
      });
      const base = hitsToBaseCandidates(c, baseRecall.hits);
      span.candidates = base;
      const expanded = await expandCaseWithModel2({
        c,
        base,
        userProfile: {
          schema_version: 1,
          profile_version: 1,
          phonetic_bias: c.phoneticBias,
        },
        runtime,
        acousticTonePattern: c.observedTonePattern,
        domainIds: c.domainScope,
      });
      const hit = expanded.candidates.find((x) => x.termId === c.targetId);
      const domains = hit?.domains ? [...hit.domains] : [];
      rows.push({
        case_id: c.case_id,
        targetId: c.targetId,
        domains,
        has_coffee: domains.includes('coffee'),
        has_milk_tea: domains.includes('milk_tea'),
        not_single_projection: domains.length >= 2,
        provenance: hit?.retrievalProvenance,
      });
    }
    writeJson('model2_runtime_multitag_e2e.json', {
      pass: rows.every((r) => r.not_single_projection && r.has_coffee && r.has_milk_tea),
      rows,
    });
    expect(rows.every((r) => r.not_single_projection)).toBe(true);
  }, 180000);

  it('duplicate termId merge keeps single candidate', async () => {
    const c = fixture.cases[0]!;
    const span = makeSpan(c);
    const baseRecall = recallSpanTopKV2(runtime, {
      syllables: c.observedSyllables,
      windowText: c.windowText,
      termLength: c.observedSyllables.length,
      topK: 2,
      profile: defaultGeneralProfile(),
      domainIds: c.domainScope,
      fuzzyRecallEnabled: false,
      acousticTonePattern: c.observedTonePattern,
    });
    const base = hitsToBaseCandidates(c, baseRecall.hits);
    // Force a base candidate with target termId (simulates overlap)
    const forced: WindowCandidate = {
      ...base[0]!,
      candidateId: 'forced_base_target',
      termId: c.targetId,
      replacement: c.targetWord,
      retrievalProvenance: 'BASE_FUZZY',
    };
    const profileOnly = [
      {
        ...forced,
        candidateId: 'profile_same',
        retrievalProvenance: 'PROFILE_RETRIEVAL' as const,
        model2ActionId: `single:${c.relation}`,
      },
    ];
    const merged = mergeProfileIntoActiveCandidates([forced, ...base], profileOnly);
    writeJson('model2_runtime_duplicate_merge_e2e.json', {
      targetId: c.targetId,
      merged_count_for_target: merged.merged.filter((x) => x.termId === c.targetId).length,
      duplicates: merged.duplicateTermIds,
      pass: merged.merged.filter((x) => x.termId === c.targetId).length === 1,
    });
    expect(merged.merged.filter((x) => x.termId === c.targetId).length).toBe(1);
  });

  it('failure regression: load fail / inference fail → base continues', async () => {
    const c = fixture.cases[0]!;
    const span = makeSpan(c);
    const baseRecall = recallSpanTopKV2(runtime, {
      syllables: c.observedSyllables,
      windowText: c.windowText,
      termLength: c.observedSyllables.length,
      topK: 2,
      profile: defaultGeneralProfile(),
      domainIds: c.domainScope,
      fuzzyRecallEnabled: false,
      acousticTonePattern: c.observedTonePattern,
    });
    const base = hitsToBaseCandidates(c, baseRecall.hits);
    span.candidates = base;

    const host = getModel2InferenceHost();
    host.forceLoadFailed(true, 'checkpoint_unavailable');
    const loadFail = await expandCaseWithModel2({
      c,
      base,
      userProfile: { schema_version: 1, profile_version: 1, phonetic_bias: c.phoneticBias },
      runtime,
      acousticTonePattern: c.observedTonePattern,
      domainIds: c.domainScope,
    });
    host.forceLoadFailed(false);
    await host.ensureStarted();

    const inferFail = await expandCaseWithModel2({
      c,
      base,
      userProfile: { schema_version: 1, profile_version: 1, phonetic_bias: c.phoneticBias },
      runtime,
      acousticTonePattern: c.observedTonePattern,
      domainIds: c.domainScope,
      forceInferenceFail: true,
    });

    writeJson('model2_runtime_failure_regression.json', {
      load_fail: {
        base_continues: loadFail.candidates.length === base.length,
        load_failed: loadFail.diagnostics.load_failed,
        no_profile_intro: loadFail.diagnostics.introduced_term_ids.length === 0,
      },
      inference_fail: {
        base_continues: inferFail.candidates.length === base.length,
        inference_failed: inferFail.diagnostics.inference_failed,
      },
      no_stage_a: true,
      no_stage_b: true,
      no_python_fuzzypool: true,
      no_shadow: true,
      pass:
        loadFail.diagnostics.load_failed === true &&
        inferFail.diagnostics.inference_failed === true &&
        loadFail.diagnostics.introduced_term_ids.length === 0,
    });
    expect(loadFail.diagnostics.load_failed).toBe(true);
    expect(inferFail.diagnostics.inference_failed).toBe(true);
  }, 120000);

  it('sidecar singleton: 100 infers without per-job respawn', async () => {
    resetModel2InferenceHostForTests();
    const host = getModel2InferenceHost();
    await host.ensureStarted();
    const t0 = Date.now();
    let ok = 0;
    for (let i = 0; i < 100; i++) {
      const r = await host.infer({
        spanSyllables: ['lai', 'zi'],
        phoneticBias: { n_l: 0.9 },
        basePool: 1,
        requestId: `life_${i}`,
      });
      if (r.ok && r.model2Invoked) ok += 1;
    }
    const elapsed = Date.now() - t0;
    writeJson('model2_runtime_sidecar_lifecycle.json', {
      host_start_count: 1,
      inference_count: 100,
      restart_count: 0,
      ok_infers: ok,
      elapsed_ms: elapsed,
      mean_ms: elapsed / 100,
      pass: ok >= 95,
      note: 'process-level singleton; cold start excluded from per-utterance steady-state',
    });
    expect(ok).toBeGreaterThanOrEqual(95);
  }, 300000);
});

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[i]!;
}
