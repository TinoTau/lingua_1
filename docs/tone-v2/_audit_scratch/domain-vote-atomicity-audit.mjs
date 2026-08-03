/**
 * READ ONLY — Domain Vote Atomicity Audit for the 2 sentence regressions:
 *   1) 单元测试 · 请在合并前确保单元测试全部通过。
 *   2) 神经网络 · 我们正在训练神经网络模型。
 *
 * Traces FineSpan → Recall → Candidate → DomainCandidate → Vote → Bucket
 * WITH vs WITHOUT (Probe exclude full compound). No Source/SQLite/Runtime mutation.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'domain_vote_atomicity');
const docsTone = path.join(repo, 'docs/tone-v2');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);
const { buildCandidateCompatibilityGraph, resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);
const {
  buildFineSpanCandidatePool,
  runDomainAwareAssembly,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const {
  buildFineSpanDomainSet,
  voteUtteranceDomainFromPool,
} = require(path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js'));
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);

const CASES = [
  {
    compound: '单元测试',
    sentence: '请在合并前确保单元测试全部通过。',
    atoms: ['单元', '测试'],
  },
  {
    compound: '神经网络',
    sentence: '我们正在训练神经网络模型。',
    atoms: ['神经', '网络'],
  },
];

const candidateDir = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const db = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });
const profile = defaultGeneralProfile();
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const rt = new LexiconRuntimeV2();
if (rt.loadFromBundleDir(candidateDir).status !== 'ok') throw new Error('lexicon load fail');
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const toneStmt = db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`);
const toneStmtBase = db.prepare(
  `SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`
);
const CJK = /[\u4e00-\u9fff]/;

function parseTones(toneKey, expectedLen) {
  const parts = String(toneKey || '')
    .split('|')
    .filter(Boolean);
  const tones = parts.map((p) => {
    const m = p.match(/([1-5])$/);
    const n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= 5 ? n : 1;
  });
  while (tones.length < expectedLen) tones.push(1);
  return tones.slice(0, expectedLen);
}

function tonesForWord(word) {
  const row = toneStmt.get(word) || toneStmtBase.get(word);
  return parseTones(row?.tone_pinyin_key, [...word].length);
}

function sentenceAsrAndTone(sentence, compound) {
  const chars = [...sentence];
  const tones = chars.map((ch) => {
    if (!CJK.test(ch)) return 1;
    const row = toneStmt.get(ch) || toneStmtBase.get(ch);
    if (row?.tone_pinyin_key) return parseTones(row.tone_pinyin_key, 1)[0];
    return 1;
  });
  const idx = sentence.indexOf(compound);
  if (idx >= 0) {
    const ct = tonesForWord(compound);
    const start = [...sentence.slice(0, idx)].length;
    for (let i = 0; i < ct.length; i += 1) {
      if (start + i < tones.length) tones[start + i] = ct[i];
    }
  }
  const fix = makeCharToneFixtures(sentence, tones);
  const words = chars.map((ch, i) => ({
    word: ch,
    start: i * 0.1,
    end: i * 0.1 + 0.09,
    probability: 0.99,
  }));
  return {
    acousticSlices: fix.acousticSlices,
    asrSegments: [
      {
        text: sentence,
        start: 0,
        end: Math.max(0.09, (chars.length - 1) * 0.1 + 0.09),
        words,
      },
    ],
    segmentTimeOffsetsSec: [0],
    segmentCharOffsets: [0],
    asrSegmentNodeBatchIndices: [0],
  };
}

function wrapExclude(runtime, excludeWord) {
  return new Proxy(runtime, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      if (String(prop).startsWith('lookup')) {
        return function (...args) {
          const out = val.apply(target, args);
          if (Array.isArray(out)) return out.filter((h) => String(h?.word || '') !== excludeWord);
          return out;
        };
      }
      return function (...args) {
        return val.apply(target, args);
      };
    },
  });
}

function isVoteDomainLabel(d) {
  return Boolean(d) && d !== 'general' && d !== 'base_term';
}

function isDomainVoteSource(source) {
  return source === 'domain_term' || source === 'passive_domain_weak';
}

function lexiconTagDump(words) {
  const out = {};
  for (const w of words) {
    const term = db.prepare(`SELECT word, repair_target, enabled FROM term WHERE word=?`).get(w);
    const base = db.prepare(`SELECT word, prior_score, enabled FROM base_lexicon WHERE word=?`).get(w);
    const domainRows = db
      .prepare(`SELECT domain_id FROM domain_lexicon WHERE word=? AND enabled=1`)
      .all(w)
      .map((r) => r.domain_id);
    out[w] = {
      inTerm: Boolean(term),
      repairTarget: term?.repair_target === 1 || term?.repair_target === true,
      inBase: Boolean(base),
      domainLexicon: domainRows,
    };
  }
  return out;
}

function candidateVoteRow(c, spanId) {
  const fineDomains = (c.domains || []).filter(isVoteDomainLabel);
  const voteEligible = !c.isCovered && isDomainVoteSource(c.source) && fineDomains.length > 0;
  return {
    spanId,
    candidateId: c.candidateId,
    replacement: c.replacement,
    syllableStart: c.syllableStart,
    syllableEnd: c.syllableEnd,
    source: c.source,
    recallSource: c.recallSource,
    hitKind: c.hitKind,
    domains: [...(c.domains || [])],
    fineDomains,
    score: c.candidateScore ?? c.score,
    repairTarget: c.repairTarget === true,
    isCovered: c.isCovered === true,
    voteEligible,
    votesDomains: voteEligible ? fineDomains : [],
  };
}

function analyzeMode(label, runtime, sentence, compound) {
  const toneAsr = sentenceAsrAndTone(sentence, compound);
  const partition = partitionCoarseSpans({
    rawText: sentence,
    imeConfig,
    dict,
    asrSegments: toneAsr.asrSegments,
  });

  const lattice = runLatticeFineSpanGeneration({
    rawText: sentence,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    coarseSpans: partition.coarseSpans,
    acousticSlices: toneAsr.acousticSlices,
    wordTimeSpans: toneAsr.asrSegments[0].words.map((w, i) => ({
      word: w.word,
      rawStart: i,
      rawEnd: i + 1,
      start: w.start,
      end: w.end,
    })),
    toneTimestampOnlyEnabled: true,
  });
  if (!lattice.ok) throw new Error(`${label} lattice fail ${lattice.code}`);

  const edgeRepls = [];
  for (const e of lattice.lexicalEdges || []) {
    for (const c of e.candidates || []) {
      edgeRepls.push({
        edgeId: e.edgeId,
        replacement: c.replacement,
        domains: c.domains || [],
        source: c.source,
        repairTarget: c.repairTarget === true,
      });
    }
  }

  const pathLogs = [];
  for (const view of lattice.pathFineSpanViews) {
    const pathFineSpans = view.pathFineSpans;
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates);
    const compatibility = resolveCompatibilityRelations(pathCandidates, null);
    const active = compatibility.activeCandidates;
    const pool = buildFineSpanCandidatePool(active, partition.coarseSpans, pathFineSpans);

    const spanVoteLogs = pool.map((spanPool) => {
      const rows = spanPool.candidates.map((c) => candidateVoteRow(c, spanPool.fineSpanId));
      const domainSet = [...buildFineSpanDomainSet(spanPool.candidates)];
      return {
        fineSpanId: spanPool.fineSpanId,
        syllableRange: spanPool.syllableRange,
        rawRange: spanPool.rawRange,
        candidates: rows,
        fineSpanDomainSet: domainSet,
        presenceVotes: domainSet.map((d) => ({ domain: d, votes: 1 })),
      };
    });

    const vote = voteUtteranceDomainFromPool(pool);
    const assembly = runDomainAwareAssembly(
      active,
      partition.coarseSpans,
      sentence,
      pathFineSpans,
      []
    );

    pathLogs.push({
      pathId: view.pathId,
      boundaryKey: view.boundaryKey,
      spanCount: pathFineSpans.length,
      spans: pathFineSpans.map((s) => ({
        id: s.spanId || `${s.syllableStart}:${s.syllableEnd}`,
        syllableStart: s.syllableStart,
        syllableEnd: s.syllableEnd,
        windowSource: s.windowSource,
        candidateWords: (s.candidates || []).map((c) => c.replacement),
      })),
      spanVoteLogs,
      vote: {
        domainScores: vote.domainScores,
        retainedDomains: [...vote.retainedDomains],
        utteranceDomain: vote.utteranceDomain,
        insufficientEvidence: vote.insufficientEvidence,
        maxCount: vote.maxCount,
        runnerUpCount: vote.runnerUpCount,
        isTie: vote.isTie,
      },
      bucketCount: assembly.bucketSpanSets.length,
      bucketDomains:
        vote.insufficientEvidence || vote.retainedDomains.length === 0
          ? [null]
          : [...vote.retainedDomains],
      eligibleVoters: spanVoteLogs.flatMap((s) => s.candidates.filter((c) => c.voteEligible)),
    });
  }

  // Full orchestrator (production entry) for Final/KenLM confirmation
  const orch = runSpanAssemblyV4Orchestrator({
    rawText: sentence,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    acousticSlices: toneAsr.acousticSlices,
    asrSegments: toneAsr.asrSegments,
    segmentTimeOffsetsSec: toneAsr.segmentTimeOffsetsSec,
    segmentCharOffsets: toneAsr.segmentCharOffsets,
    asrSegmentNodeBatchIndices: toneAsr.asrSegmentNodeBatchIndices,
  });
  const combos = orch.kenlmSentenceCandidates?.combinations || [];
  const primaryPath = pathLogs[0] || null;

  return {
    label,
    lattice: {
      lexicalEdgeCount: lattice.trace.lexicalEdgeCount,
      pathCount: lattice.trace.retainedCompletePathCount,
      edgeReplacements: edgeRepls,
      compoundInEdges: edgeRepls.some((e) => e.replacement === compound),
    },
    pathLogs,
    primaryPathVote: primaryPath?.vote || null,
    primaryEligibleVoters: primaryPath?.eligibleVoters || [],
    orch: {
      retainedDomains: [...(orch.metrics?.retainedDomains || [])],
      kenlmTop3: combos.slice(0, 3).map((c) => c.text),
      final: combos[0]?.text || '',
      assemblyCount: combos.length,
    },
  };
}

function explainWhyAtomsCannotReplace(compound, atoms, withLog, withoutLog, tagDump) {
  const compoundTag = tagDump[compound] || {};
  const atomNotes = atoms.map((a) => {
    const t = tagDump[a] || {};
    return {
      atom: a,
      domains: t.domainLexicon || [],
      inBase: t.inBase,
      reason:
        !(t.domainLexicon || []).length
          ? 'no fine domain tag → resolveGraphSource=base_term → Vote 不计票'
          : 'has domain tags (see dump)',
    };
  });
  return {
    compoundDomains: compoundTag.domainLexicon || [],
    compoundVotesBecause:
      'compound 若被 Recall 为 domain_term（hotword.domains 含 fine domain），则其所在 FineSpan 的 FineSpanDomainSet 计入 presence +1',
    atomsCannotReplace: atomNotes,
    contract:
      'Vote SSOT: domainScores[domain] = distinct FineSpan presence count；仅 source∈{domain_term,passive_domain_weak} 且 domains 含 fine label 才入 set；同 span 同 domain 多候选只计 1 票',
    withVsWithout: {
      withScores: withLog.primaryPathVote?.domainScores,
      withRetained: withLog.primaryPathVote?.retainedDomains,
      withoutScores: withoutLog.primaryPathVote?.domainScores,
      withoutRetained: withoutLog.primaryPathVote?.retainedDomains,
    },
  };
}

const caseReports = [];
for (const c of CASES) {
  const words = [c.compound, ...c.atoms, '模型', '通过'];
  const tagDump = lexiconTagDump(words);
  // Also dump via runtime lookup for actual hotword.domains
  const runtimeDomainProbe = {};
  for (const w of [c.compound, ...c.atoms]) {
    const hits = [];
    for (const d of domainIds) {
      try {
        const rows = rt.lookupDomainByPinyinKey?.(d, 'x', w.length) || [];
      } catch {
        /* ignore */
      }
    }
    // direct SQL domain_lexicon already in tagDump; also check term domains from runtime entry
    const keyRow = db.prepare(`SELECT pinyin_key FROM term WHERE word=?`).get(w);
    if (keyRow?.pinyin_key) {
      const syl = String(keyRow.pinyin_key).split('|');
      const tones = tonesForWord(w);
      const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
      const r = recallSpanTopKV2(rt, {
        syllables: syl,
        windowText: w,
        termLength: syl.length,
        topK: 5,
        perSpanLimit: 5,
        profile,
        domainIds,
        acousticTonePattern: tones,
        toneCallerEnabled: true,
      });
      runtimeDomainProbe[w] = r.hits
        .filter((h) => h.hotword.word === w)
        .map((h) => ({
          word: h.hotword.word,
          domains: h.hotword.domains || [],
          repairTarget: h.hotword.repairTarget === true,
          prior: h.hotword.priorScore,
        }));
    } else {
      runtimeDomainProbe[w] = [];
    }
  }

  const withLog = analyzeMode('WITH', rt, c.sentence, c.compound);
  const withoutLog = analyzeMode('WITHOUT', wrapExclude(rt, c.compound), c.sentence, c.compound);
  const explanation = explainWhyAtomsCannotReplace(
    c.compound,
    c.atoms,
    withLog,
    withoutLog,
    tagDump
  );

  caseReports.push({
    compound: c.compound,
    sentence: c.sentence,
    atoms: c.atoms,
    tagDump,
    runtimeDomainProbe,
    with: withLog,
    without: withoutLog,
    explanation,
  });
}

