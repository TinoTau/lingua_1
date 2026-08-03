/** Tighter CF — exclude substring false positives (线计⊂上线计划, 莓马⊂蓝莓马芬). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASM = path.join(__dirname, 'sentence_assembly_trace');
const VOTE = path.join(__dirname, 'domain_vote_trace');
const OUT = path.join(__dirname, 'parent_fragment_retirement');

const NOISE = ['科医', '议室', '低脂', '记员', '机员', '内科医'];

const used = new Map();
const kenlm = new Map();
let kenlmHits = 0;
let casesKenlm = 0;
const kenlmSamples = [];

for (const f of fs.readdirSync(ASM).filter((x) => x.endsWith('.json'))) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(ASM, f), 'utf8'));
  } catch {
    continue;
  }
  let hit = false;
  for (const k of j.kenlmInputs || []) {
    const t = k.text || '';
    for (const s of NOISE) {
      if (t.includes(s)) {
        kenlm.set(s, (kenlm.get(s) || 0) + 1);
        kenlmHits += 1;
        hit = true;
        if (kenlmSamples.length < 30) {
          kenlmSamples.push({ caseId: j.caseId, surface: s, text: t });
        }
      }
    }
  }
  if (hit) casesKenlm += 1;
  for (const fate of j.candidateFateGlobal || []) {
    if (NOISE.includes(fate.word) && fate.finalStatus === 'USED_IN_SENTENCE') {
      used.set(fate.word, (used.get(fate.word) || 0) + 1);
    }
  }
}

let medicalFromKeyi = 0;
let casesKeyi = 0;
let pfTotal = 0;
let casesPf = 0;
const noiseVote = new Map();

for (const f of fs.readdirSync(VOTE).filter((x) => x.endsWith('.md'))) {
  const text = fs.readFileSync(path.join(VOTE, f), 'utf8');
  let hasPf = false;
  let hasKeyi = false;
  for (const line of text.split(/\n/)) {
    if (!line.includes('hitKind=parent_fragment')) continue;
    hasPf = true;
    pfTotal += 1;
    const wm = line.match(/word="([^"]+)"/);
    const w = wm ? wm[1] : '';
    if (NOISE.includes(w)) {
      noiseVote.set(w, (noiseVote.get(w) || 0) + 1);
    }
    if (w === '科医') {
      hasKeyi = true;
      if (line.includes('medical')) medicalFromKeyi += 1;
    }
  }
  if (hasPf) casesPf += 1;
  if (hasKeyi) casesKeyi += 1;
}

const summary = {
  noiseSurfaces: NOISE,
  usedInSentence: [...used.entries()],
  kenlmBySurface: [...kenlm.entries()],
  kenlmHitEvents: kenlmHits,
  casesWithNoiseInKenlm: casesKenlm,
  kenlmSamples,
  vote: {
    casesWithParentFragment: casesPf,
    totalParentFragmentLines: pfTotal,
    casesWithKeyi: casesKeyi,
    medicalTaggedKeyiLines: medicalFromKeyi,
    noiseVoteCounts: [...noiseVote.entries()],
  },
  note:
    'Excluded 线计/莓马 from noise set (substring of 上线计划/蓝莓马芬). Assembly CF from existing traces only.',
};

fs.writeFileSync(path.join(OUT, '_tight_cf.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
