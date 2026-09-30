/**
 * Formal Model3 V2 Acoustic B2 training-state materializer.
 * Orchestrates existing production owners — does NOT duplicate business logic.
 *
 * Input line JSON:
 * {
 *   id, referenceText, rawActualAsrText | currentText,
 *   acousticToneSlices, asrSegments,
 *   userProfile?: null|object
 * }
 *
 * Always invokes runLatticeFineSpanGenerationWithPreEdgeModel2 (WIRED+ATTEMPTED;
 * Model2 Aug-12 pre-LexicalEdge SSOT — ONE stage inside lattice).
 * COMPLETED / HOST_AVAILABLE / HIT derived from real execution).
 * Emits evidenceSource=FORMAL_FRESH_MATERIALIZATION + ownerDiagnostics.
 */
const path = require("path");
const readline = require("readline");

const REPO = path.resolve(__dirname, "../../..");
const ROOT = path.join(REPO, "electron_node/electron-node");
process.chdir(ROOT);
process.env.PROJECT_ROOT = REPO;

const dist = path.join(ROOT, "dist/main/electron-node/main/src");
const { LexiconRuntimeV2 } = require(path.join(dist, "lexicon-v2/lexicon-runtime-v2.js"));
const { defaultGeneralProfile } = require(path.join(dist, "lexicon-v2/profile-registry.js"));
const { resolveRecallScope } = require(path.join(
  dist,
  "lexicon-v2/resolve-recall-enabled-fine-domains.js"
));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, "fw-detector/fw-config.js"));
const { loadPinyinImeV2RuntimeConfig } = require(path.join(
  dist,
  "fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js"
));
const {
  loadPinyinImeV2Dictionaries,
  resolvePinyinImeV2DictDir,
} = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js"));
const { runLatticeFineSpanGenerationWithPreEdgeModel2 } = require(path.join(
  dist,
  "fw-detector/span-assembly-v4/lattice-fine-span-runtime.js"
));
const {
  buildCandidateCompatibilityGraph,
  resolveCompatibilityRelations,
} = require(path.join(dist, "fw-detector/span-assembly-v4/candidate-compatibility-graph.js"));
const { voteUtteranceDomainFromPool } = require(path.join(
  dist,
  "fw-detector/span-assembly-shared/utterance-domain-vote.js"
));
const { normalizeForFwRepairInput } = require(path.join(
  dist,
  "fw-detector/normalize-for-fw-repair.js"
));
const { buildUtteranceSyllableCoordinate } = require(path.join(
  dist,
  "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"
));
const { buildWordTimeSpans, mapToneEvidenceForRecall } = require(path.join(
  dist,
  "fw-detector/tone-time-align.js"
));
const {
  model3FirstPassCandidateCount,
  model3PinyinTextDerived,
  packModel3SpanInferFields,
} = require(path.join(dist, "model3-runtime/model3-feature-pack.js"));
const { materializeModel3Anchors } = require(path.join(
  dist,
  "model3-runtime/model3-anchor-adapter.js"
));
const { resolveToneRecallReadiness } = require(path.join(
  dist,
  "lexicon-v2/tone-recall-readiness.js"
));
const { getModel2InferenceHost } = require(path.join(dist, "model2-runtime/inference-host.js"));

const HARNESS_ID = "acoustic_b2_formal_materialize.cjs";
const fw = loadFwDetectorRuntimeConfig();
const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), {
  enabledDomains: ime.enabledDomains,
});
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
const load = rt.loadFromBundleDir(path.join(REPO, "node_runtime/lexicon/v3"));
if (!load || load.status !== "ok") {
  console.error(JSON.stringify({ fatal: "lexicon_load_failed", load }));
  process.exit(1);
}
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

function applyCompatibilityCoverageToFineSpans(pathFineSpans) {
  const pathCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
  buildCandidateCompatibilityGraph(pathCandidates);
  const compatibility = resolveCompatibilityRelations(pathCandidates, null);
  const coveredById = new Map();
  for (const c of compatibility.activeCandidates) {
    coveredById.set(c.candidateId, c.isCovered === true);
  }
  let coveredFlags = 0;
  for (const span of pathFineSpans) {
    for (const c of span.candidates || []) {
      const covered = coveredById.get(c.candidateId) === true;
      c.isCovered = covered;
      if (covered) coveredFlags += 1;
    }
  }
  return {
    pathCandidateCount: pathCandidates.length,
    coveredFlags,
    coverageCount: compatibility.metrics.coverageCount,
  };
}