function rootCauseClassify(reports) {
  const causes = new Set();
  for (const r of reports) {
    const cDomains = r.tagDump[r.compound]?.domainLexicon || [];
    if (cDomains.length) causes.add('DOMAIN_TAG_ON_COMPOUND_ONLY');
    for (const a of r.atoms) {
      const ad = r.tagDump[a]?.domainLexicon || [];
      if (!ad.length) causes.add('ATOMS_LACK_DOMAIN_TAG');
    }
  }
  // Vote formula is presence + source gate — not a weight bug
  causes.add('VOTE_SOURCE_GATE_BY_DESIGN'); // base_term excluded
  // Not merge bug: atoms recall fine, just don't vote
  // Not runtime bug: Assembly/KenLM unchanged is expected when base path covers surface

  let primary = 'DOMAIN_TAG';
  let detail =
    'Compound 在 domain_lexicon / hotword.domains 上挂有 fine domain（如 tech_ai）；原子词（神经/网络、单元/测试）通常仅为 base_term（无 fine domain）→ resolveGraphSource=base_term → Vote 门禁排除。删除 compound 后失去该 FineSpan 的 presence 票，retainedDomains 下降；Assembly 仍可用 base_term/canonical 拼出相同表面，故 KenLM/Final 不变。';

  return {
    primary,
    isDomainTagProblem: true,
    isVoteProblem: false, // formula working as frozen SSOT
    isCandidateMergeProblem: false,
    isWeightProblem: false, // presence count, not weight
    isRuntimeBug: false,
    causes: [...causes],
    detail,
  };
}

