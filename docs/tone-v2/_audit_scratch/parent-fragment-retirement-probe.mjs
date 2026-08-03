/**
 * READ-ONLY probe: Legacy Parent Fragment Recall Retirement Audit
 * - SQLite fragment samples
 * - dialog_200 domain_vote_trace + sentence_assembly_trace counterfactual
 * NO production code / DB mutation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(__dirname, 'parent_fragment_retirement');
fs.mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
const Database = require(path.join(ROOT, 'electron_node/electron-node/node_modules/better-sqlite3'));

const SQLITE = path.join(ROOT, 'node_runtime/lexicon/v3/lexicon.sqlite');
const VOTE_DIR = path.join(__dirname, 'domain_vote_trace');
const ASM_DIR = path.join(__dirname, 'sentence_assembly_trace');
const EXPORT_JSON = path.join(
  __dirname,
  'dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.json'
);

const FRAGMENT_SURFACES = ['科医', '议室', '低脂', '记员', '机员', '线计', '莓马', '科医生', '内科医'];
const NOISE_ONLY = new Set(FRAGMENT_SURFACES);

function qAll(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function schemaInventory(db) {
  const tables = qAll(
    db,
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  const indexes = qAll(
    db,
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND tbl_name='term_pinyin_ngrams'`
  );
  const ngramCols = qAll(db, `PRAGMA table_info(term_pinyin_ngrams)`);
  const ngramCount = db.prepare(`SELECT COUNT(*) AS c FROM term_pinyin_ngrams`).get().c;
  const parents = db
    .prepare(
      `SELECT COUNT(DISTINCT parent_term_id) AS c FROM term_pinyin_ngrams`
    )
    .get().c;
  const lenDist = qAll(
    db,
    `SELECT length(fragment_text) AS L, COUNT(*) AS c FROM term_pinyin_ngrams GROUP BY L ORDER BY L`
  );
  const widthDist = qAll(
    db,
    `SELECT (ngram_end - ngram_start) AS W, COUNT(*) AS c FROM term_pinyin_ngrams GROUP BY W ORDER BY W`
  );
  return { tables: tables.map((t) => t.name), indexes, ngramCols, ngramCount, parents, lenDist, widthDist };
}

function sampleParents(db) {
  const parents = [
    '蓝莓马芬',
    '草莓马芬',
    '内科医生',
    '会议室',
    '低脂奶',
    '上线计划',
  ];
  const out = {};
  for (const p of parents) {
    const asTerm = qAll(
      db,
      `SELECT id, word, pinyin_key, source FROM base_lexicon WHERE word = ?
       UNION ALL
       SELECT id, word, pinyin_key, source FROM domain_lexicon WHERE word = ? LIMIT 5`,
      p,
      p
    );
    const frags = qAll(
      db,
      `SELECT id, fragment_text, ngram_pinyin_key, ngram_start, ngram_end, domain_id, parent_word, parent_term_id
       FROM term_pinyin_ngrams WHERE parent_word = ? ORDER BY ngram_start, ngram_end`,
      p
    );
    out[p] = { asTerm, fragmentCount: frags.length, fragments: frags };
  }
  return out;
}

function fragmentHits(db) {
  const out = {};
  for (const f of FRAGMENT_SURFACES) {
    out[f] = qAll(
      db,
      `SELECT id, parent_word, fragment_text, ngram_pinyin_key, ngram_start, ngram_end, domain_id, tier, source
       FROM term_pinyin_ngrams WHERE fragment_text = ?`,
      f
    );
  }
  // also ke|yi
  out['__pinyin_ke_yi'] = qAll(
    db,
    `SELECT id, parent_word, fragment_text, ngram_pinyin_key, domain_id
     FROM term_pinyin_ngrams WHERE ngram_pinyin_key = 'ke|yi' LIMIT 20`
  );
  return out;
}

/** Parse domain_vote_trace/*.md for parent_fragment lines */
function parseVoteMd(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const caseId = path.basename(filePath, '.md').replace(/^0+/, '') ;
  // files are 001.md -> need d001 from content
  const mCase = text.match(/caseId[:=]\s*[`"]?(d\d+)/i) || text.match(/\b(d\d{3})\b/);
  const id = mCase ? mCase[1] : `d${path.basename(filePath, '.md')}`;
  const lines = text.split(/\r?\n/);
  const frags = [];
  for (const line of lines) {
    if (!line.includes('hitKind=parent_fragment') && !line.includes('hitKind: parent_fragment')) continue;
    const word = (line.match(/word="([^"]+)"/) || line.match(/word=([^\s]+)/) || [])[1];
    const domains =
      (line.match(/domainTags=\[([^\]]*)\]/) || [])[1]
        ?.split(',')
        .map((s) => s.replace(/["'\s]/g, ''))
        .filter(Boolean) || [];
    const parent = (line.match(/parentTerm[^=]*=["']?([^"'\s]+)/) || [])[1];
    frags.push({ word, domains, parent, line: line.slice(0, 240) });
  }
  return { caseId: id, frags };
}

function voteCounterfactual() {
  const files = fs.existsSync(VOTE_DIR)
    ? fs.readdirSync(VOTE_DIR).filter((f) => f.endsWith('.md'))
    : [];
  const perCase = [];
  const surfaceCounts = new Map();
  const domainFromNoise = new Map();
  let casesWithPf = 0;
  let totalPfCand = 0;
  let noiseCand = 0;

  for (const f of files) {
    const { caseId, frags } = parseVoteMd(path.join(VOTE_DIR, f));
    if (!frags.length) continue;
    casesWithPf += 1;
    totalPfCand += frags.length;
    const domainsBefore = new Set();
    const domainsAfter = new Set();
    const noiseDomains = new Set();
    for (const g of frags) {
      const w = g.word || '';
      surfaceCounts.set(w, (surfaceCounts.get(w) || 0) + 1);
      for (const d of g.domains) domainsBefore.add(d);
      if (NOISE_ONLY.has(w)) {
        noiseCand += 1;
        for (const d of g.domains) {
          noiseDomains.add(d);
          domainFromNoise.set(d, (domainFromNoise.get(d) || 0) + 1);
        }
      } else {
        for (const d of g.domains) domainsAfter.add(d);
      }
    }
    // Note: domainsAfter here only removes NOISE fragment surfaces;
    // full CF removes ALL parent_fragment (exact_term may still carry same domains).
    perCase.push({
      caseId,
      pfCount: frags.length,
      noiseWords: frags.filter((x) => NOISE_ONLY.has(x.word)).map((x) => x.word),
      domainsOnPf: [...domainsBefore],
      domainsOnNoisePf: [...noiseDomains],
    });
  }

  return {
    voteMdFiles: files.length,
    casesWithParentFragment: casesWithPf,
    totalParentFragmentCandidates: totalPfCand,
    noiseFragmentCandidates: noiseCand,
    topPfSurfaces: [...surfaceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
    domainHitsFromNoiseFragments: [...domainFromNoise.entries()].sort((a, b) => b[1] - a[1]),
    sampleCases: perCase.filter((c) => c.noiseWords.length).slice(0, 30),
    note:
      'Vote MD lists eligible pool candidates with hitKind; removing ALL parent_fragment is stronger CF than noise-only.',
  };
}

function assemblyCounterfactual() {
  const files = fs.existsSync(ASM_DIR)
    ? fs.readdirSync(ASM_DIR).filter((f) => f.endsWith('.json'))
    : [];
  const noiseInKenlm = [];
  const noiseInUsed = [];
  let kenlmTotal = 0;
  let kenlmWithNoise = 0;
  let casesWithNoiseSentence = 0;
  const surfaceUsed = new Map();

  for (const f of files) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(ASM_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    const caseId = j.caseId || f;
    const texts = (j.kenlmInputs || []).map((k) => k.text || '');
    kenlmTotal += texts.length;
    let caseNoise = false;
    for (const t of texts) {
      const hits = [...NOISE_ONLY].filter((s) => t.includes(s));
      if (hits.length) {
        kenlmWithNoise += 1;
        caseNoise = true;
        noiseInKenlm.push({ caseId, text: t, hits });
      }
    }
    if (caseNoise) casesWithNoiseSentence += 1;

    for (const fate of j.candidateFateGlobal || []) {
      const w = fate.word || '';
      if (NOISE_ONLY.has(w) && fate.finalStatus === 'USED_IN_SENTENCE') {
        surfaceUsed.set(w, (surfaceUsed.get(w) || 0) + 1);
        noiseInUsed.push({ caseId, word: w, bucket: fate.bucketDomain, candidateId: fate.candidateId });
      }
    }
  }

  // Also scan export for replacement surfaces that are noise
  let exportNoiseReplacements = [];
  if (fs.existsSync(EXPORT_JSON)) {
    const exp = JSON.parse(fs.readFileSync(EXPORT_JSON, 'utf8'));
    const cases = Array.isArray(exp) ? exp : exp.cases || [];
    for (const c of cases) {
      const caseId = c.caseId || c.id;
      for (const sent of c.kenlmInputs || c.candidateSentences || []) {
        const text = typeof sent === 'string' ? sent : sent.text || '';
        const hits = [...NOISE_ONLY].filter((s) => text.includes(s));
        if (hits.length) exportNoiseReplacements.push({ caseId, hits, text });
      }
      // replacements
      for (const r of c.replacements || []) {
        if (NOISE_ONLY.has(r.word || r.replacement || r.surface)) {
          exportNoiseReplacements.push({
            caseId,
            kind: 'replacement',
            word: r.word || r.replacement,
          });
        }
      }
    }
  }

  return {
    asmJsonFiles: files.length,
    kenlmInputTotal: kenlmTotal,
    kenlmInputsContainingNoiseFragment: kenlmWithNoise,
    casesWithNoiseInKenlm: casesWithNoiseSentence,
    noiseUsedInSentenceCounts: [...surfaceUsed.entries()],
    noiseUsedSamples: noiseInUsed.slice(0, 40),
    kenlmNoiseSamples: noiseInKenlm.slice(0, 25),
    exportNoiseHits: exportNoiseReplacements.length,
    exportNoiseSamples: exportNoiseReplacements.slice(0, 25),
  };
}

/** Stronger CF: count how often parent_fragment appears in vote pool vs exact_term same surface */
function analyzeOverlapExactVsFragment() {
  const files = fs.existsSync(VOTE_DIR)
    ? fs.readdirSync(VOTE_DIR).filter((f) => f.endsWith('.md'))
    : [];
  let pfOnlySurfaces = 0;
  let pfAlsoLikelyExact = 0;
  const pfOnlyExamples = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(VOTE_DIR, f), 'utf8');
    const pfWords = new Set();
    const exactWords = new Set();
    for (const line of text.split(/\r?\n/)) {
      const word = (line.match(/word="([^"]+)"/) || [])[1];
      if (!word) continue;
      if (line.includes('hitKind=parent_fragment')) pfWords.add(word);
      if (line.includes('hitKind=exact_term')) exactWords.add(word);
    }
    for (const w of pfWords) {
      if (exactWords.has(w)) pfAlsoLikelyExact += 1;
      else {
        pfOnlySurfaces += 1;
        if (pfOnlyExamples.length < 50) pfOnlyExamples.push({ file: f, word: w });
      }
    }
  }
  return { pfOnlySurfaces, pfAlsoLikelyExact, pfOnlyExamples };
}

function main() {
  const db = new Database(SQLITE, { readonly: true, fileMustExist: true });
  const result = {
    sqlite: SQLITE,
    schema: schemaInventory(db),
    sampleParents: sampleParents(db),
    fragmentHits: fragmentHits(db),
    voteCf: voteCounterfactual(),
    assemblyCf: assemblyCounterfactual(),
    exactVsFragment: analyzeOverlapExactVsFragment(),
    consumersNote: {
      productionReaders: [
        'recall-span-topkv3.ts::lookupParentFragments',
        'lexicon-runtime-v2.ts::lookupParentFragmentsByNgramKey',
        'bindLexiconHitsToWindow replacement=fragmentText',
      ],
      buildOnly: ['materialize-term-ngrams.mjs'],
      patchStats: ['sqlite-table-stats.ts', 'manifest-writer.ts'],
    },
  };
  db.close();

  fs.writeFileSync(path.join(OUT, '_probe_result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        ngramCount: result.schema.ngramCount,
        casesWithPf: result.voteCf.casesWithParentFragment,
        totalPfCand: result.voteCf.totalParentFragmentCandidates,
        noiseCand: result.voteCf.noiseFragmentCandidates,
        kenlmNoise: result.assemblyCf.kenlmInputsContainingNoiseFragment,
        casesKenlmNoise: result.assemblyCf.casesWithNoiseInKenlm,
        pfOnly: result.exactVsFragment.pfOnlySurfaces,
        pfAlsoExact: result.exactVsFragment.pfAlsoLikelyExact,
        topSurfaces: result.voteCf.topPfSurfaces.slice(0, 15),
        out: OUT,
      },
      null,
      2
    )
  );
}

main();