function toVotePoolsFromActive(activeCandidates, pathFineSpans) {
  return pathFineSpans.map((s) => {
    const bound = activeCandidates.filter((c) => {
      if (c.originSpanId && c.originSpanId === s.spanId) return true;
      if (c.isCovered) return false;
      return (
        typeof c.syllableStart === "number" &&
        typeof c.syllableEnd === "number" &&
        c.syllableStart >= s.syllableStart &&
        c.syllableEnd <= s.syllableEnd
      );
    });
    const base = (s.candidates || []).map((c) => ({
      hitKind: c.hitKind || "exact_term",
      source: c.source || c.graphSource || "base_term",
      score: typeof c.score === "number" ? c.score : c.candidateScore || 0,
      domains: c.domains || c.hotword?.domains || [],
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      isCovered: c.isCovered === true,
      retrievalProvenance: c.retrievalProvenance,
    }));
    const extra = bound.map((c) => ({
      hitKind: c.hitKind || "exact_term",
      source: c.source || c.graphSource || "base_term",
      score: typeof c.score === "number" ? c.score : c.candidateScore || 0,
      domains: c.domains || c.hotword?.domains || [],
      syllableStart: typeof c.syllableStart === "number" ? c.syllableStart : s.syllableStart,
      syllableEnd: typeof c.syllableEnd === "number" ? c.syllableEnd : s.syllableEnd,
      isCovered: c.isCovered === true,
      retrievalProvenance: c.retrievalProvenance,
    }));
    return { candidates: base.concat(extra) };
  });
}

function isModel2Prov(p) {
  return p === "PROFILE_RETRIEVAL" || p === "PROFILE_PRONUNCIATION" || p === "PROFILE_DOMAIN";
}