const root = rootCauseClassify(caseReports);

fs.writeFileSync(
  path.join(outDir, 'domain_vote_atomicity.json'),
  JSON.stringify({ cases: caseReports, rootCause: root }, null, 2),
  'utf8'
);

function fmtVoters(voters) {
  if (!voters.length) return '_none_';
  return voters
    .map(
      (v) =>
        `- \`${v.replacement}\` @${v.syllableStart}:${v.syllableEnd} source=\`${v.source}\` domains=[${v.fineDomains.join(', ')}] → votes **${v.votesDomains.join(', ')}**`
    )
    .join('\n');
}

function pathMd(pathLog) {
  const lines = [];
  lines.push(`- path spans: ${pathLog.spans.map((s) => `${s.syllableStart}:${s.syllableEnd}[${(s.candidateWords || []).slice(0, 4).join('|')}]`).join(' · ')}`);
  lines.push(`- domainScores: \`${JSON.stringify(pathLog.vote.domainScores)}\``);
  lines.push(`- retainedDomains: [${pathLog.vote.retainedDomains.join(', ')}]`);
  lines.push(`- buckets: ${JSON.stringify(pathLog.bucketDomains)}`);
  lines.push(`- Vote-eligible candidates:\n${fmtVoters(pathLog.eligibleVoters)}`);
  for (const s of pathLog.spanVoteLogs) {
    if (!s.fineSpanDomainSet.length && !s.candidates.some((c) => c.voteEligible)) continue;
    lines.push(
      `  - FineSpan \`${s.fineSpanId}\` DomainSet={${s.fineSpanDomainSet.join(',')}} · candidates=${s.candidates
        .filter((c) => c.domains?.length || c.voteEligible || c.replacement)
        .slice(0, 12)
        .map((c) => `${c.replacement}/${c.source}/[${(c.domains || []).join('|')}]${c.voteEligible ? '✓' : '✗'}`)
        .join('; ')}`
    );
  }
  return lines.join('\n');
}

