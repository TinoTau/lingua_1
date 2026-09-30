/**
 * Model3 V2 targeted-distribution materialize harness.
 * Production-equivalent: FineSpan paths + cand (!isCovered) + Domain Anchor + pack fields.
 *
 * Usage (prefer system node against dist; Electron optional):
 *   node targeted_dist_materialize.cjs < req.jsonl > resp.jsonl
 *
 * Request: { id, currentText, referenceText?, corruptions? }
 * Response: one JSON line with paths[] each containing spans with production cand/anchor.
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
const {
  model3FirstPassCandidateCount,
  model3PinyinTextDerived,
  packModel3SpanInferFields,
} = require(path.join(dist, "model3-runtime/model3-feature-pack.js"));
const { materializeModel3Anchors } = require(path.join(
  dist,
  "model3-runtime/model3-anchor-adapter.js"
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

/**
 * Apply compatibility coverage flags onto FineSpan.candidates by candidateId.
 * Orchestrator runs resolveCompatibilityRelations on a shallow copy; Model3 reads
 * PathFineSpan.candidates. For training we write covered flags back so
 * model3FirstPassCandidateCount matches the intended !isCovered contract.
 */
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
    activeCandidateCount: compatibility.metrics.activeCandidateCount,
    coverageCount: compatibility.metrics.coverageCount,
  };
}

