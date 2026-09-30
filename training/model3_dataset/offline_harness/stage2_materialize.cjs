/**
 * Model3 Stage2 offline harness — production FineSpan + Domain Vote + Recall.
 * ELECTRON_RUN_AS_NODE=1 electron.exe stage2_materialize.mjs < req.jsonl > resp.jsonl
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
const { recallSpanTopKV2 } = require(path.join(dist, "lexicon-v2/recall-span-topk-v2.js"));
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
const { voteUtteranceDomainFromPool } = require(path.join(
  dist,
  "fw-detector/span-assembly-shared/utterance-domain-vote.js"
));
const { buildUtteranceSyllableCoordinate } = require(path.join(
  dist,
  "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"
));
const { normalizeForFwRepairInput } = require(path.join(
  dist,
  "fw-detector/normalize-for-fw-repair.js"
));
const { partitionCoarseSpans } = require(path.join(
  dist,
  "fw-detector/span-assembly-shared/coarse-span-partition.js"
));
const { buildLexicalWindowQueries } = require(path.join(
  dist,
  "fw-detector/span-assembly-v4/build-lexical-window-queries.js"
));
const { latticeHardBlockFilter } = require(path.join(
  dist,
  "fw-detector/span-assembly-v4/lattice-hard-block-filter.js"
));
const { recallTopKForWindows } = require(path.join(
  dist,
  "fw-detector/span-assembly-v4/recall-topk-for-windows.js"
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

function mapVotePools(pathFineSpans) {
  return pathFineSpans.map((s) => ({
    candidates: (s.candidates || []).map((c) => ({
      hitKind: "exact_term",
      source: c.graphSource || c.source || "base_term",
      score: typeof c.score === "number" ? c.score : c.candidateScore || 0,
      domains: c.domains || c.hotword?.domains || [],
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
    })),
  }));
}

/** Production SameDomain predicate (assemble-domain-aware-span-sets isSameDomainCandidate). */
function isSameDomainCandidate(candidate, bucketDomain) {
  const src = candidate.graphSource || candidate.source || "";
  const domains = candidate.domains || candidate.hotword?.domains || [];
  return (
    (src === "domain_term" || src === "passive_domain_weak") &&
    Boolean(domains.includes(bucketDomain))
  );
}