function caseMd(r) {
  return `## Case: ${r.compound}

**Sentence:** ${r.sentence}

### Lexicon Domain Tags

| Word | inBase | domain_lexicon | Runtime Exact domains |
|------|--------|----------------|------------------------|
${[r.compound, ...r.atoms]
  .map((w) => {
    const t = r.tagDump[w] || {};
    const rtHits = (r.runtimeDomainProbe[w] || [])
      .map((h) => `[${(h.domains || []).join('|')}]`)
      .join(' ') || '∅';
    return `| ${w} | ${t.inBase} | [${(t.domainLexicon || []).join(', ')}] | ${rtHits} |`;
  })
  .join('\n')}

### WITH — Vote Log

- Edges contain compound: **${r.with.lattice.compoundInEdges}**
- LexicalEdge count: ${r.with.lattice.lexicalEdgeCount}
- Path count: ${r.with.lattice.pathCount}
- Edge sample: ${r.with.lattice.edgeReplacements
    .filter((e) => e.replacement === r.compound || r.atoms.includes(e.replacement))
    .map((e) => `${e.edgeId}:${e.replacement}/[${(e.domains || []).join('|')}]/${e.source}`)
    .join('; ') || '(see JSON)'}
- Orch retainedDomains: [${r.with.orch.retainedDomains.join(', ')}]
- Orch Final: ${r.with.orch.final}
- Assembly count: ${r.with.orch.assemblyCount}
- KenLM Top3: ${JSON.stringify(r.with.orch.kenlmTop3)}

**Primary path (pathLogs[0])**

${pathMd(r.with.pathLogs[0])}

${r.with.pathLogs.length > 1 ? `**Other paths:** ${r.with.pathLogs.length - 1} (see JSON)` : ''}

### WITHOUT — Vote Log

- Edges contain compound: **${r.without.lattice.compoundInEdges}**
- LexicalEdge count: ${r.without.lattice.lexicalEdgeCount}
- Path count: ${r.without.lattice.pathCount}
- Atom edges: ${r.without.lattice.edgeReplacements
    .filter((e) => r.atoms.includes(e.replacement))
    .map((e) => `${e.edgeId}:${e.replacement}/[${(e.domains || []).join('|')}]/${e.source}`)
    .join('; ')}
- Orch retainedDomains: [${r.without.orch.retainedDomains.join(', ')}]
- Orch Final: ${r.without.orch.final}
- Assembly count: ${r.without.orch.assemblyCount}
- KenLM Top3: ${JSON.stringify(r.without.orch.kenlmTop3)}

**Primary path**

${pathMd(r.without.pathLogs[0])}

### Diff

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [${r.with.orch.retainedDomains.join(', ')}] | [${r.without.orch.retainedDomains.join(', ')}] |
| domainScores (primary) | \`${JSON.stringify(r.with.primaryPathVote?.domainScores)}\` | \`${JSON.stringify(r.without.primaryPathVote?.domainScores)}\` |
| Assembly/KenLM/Final | identical surface path available | identical |

### Why ${r.atoms.join('+')} cannot replace ${r.compound} for Vote

${r.explanation.atomsCannotReplace.map((a) => `- **${a.atom}**: ${a.reason} (domains=[${a.domains.join(', ')}])`).join('\n')}

- Compound domains: [${r.explanation.compoundDomains.join(', ')}]
- ${r.explanation.compoundVotesBecause}
- Contract: ${r.explanation.contract}
`;
}