function materialize(req) {
  const id = req.id || "unknown";
  const current = normalizeForFwRepairInput(req.currentText || "").repairText;
  const reference = normalizeForFwRepairInput(req.referenceText || current).repairText;
  const corruptions = Array.isArray(req.corruptions) ? req.corruptions : [];

  const gen = runLatticeFineSpanGeneration({
    rawText: current,
    runtime: rt,
    profile,
    domainIds,
    minPrior: fw.minPrior,
    imeConfig: ime,
    dict,
  });
  if (!gen.ok) {
    return {
      id,
      ok: false,
      error: gen.code || "LATTICE_FAIL",
      message: gen.message || "",
      currentText: current,
      referenceText: reference,
    };
  }

  // Lattice success result exposes syllableCount, not globalSyllables array.
  // Pinyin channel SSOT matches production text-derived coordinate.
  let globalSyllables = [];
  try {
    globalSyllables = buildUtteranceSyllableCoordinate(current).syllables || [];
  } catch (_) {
    globalSyllables = [];
  }
  const pinyinTextDerived = model3PinyinTextDerived(globalSyllables);
  const views = gen.pathFineSpanViews || [];
  const paths = [];
  const candHist = {};

  for (let pathIndex = 0; pathIndex < views.length; pathIndex++) {
    const view = views[pathIndex];
    // Deep-ish clone FineSpans so path-local isCovered mutation stays path-local.
    const pathFineSpans = (view.pathFineSpans || []).map((s) => ({
      ...s,
      candidates: (s.candidates || []).map((c) => ({ ...c })),
      coarseSpanIds: [...(s.coarseSpanIds || [])],
    }));

    const compat = applyCompatibilityCoverageToFineSpans(pathFineSpans);

    // Vote + Anchor via production materializeModel3Anchors (Domain path; Model2 absent offline).
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
      const rawStart = s.rawStart;
      const rawEnd = s.rawEnd;
      const surface = current.slice(rawStart, rawEnd);
      const isAnchor = anchorById.has(s.spanId);
      const anchorSource = isAnchor ? anchorById.get(s.spanId).source || "DOMAIN" : "NONE";

      const rawCand = model3FirstPassCandidateCount(s);
      const candRawTotal = (s.candidates || []).length;
      const candCovered = (s.candidates || []).filter((c) => c.isCovered === true).length;
      candHist[String(rawCand)] = (candHist[String(rawCand)] || 0) + 1;

      const packed = packModel3SpanInferFields({
        span: s,
        rawText: current,
        globalSyllables,
        isAnchor,
      });

      // Shared training pack formulas (bigru_v1.span_features) — no new formulas.
      const cjkLen = [...surface].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length;
      const features = {
        isAnchor: isAnchor ? 1 : 0,
        span_len_log1p: Math.log1p(surface.length),
        span_rel_position: i / Math.max(n - 1, 1),
        first_pass_cand_log1p: Math.log1p(rawCand),
        current_cjk_len_log1p: Math.log1p(cjkLen),
        pinyin_channel_avail: pinyinTextDerived ? 1 : 0,
      };

      let referenceSurface = null;
      let phoneticCompatible = false;
      let corruptionFamily = null;
      for (const corr of corruptions) {
        const cs = corr.spanStart;
        const ce = corr.spanEnd;
        if (typeof cs === "number" && typeof ce === "number") {
          if (!(ce <= rawStart || cs >= rawEnd)) {
            referenceSurface = corr.referenceSurface || null;
            phoneticCompatible = corr.isPhonetic === true;
            corruptionFamily = corr.corruptionFamily || null;
          }
        }
      }
      if (referenceSurface == null && reference.length === current.length) {
        referenceSurface = reference.slice(rawStart, rawEnd);
      }

      spans.push({
        spanId: s.spanId,
        surface,
        rawStart,
        rawEnd,
        syllableStart: s.syllableStart ?? null,
        syllableEnd: s.syllableEnd ?? null,
        seqIndex: i,
        seqLen: n,
        isAnchor,
        anchorSource,
        referenceSurface,
        phoneticCompatible,
        corruptionFamily,
        repairability: {
          referenceReachable:
            !referenceSurface || referenceSurface === surface ? "YES" : "UNKNOWN",
          probe: "DEFERRED_TO_LABELER",
          probeNote: "reachability resolved at labeling if needed",
        },
        pinyinEvidence: {
          windowPinyinKey: null,
          provenance: "TEXT_DERIVED_SYLLABLE_KEY",
        },
        toneEvidence: { provenance: "ABSENT" },
        acousticEvidence: {
          status: "ABSENT",
          wordTimeAligned: false,
          asrSegmentConfidence: null,
        },
        pronunciationEvidence: { status: "UNAVAILABLE" },
        recallEvidence: {
          status: "AVAILABLE",
          firstPassCandidateCount: rawCand,
          length1TerminalReason: null,
          candRawTotal,
          candCovered,
        },
        packedInfer: packed,
        features,
        owners: {
          cand: "model3FirstPassCandidateCount",
          packInfer: "packModel3SpanInferFields",
          anchor: "materializeModel3Anchors",
          fineSpan: "runLatticeFineSpanGeneration",
          compat: "resolveCompatibilityRelations+writeback",
        },
      });
    }

    paths.push({
      pathId: view.pathId || `path_${pathIndex}`,
      pathIndex,
      boundaryKey: view.boundaryKey || null,
      spanCount: spans.length,
      retainedDomains: [...(vote.retainedDomains || [])],
      compatibility: compat,
      spans,
    });
  }

  return {
    id,
    ok: true,
    harness: "targeted_dist_materialize.cjs",
    reused: {
      fineSpan: "runLatticeFineSpanGeneration",
      candidateCount: "model3FirstPassCandidateCount",
      compatibility: "buildCandidateCompatibilityGraph+resolveCompatibilityRelations",
      domainVote: "voteUtteranceDomainFromPool",
      anchor: "materializeModel3Anchors",
      packInfer: "packModel3SpanInferFields",
    },
    anchorClassification: "PRODUCTION_EQUIVALENT_ANCHOR",
    anchorNote:
      "materializeModel3Anchors Domain path; Model2 acoustic provenance UNAVAILABLE offline (same as production text-only Domain anchors)",
    currentText: current,
    referenceText: reference,
    globalSyllableCount: globalSyllables.length,
    featureAvailability: {
      textContext: true,
      pinyinTextDerived,
      toneAcoustic: false,
      asrConfidence: false,
      model2Pronunciation: false,
      recallFirstPass: true,
    },
    pathCount: paths.length,
    paths,
    probeCandHistogram: candHist,
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
        stack: e && e.stack ? String(e.stack).slice(0, 800) : undefined,
      }) + "\n"
    );
  }
});