function probeReachable(referenceSurface, retainedDomains) {
  if (!referenceSurface || !/[\u4e00-\u9fff]/.test(referenceSurface)) {
    return { referenceReachable: "UNKNOWN", probe: "NOT_RUN", probeNote: "empty_reference" };
  }
  let coordinate;
  try {
    coordinate = buildUtteranceSyllableCoordinate(referenceSurface);
  } catch (e) {
    return {
      referenceReachable: "UNKNOWN",
      probe: "NOT_RUN",
      probeNote: "coordinate_failed",
    };
  }
  const globalSyllables = coordinate.syllables || [];
  if (!globalSyllables.length) {
    return {
      referenceReachable: "UNKNOWN",
      probe: "NOT_RUN",
      probeNote: "empty_syllables",
    };
  }
  const domains =
    retainedDomains && retainedDomains.length ? retainedDomains.slice() : domainIds.slice();
  try {
    // Authoritative path: same window recall stack as lattice (tmp_recall_probe pattern)
    const coarse = partitionCoarseSpans({
      rawText: referenceSurface,
      imeConfig: ime,
      dict,
    }).coarseSpans;
    const windows = buildLexicalWindowQueries({
      rawText: referenceSurface,
      globalSyllables,
      coarseSpans: coarse,
      charSyllableRanges: coordinate.ranges,
    });
    const filtered = latticeHardBlockFilter({
      windows,
      rawText: referenceSurface,
      coarseSpans: coarse,
      wordTimeSpans: [],
    });
    const recallable = filtered.filter((w) => !w.blocked);
    const recall = recallTopKForWindows({
      rawText: referenceSurface,
      windows: recallable,
      globalSyllables: [...globalSyllables],
      runtime: rt,
      profile,
      domainIds: domains,
      minPrior: fw.minPrior,
    });
    const words = (recall.candidates || [])
      .map((c) => c.hotword?.word || c.word || "")
      .filter(Boolean);
    const yes = words.includes(referenceSurface);
    // Also allow direct base lookup as secondary evidence (not sole criterion)
    let direct = false;
    try {
      const key = globalSyllables.join("|");
      const base = rt.lookupBaseByPinyinKey(key, globalSyllables.length) || [];
      direct = base.some((h) => h.word === referenceSurface);
    } catch (_) {}
    return {
      referenceReachable: yes || direct ? "YES" : "NO",
      probe: "OFFLINE_RECALL_EQUIVALENT",
      probeNote:
        "recallTopKForWindows hits=" +
        [...new Set(words)].slice(0, 8).join("|") +
        ";directBase=" +
        direct,
      hitCount: words.length,
    };
  } catch (e) {
    // Fallback thin recallSpanTopKV2
    try {
      if (globalSyllables.length >= 1 && globalSyllables.length <= 5) {
        const result = recallSpanTopKV2(rt, {
          syllables: globalSyllables,
          windowText: referenceSurface,
          termLength: globalSyllables.length,
          topK: 8,
          perSpanLimit: 8,
          profile,
          domainIds: domains,
          fuzzyRecallEnabled: true,
        });
        const words = (result.hits || []).map((h) => h.hotword?.word || "").filter(Boolean);
        return {
          referenceReachable: words.includes(referenceSurface) ? "YES" : "NO",
          probe: "OFFLINE_RECALL_EQUIVALENT",
          probeNote: "fallback_recallSpanTopKV2 hits=" + words.slice(0, 8).join("|"),
          hitCount: words.length,
        };
      }
    } catch (_) {}
    return {
      referenceReachable: "UNKNOWN",
      probe: "NOT_RUN",
      probeNote: "recall_throw:" + String(e && e.message),
    };
  }
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

  const pathFineSpans = gen.pathFineSpanViews[0].pathFineSpans || [];
  const vote = voteUtteranceDomainFromPool(mapVotePools(pathFineSpans));
  const retainedDomains = [...(vote.retainedDomains || [])];

  const spans = [];
  for (let i = 0; i < pathFineSpans.length; i++) {
    const s = pathFineSpans[i];
    const spanId = s.spanId;
    const rawStart = s.rawStart;
    const rawEnd = s.rawEnd;
    const surface = current.slice(rawStart, rawEnd);
    const cands = s.candidates || [];

    let isAnchor = false;
    let anchorSource = "NONE";
    if (retainedDomains.length) {
      for (const bucket of retainedDomains) {
        if (cands.some((c) => isSameDomainCandidate(c, bucket))) {
          isAnchor = true;
          anchorSource = "DOMAIN";
          break;
        }
      }
    }

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

    let repairability;
    if (referenceSurface && referenceSurface !== surface) {
      repairability = probeReachable(referenceSurface, retainedDomains);
    } else {
      repairability = {
        referenceReachable: "YES",
        probe: "OFFLINE_RECALL_EQUIVALENT",
        probeNote: "surface_matches_reference_or_clean",
      };
    }

    spans.push({
      spanId,
      surface,
      rawStart,
      rawEnd,
      syllableStart: s.syllableStart ?? null,
      syllableEnd: s.syllableEnd ?? null,
      isAnchor,
      anchorSource,
      referenceSurface,
      phoneticCompatible,
      corruptionFamily,
      repairability,
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
        firstPassCandidateCount: cands.length,
        length1TerminalReason: null,
      },
    });
  }

  return {
    id,
    ok: true,
    harness: "stage2_materialize.mjs",
    reused: {
      fineSpan: "runLatticeFineSpanGeneration",
      domainVote: "voteUtteranceDomainFromPool",
      sameDomain: "isSameDomainCandidate_production_predicate",
      recall: "recallTopKForWindows(+recallSpanTopKV2 fallback)",
    },
    currentText: current,
    referenceText: reference,
    domainEvidence: {
      retainedDomains,
      anchorMaterialization: "OFFLINE_DOMAIN_VOTE_EQUIVALENT",
      materializationNote: "sameDomain via production isSameDomainCandidate over retainedDomains",
    },
    model2AnchorStatus: "UNAVAILABLE",
    spans,
    featureAvailability: {
      textContext: true,
      pinyinTextDerived: true,
      toneAcoustic: false,
      asrConfidence: false,
      model2Pronunciation: false,
      recallFirstPass: true,
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