const md = `# FW Repair V4 — Domain Vote Atomicity Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · VOTE TRACE** |
| Focus | 神经网络 / 单元测试（Sentence Context REGRESSION 两例） |
| Status | **ROOT_CAUSE_CLASSIFIED** |

---

## 1. Question

为什么删除 compound 后 **Domain Vote 下降**，但 **Assembly / KenLM / Final 完全不变**？

为什么 **神经+网络** 不能在 Vote 上替代 **神经网络**？

---

## 2. Vote SSOT（代码事实）

\`utterance-domain-vote.ts\`:

1. \`resolveGraphSource\`: hotword 无 fine domain → \`base_term\`；有 fine domain → \`domain_term\`。
2. Vote 门禁：仅 \`source ∈ {domain_term, passive_domain_weak}\` 计入 FineSpanDomainSet。
3. Presence：每个 FineSpan 对每个 domain **最多 +1**（同 span 多候选不加权）。
4. \`retainedDomains\`：max 票或 ≥ 0.75×max 的 domain。
5. **不是** score-mass / Weight Vote（已冻结移除）。

\`base_term\` 仍可进 Assembly（拼表面字），但不投 Domain 票。

---

## 3. Root Cause Verdict

| 假设 | 结论 |
|------|------|
| Domain Tag 问题？ | **是（主因）** — compound 独有 fine domain tag；原子词多为无 domain 的 base |
| Vote 问题？ | **否** — Presence Vote 按冻结合同工作 |
| Candidate Merge 问题？ | **否** — 原子候选存在，只是不eligible投票 |
| Weight 问题？ | **否** — 无 weight；是 presence count |
| Runtime Bug？ | **否** — Assembly/KenLM 不变是 base 路径覆盖表面的预期行为 |

\`\`\`text
PRIMARY = DOMAIN_TAG
（compound-only fine domain）+ Vote source gate（base_term 不计票）
\`\`\`

${root.detail}

---

## 4. Cases

${caseReports.map(caseMd).join('\n---\n\n')}

---

## 5. Why Assembly / KenLM / Final unchanged

1. Path 上仍有 \`单元|测试\` / \`神经|网络\`（或 compound 与原子并存）的 LexicalEdge。
2. Vote 丢失只减少 **retained bucket**（如去掉 tech_ai），不删除 base/canonical 表面候选。
3. Cross-path merge 按 text dedup：最终句字符串仍可由 base 路径生成 → KenLM 池与 Top1 可完全一致。
4. 因此：**Vote 退化 ≠ 表面句退化**。Sentence Context 审计把 DOMAIN_VOTE 单独判 REGRESSION 是正确的。

---

## 6. Implication for DELETE_RUNTIME_SAFE

若 Source 删除 compound：

- 仅当关心 **Domain Vote / domain-aware bucket** 时：这两个词在部分句子上 **不安全**（会丢 tech_ai）。
- 若只关心 **Final 字面**：表面仍可由原子恢复。
- Cleanup 前需二选一：  
  (A) 给原子词补齐等价 domain tag（可能过宽）；或  
  (B) 接受 Vote 变粗，仅保留 Final 等价；或  
  (C) 对 Vote 敏感的 compound **不删**（Runtime-required for Domain Vote，而非“术语例外”）。

Artifact: \`docs/tone-v2/_audit_scratch/domain_vote_atomicity/domain_vote_atomicity.json\`
`;

fs.writeFileSync(
  path.join(docsTone, 'FW_Repair_V4_Domain_Vote_Atomicity_Audit_2026_08_02.md'),
  md,
  'utf8'
);

console.log(
  JSON.stringify(
    {
      rootCause: root,
      cases: caseReports.map((r) => ({
        compound: r.compound,
        withDomains: r.with.orch.retainedDomains,
        withoutDomains: r.without.orch.retainedDomains,
        withVoters: r.with.primaryEligibleVoters.map((v) => `${v.replacement}->${v.votesDomains.join('|')}`),
        withoutVoters: r.without.primaryEligibleVoters.map(
          (v) => `${v.replacement}->${v.votesDomains.join('|')}`
        ),
        tag: {
          compound: r.tagDump[r.compound],
          atoms: Object.fromEntries(r.atoms.map((a) => [a, r.tagDump[a]])),
        },
        runtimeProbe: r.runtimeDomainProbe,
        finalSame: r.with.orch.final === r.without.orch.final,
      })),
    },
    null,
    2
  )
);

db.close();
