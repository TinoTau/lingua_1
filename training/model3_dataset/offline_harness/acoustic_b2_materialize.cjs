/**
 * LEGACY probe harness — prefer acoustic_b2_formal_materialize.cjs for training.
 * Kept only for historical probe reproduction. Formal owner wires Model2 expand.
 *
 * Acoustic B2 yield probe materializer — production lattice + Tone channel.
 * Input line JSON:
 * {
 *   id, referenceText, currentText (actual ASR),
 *   acousticToneSlices: [{start,end,tonePosterior,confidence}],
 *   asrSegments: [{ text, start, end, words:[{word,start,end,probability}] }]
 * }
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
const { runLatticeFineSpanGeneration } = require(path.join(
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
const { buildWordTimeSpans } = require(path.join(
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
const { mapToneEvidenceForRecall } = require(path.join(
  dist,
  "fw-detector/tone-time-align.js"
));

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

function materialize(req) {
  const id = req.id || "unknown";
  const current = normalizeForFwRepairInput(req.currentText || "").repairText;
  const reference = normalizeForFwRepairInput(req.referenceText || current).repairText;
  const acousticToneSlices = Array.isArray(req.acousticToneSlices) ? req.acousticToneSlices : [];
  const asrSegments = Array.isArray(req.asrSegments) ? req.asrSegments : [];

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
  const gen = runLatticeFineSpanGeneration({
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
  });

  if (!gen.ok) {
    return {
      id,
      ok: false,
      error: gen.code || "LATTICE_FAIL",
      message: gen.message || "",
      currentText: current,
      referenceText: reference,
      sliceCount: acousticToneSlices.length,
      wordTimeSpanCount: wordTimeSpans.length,
    };
  }

  const views = gen.pathFineSpanViews || [];
  const paths = [];
  const candHist = {};
  const readinessHist = {};
  let lexicalEdgeCount = (gen.lexicalEdges || []).length;
  let sqlQueryCount = (gen.trace && gen.trace.sqlQueryCount) || 0;

  for (let pathIndex = 0; pathIndex < views.length; pathIndex++) {
    const view = views[pathIndex];
    const pathFineSpans = (view.pathFineSpans || []).map((s) => ({
      ...s,
      candidates: (s.candidates || []).map((c) => ({ ...c })),
      coarseSpanIds: [...(s.coarseSpanIds || [])],
    }));
    const compat = applyCompatibilityCoverageToFineSpans(pathFineSpans);
    const activeCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
    const votePools = pathFineSpans.map((s) => ({
      candidates: (s.candidates || []).map((c) => ({
        hitKind: c.hitKind || "exact_term",
        source: c.source || c.graphSource || "base_term",
        score: typeof c.score === "number" ? c.score : c.candidateScore || 0,
        domains: c.domains || c.hotword?.domains || [],
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        isCovered: c.isCovered === true,
      })),
    }));
    const vote = voteUtteranceDomainFromPool(votePools);
    const { anchors } = materializeModel3Anchors({
      pathFineSpans,
      activeCandidates,
      vote,
      rawText: current,
    });
    const anchorById = new Map(anchors.map((a) => [a.spanId, a]));
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
      const rState = readiness.state || "ready";
      readinessHist[rState] = (readinessHist[rState] || 0) + 1;

      const cjkLen = [...surface].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length;
      const features = {
        isAnchor: isAnchor ? 1 : 0,
        span_len_log1p: Math.log1p(surface.length),
        span_rel_position: i / Math.max(n - 1, 1),
        first_pass_cand_log1p: Math.log1p(rawCand),
        current_cjk_len_log1p: Math.log1p(cjkLen),
        pinyin_channel_avail: pinyinTextDerived ? 1 : 0,
      };
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
        features,
        packedInfer: packed,
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
      spans,
    });
  }

  return {
    id,
    ok: true,
    harness: "acoustic_b2_materialize.cjs",
    currentText: current,
    referenceText: reference,
    featureAvailability: {
      textContext: true,
      pinyinTextDerived,
      toneAcoustic: acousticToneSlices.length > 0,
      asrConfidence: false,
      model2Pronunciation: false,
      recallFirstPass: true,
    },
    sliceCount: acousticToneSlices.length,
    wordTimeSpanCount: wordTimeSpans.length,
    lexicalEdgeCount,
    sqlQueryCount,
    pathCount: paths.length,
    paths,
    probeCandHistogram: candHist,
    toneReadinessHistogram: readinessHist,
    toneTimestampOnlyEnabled,
    reused: {
      fineSpan: "runLatticeFineSpanGeneration",
      candidateCount: "model3FirstPassCandidateCount",
      tone: "AcousticToneSlice+WordTimeSpan+MandatoryToneRecall",
      anchor: "materializeModel3Anchors",
    },
  };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: "bad_json" }) + "\n");
    return;
  }
  try {
    process.stdout.write(JSON.stringify(materialize(req)) + "\n");
  } catch (e) {
    process.stdout.write(
      JSON.stringify({
        id: req.id,
        ok: false,
        error: "throw",
        message: String(e && e.message ? e.message : e),
      }) + "\n"
    );
  }
});