async function materialize(req) {
  const id = req.id || "unknown";
  const rawActualAsrText = req.rawActualAsrText != null ? req.rawActualAsrText : req.currentText || "";
  const norm = normalizeForFwRepairInput(rawActualAsrText || "");
  const current = norm.repairText;
  const reference = normalizeForFwRepairInput(req.referenceText || current).repairText;
  const acousticToneSlices = Array.isArray(req.acousticToneSlices) ? req.acousticToneSlices : [];
  const asrSegments = Array.isArray(req.asrSegments) ? req.asrSegments : [];

  const ownerDiagnostics = {
    MODEL2_OWNER_WIRED: true,
    MODEL2_OWNER_ATTEMPTED: false,
    MODEL2_OWNER_COMPLETED: false,
    MODEL2_HOST_AVAILABLE: false,
    MODEL2_HIT_OBSERVED: false,
    DOMAIN_OWNER_WIRED: true,
    DOMAIN_OWNER_ATTEMPTED: false,
    DOMAIN_OWNER_COMPLETED: false,
    DOMAIN_HIT_OBSERVED: false,
  };
  // Diagnostic aliases only — Gate0 must not treat these as independent proof.
  const ownerExecution = {
    DOMAIN_ANCHOR_OWNER_WIRED: true,
    DOMAIN_ANCHOR_OWNER_EXECUTED: false,
    DOMAIN_ANCHOR_HIT_OBSERVED: false,
    MODEL2_ANCHOR_OWNER_WIRED: true,
    MODEL2_ANCHOR_OWNER_EXECUTED: false,
    MODEL2_ANCHOR_HOST_AVAILABLE: false,
    MODEL2_ANCHOR_HIT_OBSERVED: false,
  };

  if (!current) {
    return {
      id,
      ok: false,
      error: "MODEL3_CURRENT_TEXT_IDENTITY_INVALID",
      harness: HARNESS_ID,
      evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
      rawActualAsrText,
      model3CurrentText: current,
      ownerDiagnostics,
      ownerExecution,
    };
  }
  if (!acousticToneSlices.length) {
    return {
      id,
      ok: false,
      error: "TONE_STATE_MISSING",
      harness: HARNESS_ID,
      evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
      rawActualAsrText,
      model3CurrentText: current,
      ownerDiagnostics,
      ownerExecution,
    };
  }

  let globalSyllables = [];
  try {
    globalSyllables = buildUtteranceSyllableCoordinate(current).syllables || [];
  } catch (_) {
    globalSyllables = [];
  }
  const pinyinTextDerived = model3PinyinTextDerived(globalSyllables);
  const wordTimeSpans = buildWordTimeSpans(
    current,
    asrSegments,
    [0],
    [0],
    asrSegments.map(() => 0)
  );
  const toneTimestampOnlyEnabled = fw.toneTimestampOnlyEnabled !== false;

  ownerDiagnostics.MODEL2_OWNER_ATTEMPTED = true;
  let gen;
  try {
    gen = await runLatticeFineSpanGenerationWithPreEdgeModel2({
      rawText: current,
      runtime: rt,
      profile,
      domainIds,
      minPrior: fw.minPrior,
      imeConfig: ime,
      dict,
      acousticSlices: acousticToneSlices,
      wordTimeSpans,
      toneTimestampOnlyEnabled,
      fuzzyRecallEnabled: true,
      model2: {
        userProfile: req.userProfile != null ? req.userProfile : null,
      },
    });
    ownerDiagnostics.MODEL2_OWNER_COMPLETED = true;
  } catch (err) {
    ownerDiagnostics.MODEL2_OWNER_COMPLETED = false;
    return {
      id,
      ok: false,
      error: "MODEL2_LATTICE_EXCEPTION",
      message: String(err && err.message ? err.message : err),
      harness: HARNESS_ID,
      evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
      rawActualAsrText,
      model3CurrentText: current,
      referenceText: reference,
      ownerDiagnostics,
      ownerExecution,
    };
  }

  if (!gen.ok) {
    return {
      id,
      ok: false,
      error: gen.code || "FINESPAN_MATERIALIZATION_FAILED",
      message: gen.message || "",
      harness: HARNESS_ID,
      evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
      rawActualAsrText,
      model3CurrentText: current,
      referenceText: reference,
      ownerDiagnostics,
      ownerExecution,
    };
  }

  const utteranceModel2Diag = gen.model2Diagnostics || null;
  let model2AnchorStatus = "UNAVAILABLE";
  let hostAvailableAny = false;
  if (utteranceModel2Diag) {
    const loadFailed = Boolean(utteranceModel2Diag.load_failed);
    const inv = Boolean(utteranceModel2Diag.model2_invoked);
    ownerDiagnostics.MODEL2_HOST_AVAILABLE = !loadFailed;
    if (ownerDiagnostics.MODEL2_HOST_AVAILABLE) hostAvailableAny = true;
    if (loadFailed) {
      model2AnchorStatus = "UNAVAILABLE";
    } else if (inv || ownerDiagnostics.MODEL2_HOST_AVAILABLE) {
      model2AnchorStatus = "RUNTIME_CONFIRMED";
    }
  }

  const views = gen.pathFineSpanViews || [];
  const paths = [];
  const candHist = {};
  const readinessHist = {};
  let anyDomainHit = false;
  let anyModel2Hit = false;

  for (let pathIndex = 0; pathIndex < views.length; pathIndex++) {
    const view = views[pathIndex];
    const pathFineSpans = (view.pathFineSpans || []).map((s) => ({
      ...s,
      candidates: (s.candidates || []).map((c) => ({ ...c })),
      coarseSpanIds: [...(s.coarseSpanIds || [])],
    }));
    const compat = applyCompatibilityCoverageToFineSpans(pathFineSpans);
    const activeCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
    const model2Diag = utteranceModel2Diag;
    // Diagnostic aliases only — Gate0 must derive from ownerDiagnostics / artifacts.
    ownerExecution.MODEL2_ANCHOR_OWNER_EXECUTED = ownerDiagnostics.MODEL2_OWNER_ATTEMPTED;
    ownerExecution.MODEL2_ANCHOR_HOST_AVAILABLE = ownerDiagnostics.MODEL2_HOST_AVAILABLE;

    ownerDiagnostics.DOMAIN_OWNER_ATTEMPTED = true;
    const votePools = toVotePoolsFromActive(activeCandidates, pathFineSpans);
    const vote = voteUtteranceDomainFromPool(votePools);
    ownerDiagnostics.DOMAIN_OWNER_COMPLETED = true;
    ownerExecution.DOMAIN_ANCHOR_OWNER_EXECUTED = true;
    const { anchors } = materializeModel3Anchors({
      pathFineSpans,
      activeCandidates,
      vote,
      rawText: current,
    });
    const anchorById = new Map(anchors.map((a) => [a.spanId, a]));
    if (anchors.some((a) => a.source === "DOMAIN" || a.source === "DOMAIN_AND_MODEL2")) {
      anyDomainHit = true;
    }
    if (anchors.some((a) => a.source === "MODEL2" || a.source === "DOMAIN_AND_MODEL2")) {
      anyModel2Hit = true;
    }

    const spans = [];
    const n = pathFineSpans.length;
    for (let i = 0; i < n; i++) {
      const s = pathFineSpans[i];
      const surface = current.slice(s.rawStart, s.rawEnd);
      const isAnchor = anchorById.has(s.spanId);
      const anchorSource = isAnchor ? anchorById.get(s.spanId).source || "DOMAIN" : "NONE";
      const rawCand = model3FirstPassCandidateCount(s);
      candHist[String(rawCand)] = (candHist[String(rawCand)] || 0) + 1;

      const mapped = mapToneEvidenceForRecall(
        s.rawStart,
        s.rawEnd,
        s.syllableStart,
        s.syllableEnd,
        acousticToneSlices,
        wordTimeSpans
      );
      const syl = globalSyllables.slice(s.syllableStart, s.syllableEnd);
      const readiness = resolveToneRecallReadiness({
        syllables: syl,
        runtimeSupportsTone: rt.supportsToneFirstRecall(),
        acousticTonePattern: mapped.pattern || undefined,
        toneCallerEnabled: toneTimestampOnlyEnabled && acousticToneSlices.length > 0,
      });
      if (!readiness || typeof readiness.state !== "string" || !readiness.state) {
        return {
          id,
          ok: false,
          error: "RECALL_STATE_INVALID",
          message: "missing_tone_recall_readiness_state",
          harness: HARNESS_ID,
          evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
          rawActualAsrText,
          model3CurrentText: current,
          referenceText: reference,
          ownerDiagnostics,
          ownerExecution,
        };
      }
      const rState = readiness.state;
      readinessHist[rState] = (readinessHist[rState] || 0) + 1;

      const packed = packModel3SpanInferFields({
        span: s,
        rawText: current,
        globalSyllables,
        isAnchor,
      });

      spans.push({
        spanId: s.spanId,
        surface,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        seqIndex: i,
        seqLen: n,
        isAnchor,
        anchorSource,
        windowSource: s.windowSource || null,
        recallEvidence: {
          status: "AVAILABLE",
          firstPassCandidateCount: rawCand,
          candRawTotal: (s.candidates || []).length,
          candCovered: (s.candidates || []).filter((c) => c.isCovered === true).length,
        },
        toneReadiness: rState,
        tonePatternLen: mapped.pattern ? mapped.pattern.length : 0,
        packedInfer: packed,
        packedInferFields: packed,
        referenceSurface:
          reference.length === current.length ? reference.slice(s.rawStart, s.rawEnd) : null,
        phoneticCompatible: false,
        repairability: {
          referenceReachable: "UNKNOWN",
          probe: "DEFERRED_TO_LABELER",
        },
      });
    }

    paths.push({
      pathId: view.pathId || `path_${pathIndex}`,
      pathIndex,
      spanCount: spans.length,
      retainedDomains: [...(vote.retainedDomains || [])],
      compatibility: compat,
      anchors: anchors.map((a) => ({ spanId: a.spanId, source: a.source })),
      model2Diagnostics: model2Diag
        ? {
            model2_invoked: model2Diag.model2_invoked,
            load_failed: model2Diag.load_failed,
            inference_failed: model2Diag.inference_failed,
            reason: model2Diag.reason || null,
          }
        : null,
      spans,
    });
  }

  ownerDiagnostics.DOMAIN_HIT_OBSERVED = anyDomainHit;
  ownerDiagnostics.MODEL2_HIT_OBSERVED = anyModel2Hit;
  ownerDiagnostics.MODEL2_HOST_AVAILABLE = hostAvailableAny || ownerDiagnostics.MODEL2_HOST_AVAILABLE;
  ownerExecution.DOMAIN_ANCHOR_HIT_OBSERVED = anyDomainHit;
  ownerExecution.MODEL2_ANCHOR_HIT_OBSERVED = anyModel2Hit;
  ownerExecution.MODEL2_ANCHOR_HOST_AVAILABLE = ownerDiagnostics.MODEL2_HOST_AVAILABLE;

  return {
    id,
    ok: true,
    harness: HARNESS_ID,
    evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
    rawActualAsrText,
    model3CurrentText: current,
    currentText: current,
    referenceText: reference,
    scriptNormalized: Boolean(norm.scriptNormalized),
    featureAvailability: {
      textContext: true,
      pinyinTextDerived,
      toneAcoustic: acousticToneSlices.length > 0,
      asrConfidence: false,
      model2Pronunciation: model2AnchorStatus !== "UNAVAILABLE",
      recallFirstPass: true,
    },
    domainEvidence: {
      retainedDomains: [
        ...new Set(paths.flatMap((p) => p.retainedDomains || [])),
      ],
      anchorMaterialization: "RUNTIME_CONFIRMED",
      materializationNote: "voteUtteranceDomainFromPool + materializeModel3Anchors",
    },
    model2AnchorStatus,
    ownerDiagnostics,
    ownerExecution,
    sliceCount: acousticToneSlices.length,
    wordTimeSpanCount: wordTimeSpans.length,
    lexicalEdgeCount: (gen.lexicalEdges || []).length,
    sqlQueryCount: (gen.trace && gen.trace.sqlQueryCount) || 0,
    pathCount: paths.length,
    paths,
    probeCandHistogram: candHist,
    toneReadinessHistogram: readinessHist,
    toneTimestampOnlyEnabled,
    reused: {
      fineSpan: "runLatticeFineSpanGenerationWithPreEdgeModel2",
      candidateCount: "model3FirstPassCandidateCount",
      packer: "packModel3SpanInferFields",
      tone: "AcousticToneSlice+WordTimeSpan+MandatoryToneRecall",
      model2: "expandWindowsWithModel2",
      domainVote: "voteUtteranceDomainFromPool",
      anchor: "materializeModel3Anchors",
      normalize: "normalizeForFwRepairInput",
    },
  };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: "bad_json" }) + "\n");
      continue;
    }
    try {
      const out = await materialize(req);
      process.stdout.write(JSON.stringify(out) + "\n");
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          id: req.id,
          ok: false,
          error: "throw",
          message: String(e && e.message ? e.message : e),
          harness: HARNESS_ID,
          evidenceSource: "FORMAL_FRESH_MATERIALIZATION",
          ownerDiagnostics: {
            MODEL2_OWNER_WIRED: true,
            MODEL2_OWNER_ATTEMPTED: false,
            MODEL2_OWNER_COMPLETED: false,
            MODEL2_HOST_AVAILABLE: false,
            DOMAIN_OWNER_WIRED: true,
            DOMAIN_OWNER_ATTEMPTED: false,
            DOMAIN_OWNER_COMPLETED: false,
          },
          ownerExecution: {
            DOMAIN_ANCHOR_OWNER_WIRED: true,
            MODEL2_ANCHOR_OWNER_WIRED: true,
            DOMAIN_ANCHOR_OWNER_EXECUTED: false,
            MODEL2_ANCHOR_OWNER_EXECUTED: false,
          },
        }) + "\n"
      );
    }
  }
  // Infrastructure: Model2 Stage-J host is a long-lived child; dispose so batch
  // harness processes terminate after stdin EOF (does not change Model2 business semantics).
  try {
    await getModel2InferenceHost().dispose();
  } catch (_) {
    /* ignore */
  }
  process.exit(0);
}

main();
