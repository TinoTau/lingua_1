/**
 * Model2 pre-LexicalEdge window expansion (Aug-12 SSOT).
 * ONE production stage: after Base Recall, before buildLexicalEdges.
 * Per GlobalWindowDescriptor: P actions + D action; soft-fail continues with Base.
 */

import type { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import type { GlobalWindowDescriptor, WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { AcousticToneSlice, WordTimeSpan } from '../fw-detector/tone-time-align';
import { extractAcousticTonePatternForRecall } from '../fw-detector/span-assembly-shared/tone-recall';
import type { UserProfileV1 } from '../../../../shared/protocols/messages';
import { buildModel2PolicyInput } from './finespan-adapter';
import { getModel2InferenceHost } from './inference-host';
import { executeProfileLexiconQueries } from './relation-lexicon-adapter';
import {
  domainHitBindingStatus,
  materializeDomainHits,
  materializeProfileHits,
  tagBaseProvenance,
} from './candidate-materialize';
import { mergeProfileIntoWindowCandidates } from './merge-profile-candidates';
import { buildWindowEvidence, type WindowEvidence } from './window-evidence';
import type {
  Model2ExpandDiagnostics,
  Model2ExpandResult,
  Model2StageJObservability,
} from './types';
import {
  compactCandidates,
  compactCandidate,
  compactWindowEvidence,
  isDialog200PathTraceEnabled,
  profileInputSummary,
} from './dialog200-path-trace';
import { isFrozenEvidenceCaptureV2Enabled } from '../capture-v2';
import {
  RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
  upsertRecallQueryEvidence,
  type RecallQueryEvidence,
} from '../lexicon-v2/recall-query-evidence';
import logger from '../logger';

const TONE_NOT_READY_STATES = new Set([
  'no_pattern',
  'invalid_pattern',
  'caller_disabled',
  'runtime_unsupported',
]);

function buildStageJObservability(args: {
  model2Invoked: boolean;
  selectedActions: readonly string[];
  domainDecisionReached: boolean;
  domainNone: boolean;
  domainAction: string | null;
  acousticTonePatternPresent: boolean;
  toneRecallReadiness: string | null;
  pRetrievalQueriesRun: boolean;
  pRetrievalHitCount: number;
  pMaterializedCount: number;
  dHitCount: number;
  dMaterializedCount: number;
  inferenceFailed?: boolean;
  loadFailed?: boolean;
  failureReason?: string | null;
  unicodeSanitized?: boolean;
  sanitizedStringCount?: number;
  sanitizedCodeUnitCount?: number;
  sanitizationOwner?: string | null;
}): Model2StageJObservability {
  const selectedIds = [...new Set(args.selectedActions.filter(Boolean))];
  let p_retrieval_status: Model2StageJObservability['p_retrieval_status'];
  if (args.loadFailed) {
    p_retrieval_status = 'MODEL2_LOAD_FAILED';
  } else if (args.inferenceFailed) {
    p_retrieval_status = 'MODEL2_INFERENCE_FAILED';
  } else if (!args.model2Invoked) {
    p_retrieval_status = 'MODEL2_NOT_INVOKED';
  } else if (selectedIds.length === 0) {
    p_retrieval_status = 'NO_P_ACTION';
  } else if (!args.pRetrievalQueriesRun) {
    p_retrieval_status = 'P_RETRIEVAL_NOT_RUN';
  } else if (
    args.toneRecallReadiness &&
    TONE_NOT_READY_STATES.has(args.toneRecallReadiness)
  ) {
    p_retrieval_status = 'P_RETRIEVAL_TONE_NOT_READY';
  } else if (args.pRetrievalHitCount <= 0) {
    p_retrieval_status = 'P_RETRIEVAL_RUN_EMPTY';
  } else {
    p_retrieval_status = 'P_RETRIEVAL_RUN_HIT';
  }

  const decisionOk = args.model2Invoked && !args.inferenceFailed && !args.loadFailed;

  return {
    selected_action_count: selectedIds.length,
    selected_action_ids: selectedIds,
    domain_none: decisionOk && args.domainDecisionReached ? args.domainNone : null,
    domain_action:
      decisionOk && args.domainDecisionReached && !args.domainNone ? args.domainAction : null,
    acousticTonePattern_present: args.acousticTonePatternPresent,
    toneRecallReadiness: args.toneRecallReadiness,
    p_retrieval_status,
    p_retrieval_hit_count: args.pRetrievalHitCount,
    p_materialized_count: args.pMaterializedCount,
    d_hit_count: args.dHitCount,
    d_materialized_count: args.dMaterializedCount,
    p_added: args.pMaterializedCount,
    d_added: args.dMaterializedCount,
    inference_failed: Boolean(args.inferenceFailed),
    load_failed: Boolean(args.loadFailed),
    failure_reason: args.failureReason ?? null,
    profile_unicode_sanitized: Boolean(args.unicodeSanitized),
    sanitized_string_count: args.sanitizedStringCount ?? 0,
    sanitized_code_unit_count: args.sanitizedCodeUnitCount ?? 0,
    sanitization_owner: args.sanitizationOwner ?? null,
  };
}

const emptyDiag = (
  partial: Partial<Model2ExpandDiagnostics> & {
    profile_available: boolean;
    reason?: string;
  }
): Model2ExpandDiagnostics => {
  const base: Model2ExpandDiagnostics = {
    model2_invoked: false,
    selected_actions: [],
    query_budget: 0,
    profile_queries: 0,
    profile_candidate_count: 0,
    introduced_term_ids: [],
    merged_candidate_count: 0,
    model_latency_ms: 0,
    lexicon_latency_ms: 0,
    feature_build_ms: 0,
    domain_action: null,
    domain_none: true,
    domain_candidates_added: 0,
    pronunciation_candidates_added: 0,
    label: 'STAGE_J_RUNTIME_CHECKPOINT_SWAP',
    ...partial,
  };
  if (!base.observability) {
    base.observability = buildStageJObservability({
      model2Invoked: base.model2_invoked,
      selectedActions: base.selected_actions,
      domainDecisionReached: false,
      domainNone: true,
      domainAction: null,
      acousticTonePatternPresent: false,
      toneRecallReadiness: null,
      pRetrievalQueriesRun: false,
      pRetrievalHitCount: 0,
      pMaterializedCount: base.pronunciation_candidates_added ?? 0,
      dHitCount: 0,
      dMaterializedCount: base.domain_candidates_added ?? 0,
      inferenceFailed: base.inference_failed,
      loadFailed: base.load_failed,
      failureReason: base.reason ?? null,
    });
  }
  return base;
};

function resolveWindowLocalTone(args: {
  window: GlobalWindowDescriptor;
  acousticSlices?: AcousticToneSlice[];
  wordTimeSpans?: WordTimeSpan[];
  toneTimestampOnlyEnabled?: boolean;
}): number[] | null {
  if (
    !args.toneTimestampOnlyEnabled ||
    !args.acousticSlices?.length ||
    !args.wordTimeSpans?.length
  ) {
    return null;
  }
  const extracted = extractAcousticTonePatternForRecall(
    args.window.rawStart,
    args.window.rawEnd,
    args.window.syllableStart,
    args.window.syllableEnd,
    args.acousticSlices,
    args.wordTimeSpans
  );
  return extracted.pattern && extracted.pattern.length > 0 ? extracted.pattern : null;
}

export type ExpandWindowsWithModel2Result = {
  /** Unified candidates flattened (all windows). */
  candidates: WindowCandidate[];
  /** Per-window merged pools (mutates/replaces map values). */
  candidatesByWindow: Map<string, WindowCandidate[]>;
  diagnostics: Model2ExpandDiagnostics;
  /**
   * Utterance-local Recall query evidence (ACP V1). Independent of candidate survival.
   * Emitted when Model2-conditioned queries actually enter recallSpanTopKV2 (hit optional).
   */
  recallQueryEvidence: readonly RecallQueryEvidence[];
};

/**
 * Expand overlapping lexical windows with Model2 P(+D) and merge into Base pools.
 * Does not own PathFineSpan / compatibility / assembly.
 */
export async function expandWindowsWithModel2(args: {
  windows: readonly GlobalWindowDescriptor[];
  candidatesByWindow: Map<string, WindowCandidate[]>;
  rawText: string;
  globalSyllables: readonly string[];
  userProfile: UserProfileV1 | null | undefined;
  sessionId?: string;
  runtime: LexiconRuntimeV2;
  lexiconProfile: ActiveLexiconProfileSnapshot;
  domainIds: readonly string[];
  acousticSlices?: AcousticToneSlice[];
  wordTimeSpans?: WordTimeSpan[];
  toneTimestampOnlyEnabled?: boolean;
  forceInferenceFail?: boolean;
  /**
   * Test harness only: when a single window has no acoustic slices, inject this
   * window-local tone pattern. Production must not pass this.
   */
  acousticTonePatternOverride?: number[];
}): Promise<ExpandWindowsWithModel2Result> {
  const flatBase: WindowCandidate[] = [];
  for (const w of args.windows) {
    flatBase.push(...(args.candidatesByWindow.get(w.windowId) ?? []));
  }
  tagBaseProvenance(flatBase);

  const host = getModel2InferenceHost();
  await host.ensureStarted({ lexiconSqlite: args.runtime.getSqlitePath() ?? undefined });

  const recallQueryEvidence: RecallQueryEvidence[] = [];
  const failSoft = (diag: Model2ExpandDiagnostics): ExpandWindowsWithModel2Result => ({
    candidates: flatBase,
    candidatesByWindow: args.candidatesByWindow,
    diagnostics: diag,
    recallQueryEvidence: Object.freeze([...recallQueryEvidence]),
  });

  if (host.isLoadFailed()) {
    logger.warn({ error: host.getLoadError() }, '[Model2] load failed — continue base recall');
    return failSoft(
      emptyDiag({
        profile_available: Boolean(args.userProfile),
        load_failed: true,
        reason: host.getLoadError() || 'load_failed',
        merged_candidate_count: flatBase.length,
      })
    );
  }

  if (args.forceInferenceFail) {
    return failSoft(
      emptyDiag({
        profile_available: Boolean(args.userProfile),
        inference_failed: true,
        reason: 'forced_inference_fail',
        merged_candidate_count: flatBase.length,
      })
    );
  }

  const profileHits: WindowCandidate[] = [];
  const selectedAll: string[] = [];
  let queryBudget = 0;
  let profileQueries = 0;
  let modelLatency = 0;
  let lexiconLatency = 0;
  let featureBuildMs = 0;
  let invoked = false;
  let seq = 0;
  let lastDomainAction: string | null = null;
  let lastDomainNone = true;
  let anyDomainActionSelected = false;
  let lastNonNoneDomainAction: string | null = null;
  let domainDecisionReached = false;
  let domainAdded = 0;
  let pronunciationAdded = 0;
  let sha256: string | undefined;
  const traceEnabled = isDialog200PathTraceEnabled();
  const captureV2On = isFrozenEvidenceCaptureV2Enabled();
  const observeWindows = traceEnabled || captureV2On;
  const windowTraces: Record<string, unknown>[] = [];
  let inferenceSeq = 0;
  let acousticTonePatternPresent = false;
  let pRetrievalHitCount = 0;
  let pRetrievalQueriesRun = false;
  let toneRecallReadinessState: string | null = null;
  let dHitCount = 0;
  let unicodeSanitized = false;
  let sanitizedStringCount = 0;
  let sanitizedCodeUnitCount = 0;
  let sanitizationOwner: string | null = null;

  for (const window of args.windows) {
    const baseForWindow = [...(args.candidatesByWindow.get(window.windowId) ?? [])];
    const localTone =
      resolveWindowLocalTone({
        window,
        acousticSlices: args.acousticSlices,
        wordTimeSpans: args.wordTimeSpans,
        toneTimestampOnlyEnabled: args.toneTimestampOnlyEnabled,
      }) ??
      (args.windows.length === 1 &&
      Array.isArray(args.acousticTonePatternOverride) &&
      args.acousticTonePatternOverride.length > 0
        ? args.acousticTonePatternOverride
        : null);
    const evidence: WindowEvidence = buildWindowEvidence({
      window,
      rawText: args.rawText,
      globalSyllables: args.globalSyllables,
      baseCandidates: baseForWindow,
      acousticTonePattern: localTone,
    });
    if (!evidence.spanSyllables.length) {
      if (observeWindows) {
        windowTraces.push({
          window_id: window.windowId,
          model2_inference_id: null,
          reason: 'NO_SYLLABLES',
          window: compactWindowEvidence(evidence),
        });
      }
      continue;
    }

    const tFeat = Date.now();
    const policyInput = buildModel2PolicyInput({
      evidence,
      profile: args.userProfile,
      sessionId: args.sessionId,
      baseCandidates: baseForWindow,
    });
    featureBuildMs += Date.now() - tFeat;
    if (!policyInput) {
      if (observeWindows) {
        windowTraces.push({
          window_id: window.windowId,
          model2_inference_id: null,
          reason: 'NO_POLICY_INPUT',
          window: compactWindowEvidence(evidence),
        });
      }
      continue;
    }

    let infer;
    try {
      infer = await host.infer({
        spanSyllables: policyInput.spanSyllables,
        phoneticBias: policyInput.phoneticBias,
        basePool: policyInput.basePool,
        requestId: `${args.sessionId || 's'}:${policyInput.spanId}`,
        personalTerms: policyInput.personalTerms,
        longTermDomainEvidence: policyInput.longTermDomainEvidence,
        personalTermEvidence: policyInput.personalTermEvidence,
        windowText: policyInput.windowText,
        windowPinyinKey: policyInput.windowPinyinKey,
        spanId: policyInput.spanId,
        syllableStart: policyInput.syllableStart,
        syllableEnd: policyInput.syllableEnd,
        rawStart: policyInput.rawStart,
        rawEnd: policyInput.rawEnd,
        baseHits: baseForWindow.map((c) => ({
          surface: c.replacement,
          replacement: c.replacement,
          pinyin_key: c.windowPinyinKey,
          term_id: c.termId,
        })),
      });
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e), windowId: window.windowId },
        '[Model2] inference exception — continue base'
      );
      return failSoft(
        emptyDiag({
          profile_available: Boolean(args.userProfile),
          inference_failed: true,
          reason: e instanceof Error ? e.message : String(e),
          merged_candidate_count: flatBase.length,
        })
      );
    }

    if (!infer.ok) {
      logger.warn(
        { error: infer.error, windowId: window.windowId },
        '[Model2] inference failed — continue base recall'
      );
      return failSoft(
        emptyDiag({
          profile_available: Boolean(args.userProfile),
          inference_failed: true,
          reason: infer.error,
          merged_candidate_count: flatBase.length,
        })
      );
    }

    if (!infer.model2Invoked) {
      if (observeWindows) {
        windowTraces.push({
          window_id: window.windowId,
          model2_inference_id: null,
          reason: infer.reason || 'NOT_INVOKED',
          window: compactWindowEvidence(evidence),
        });
      }
      continue;
    }

    invoked = true;
    inferenceSeq += 1;
    const model2InferenceId = `${args.sessionId || 's'}:${policyInput.spanId}:${inferenceSeq}`;
    modelLatency += infer.latencyMs ?? 0;
    queryBudget = infer.queryBudget;
    selectedAll.push(...infer.selectedActions);
    lastDomainAction = infer.domainAction ?? null;
    lastDomainNone = infer.domainNone !== false;
    domainDecisionReached = true;
    if (!lastDomainNone) {
      anyDomainActionSelected = true;
      lastNonNoneDomainAction = lastDomainAction;
    }
    sha256 = infer.sha256;
    if (infer.unicodeSanitize) {
      if (infer.unicodeSanitize.sanitized) unicodeSanitized = true;
      sanitizedStringCount += infer.unicodeSanitize.sanitized_string_count || 0;
      sanitizedCodeUnitCount += infer.unicodeSanitize.sanitized_code_unit_count || 0;
      sanitizationOwner = infer.unicodeSanitize.sanitization_owner || sanitizationOwner;
    }

    let pQueries: ReturnType<typeof executeProfileLexiconQueries>['queries'] = [];
    let pReason: string | null = null;
    let spanToneReadiness: string | null = null;
    let spanPHitCount = 0;
    const spanAcousticTonePattern =
      evidence.acousticTonePattern && evidence.acousticTonePattern.length > 0
        ? evidence.acousticTonePattern
        : undefined;
    const spanTonePresent = Boolean(spanAcousticTonePattern?.length);
    const tonePatternSource = spanTonePresent
      ? evidence.acousticTonePattern &&
        args.acousticSlices?.length &&
        args.toneTimestampOnlyEnabled
        ? 'WINDOW_LOCAL'
        : args.acousticTonePatternOverride?.length
          ? 'TEST_HARNESS_FALLBACK'
          : 'WINDOW_LOCAL'
      : 'NONE';
    if (spanTonePresent) acousticTonePatternPresent = true;

    if (infer.selectedActions.length) {
      const { queries, lexiconLatencyMs, observability: pObs } = executeProfileLexiconQueries({
        runtime: args.runtime,
        selectedActions: infer.selectedActions,
        queryBudget: infer.queryBudget,
        spanSyllables: policyInput.spanSyllables,
        windowText: policyInput.windowText,
        domainIds: args.domainIds,
        profile: args.lexiconProfile,
        candBudget: 8,
        acousticTonePattern: spanAcousticTonePattern,
      });
      lexiconLatency += lexiconLatencyMs;
      profileQueries += queries.length;
      pQueries = queries;
      if (queries.length > 0) pRetrievalQueriesRun = true;
      spanPHitCount = pObs.total_hit_count;
      pRetrievalHitCount += pObs.total_hit_count;
      spanToneReadiness = pObs.toneRecallReadinessState;
      if (pObs.toneRecallReadinessState) {
        toneRecallReadinessState = pObs.toneRecallReadinessState;
      }
      // ACP V1: emit evidence for every executed Model2-conditioned Recall (hit optional).
      for (const q of queries) {
        upsertRecallQueryEvidence(recallQueryEvidence, {
          pinyinKey: q.pinyinKey,
          syllableStart: policyInput.syllableStart,
          syllableEnd: policyInput.syllableEnd,
          rawStart: policyInput.rawStart,
          rawEnd: policyInput.rawEnd,
          source: RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
        });
      }
      for (const q of queries) {
        const mats = materializeProfileHits({
          hits: q.hits,
          policyInput,
          actionId: q.actionId,
          seqStart: seq,
          retrievalId: `${model2InferenceId}:p`,
        });
        seq += mats.length;
        pronunciationAdded += mats.length;
        profileHits.push(...mats);
      }
    } else {
      pReason = 'NO_P_ACTION';
    }

    let dMats: WindowCandidate[] = [];
    let dReason: string | null = null;
    const spanDomainHits = !lastDomainNone ? infer.domainHits || [] : [];
    dHitCount += spanDomainHits.length;
    if (!lastDomainNone && spanDomainHits.length) {
      lexiconLatency += infer.domainRetrievalMs ?? 0;
      dMats = materializeDomainHits({
        hits: spanDomainHits,
        policyInput,
        actionId: lastDomainAction || 'domain_soft',
        seqStart: seq,
        runtime: args.runtime,
        retrievalId: `${model2InferenceId}:d`,
      });
      seq += dMats.length;
      domainAdded += dMats.length;
      profileHits.push(...dMats);
    } else if (lastDomainNone) {
      dReason = 'D_RETRIEVAL_NOT_EXECUTED_DOMAIN_NONE';
    } else {
      dReason = 'D_ACTION_NO_HITS';
    }

    if (observeWindows) {
      const pProbs = infer.actionProbsTop || [];
      const dProbs = infer.domainProbsTop || [];
      windowTraces.push({
        window_id: window.windowId,
        model2_inference_id: model2InferenceId,
        retrieval_id_p: pQueries.length ? `${model2InferenceId}:p` : null,
        retrieval_id_d: dMats.length ? `${model2InferenceId}:d` : null,
        window: compactWindowEvidence(evidence),
        base_candidates: captureV2On
          ? {
              count: baseForWindow.filter((c) => !c.isCovered).length,
              items: baseForWindow
                .filter((c) => !c.isCovered)
                .map((c, i) => compactCandidate(c, i + 1)),
            }
          : compactCandidates(baseForWindow),
        profile: profileInputSummary(args.userProfile),
        feature_pack: {
          feature_hash: infer.featureHash || infer.featurePack || 'MODEL2_FEATURE_HASH_V1',
          packed_feature_hash: infer.packedFeatureHash || null,
          n_applicable: infer.nApplicable ?? null,
          p_feature_presence: infer.pFeaturePresence ?? false,
          d_feature_presence: infer.dFeaturePresence ?? false,
        },
        model2_raw: {
          p_action_scores: pProbs,
          p_selected_actions: infer.selectedActions,
          p_top1: pProbs[0] || null,
          p_top2: pProbs[1] || null,
          p_margin:
            pProbs.length >= 2 ? Number(pProbs[0]?.prob || 0) - Number(pProbs[1]?.prob || 0) : null,
          d_action_scores: dProbs,
          d_selected_action: lastDomainAction,
          domain_none: lastDomainNone,
          domain_none_score: dProbs.find((x) => x.action_id === 'domain_none') || null,
          selected_domain_slot: lastDomainNone ? null : lastDomainAction,
          latency_ms: infer.latencyMs ?? null,
        },
        p_retrieval: pReason
          ? { status: 'NOT_EXECUTED', reason: pReason }
          : {
              status: 'EXECUTED',
              query_budget: infer.queryBudget,
              acousticTonePattern_present: spanTonePresent,
              tone_pattern_source: tonePatternSource,
              window_local_tone_pattern: spanAcousticTonePattern
                ? [...spanAcousticTonePattern]
                : null,
              toneRecallReadiness: spanToneReadiness,
              hit_count: spanPHitCount,
              queries: pQueries.map((q) => ({
                action_id: q.actionId,
                query: q.querySyllables,
                query_syllables: [...q.querySyllables],
                pinyin_key: q.pinyinKey,
                observed_syllables: [...(policyInput.spanSyllables || [])],
                observed_pinyin_key: policyInput.windowPinyinKey || null,
                raw_start: policyInput.rawStart,
                raw_end: policyInput.rawEnd,
                syllable_start: policyInput.syllableStart,
                syllable_end: policyInput.syllableEnd,
                origin_span_id: policyInput.spanId,
                window_id: window.windowId,
                toneRecallReadinessState: q.toneRecallReadinessState ?? null,
                hits: q.hits.slice(0, 16).map((h, i) => ({
                  termId: h.hotword?.id != null ? String(h.hotword.id) : null,
                  surface: h.hotword?.word || null,
                  pinyin: Array.isArray(h.hotword?.pinyin)
                    ? h.hotword.pinyin.join('|')
                    : h.hotword?.pinyin != null
                      ? String(h.hotword.pinyin)
                      : null,
                  domains: h.hotword?.domains || [],
                  source: String(h.source ?? ''),
                  toneLookupStage: h.toneLookupStage ?? null,
                  rank: i + 1,
                  provenance: 'PROFILE_PRONUNCIATION',
                })),
              })),
            },
        d_retrieval: dReason
          ? { status: 'NOT_EXECUTED', reason: dReason }
          : {
              status: 'EXECUTED',
              selected_domain: lastDomainAction,
              allowed_domain_ids: infer.domainExecutor?.allowed_domain_ids || null,
              domain_raw_n: infer.domainRawN ?? 0,
              hard_filter: infer.domainExecutor?.hard_filter ?? null,
              nested_32_8: infer.domainExecutor?.nested_32_8 ?? null,
              hits: (infer.domainHits || []).slice(0, 16).map((h, i) => {
                const bound = dMats.find(
                  (c) =>
                    c.replacement === h.surface &&
                    (c.termId === h.sqlite_term_id || c.termId === h.term_id)
                );
                return {
                  termId: h.term_id,
                  sqlite_term_id: h.sqlite_term_id ?? null,
                  surface: h.surface,
                  domains: h.domain_ids || [],
                  pinyin: h.pinyin_key,
                  rank: i + 1,
                  provenance: 'PROFILE_DOMAIN',
                  candidateId: bound?.candidateId ?? null,
                  originSpanId: policyInput.spanId,
                  retrievalId: `${model2InferenceId}:d`,
                  binding_status: domainHitBindingStatus(h, policyInput),
                  hitKind: 'exact_term',
                  repairTarget: false,
                };
              }),
            },
      });
    }
  }

  // Per-window merge so Base-miss + Model2-hit windows gain candidates for LexicalEdge.
  const allIntroduced: string[] = [];
  const allDuplicates: string[] = [];
  const flatMerged: WindowCandidate[] = [];
  for (const window of args.windows) {
    const baseForWindow = args.candidatesByWindow.get(window.windowId) ?? [];
    const profileForWindow = profileHits.filter((c) => c.windowId === window.windowId);
    const merge = mergeProfileIntoWindowCandidates(baseForWindow, profileForWindow);
    args.candidatesByWindow.set(window.windowId, merge.merged);
    allIntroduced.push(...merge.introducedTermIds);
    allDuplicates.push(...merge.duplicateTermIds);
    flatMerged.push(...merge.merged);
  }

  const observability = buildStageJObservability({
    model2Invoked: invoked,
    selectedActions: selectedAll,
    domainDecisionReached,
    domainNone: !anyDomainActionSelected,
    domainAction: anyDomainActionSelected ? lastNonNoneDomainAction : null,
    acousticTonePatternPresent,
    toneRecallReadiness: toneRecallReadinessState,
    pRetrievalQueriesRun,
    pRetrievalHitCount,
    pMaterializedCount: pronunciationAdded,
    dHitCount,
    dMaterializedCount: domainAdded,
    inferenceFailed: false,
    loadFailed: false,
    failureReason: null,
    unicodeSanitized,
    sanitizedStringCount,
    sanitizedCodeUnitCount,
    sanitizationOwner,
  });

  const diagnostics: Model2ExpandDiagnostics = {
    model2_invoked: invoked,
    profile_available: Boolean(args.userProfile),
    selected_actions: selectedAll,
    query_budget: queryBudget,
    profile_queries: profileQueries,
    profile_candidate_count: profileHits.length,
    introduced_term_ids: allIntroduced,
    merged_candidate_count: flatMerged.length,
    model_latency_ms: modelLatency,
    lexicon_latency_ms: lexiconLatency,
    feature_build_ms: featureBuildMs,
    domain_action: lastDomainAction,
    domain_none: lastDomainNone,
    domain_candidates_added: domainAdded,
    pronunciation_candidates_added: pronunciationAdded,
    checkpoint_sha256: sha256,
    label: 'STAGE_J_RUNTIME_CHECKPOINT_SWAP',
    observability,
  };

  if (traceEnabled || captureV2On) {
    const beforeBudget = flatMerged.filter((c) => !c.isCovered);
    diagnostics.path_trace = {
      model2_status: invoked ? 'INVOKED' : 'NO_WINDOW_INVOKED',
      insertion: 'PRE_LEXICAL_EDGE',
      profile: profileInputSummary(args.userProfile),
      windows: windowTraces,
      union: {
        base_candidate_count: flatBase.filter((c) => !c.isCovered).length,
        p_added_count: pronunciationAdded,
        d_added_count: domainAdded,
        duplicates_removed: allDuplicates.length,
        duplicate_term_ids: allDuplicates.slice(0, 32),
        candidate_identity: 'termId',
        union_count: beforeBudget.length,
        // Capture V2: untruncated authoritative items. TRACE display may still use compactCandidates.
        union_before_budget: captureV2On
          ? {
              count: beforeBudget.length,
              items: beforeBudget.map((c, i) => compactCandidate(c, i + 1)),
              authoritative_truncated: false,
            }
          : compactCandidates(flatMerged),
      },
      budget: {
        budget_value: 8,
        note: 'P candBudget=8 and D max_cands=8 applied at retrieval; merge does not prune',
        candidate_count_after: beforeBudget.length,
        pruned_candidates: [],
      },
    };
  }

  return {
    candidates: flatMerged,
    candidatesByWindow: args.candidatesByWindow,
    diagnostics,
    recallQueryEvidence: Object.freeze([...recallQueryEvidence]),
  };
}

/** Result shape compatible with prior Model2ExpandResult consumers. */
export type { Model2ExpandResult };
