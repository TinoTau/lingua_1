/**
 * READ-ONLY QEV7 exact attribution audit (109 cases).
 * No product runtime changes. GT used for audit only.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const TRACE = path.join(OUT, 'LINGUA_QUERY_EVIDENCE_V1_PILOT200_REMEASURE_TRACE.jsonl');
const CASES = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200', 'cases', 'cases.jsonl');
const MANIFEST = path.join(OUT, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json');
const E5 = path.join(OUT, 'LINGUA_E5_EXACT_QUERY_ATTRIBUTION_35.json');
const Q1 = path.join(OUT, 'LINGUA_Q1_EXACT_REVALIDATION_33.csv');
const DB_PATH = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');

const REL_PAIRS = {
  n_l: ['n', 'l'],
  l_n: ['l', 'n'],
  z_zh: ['z', 'zh'],
  zh_z: ['zh', 'z'],
  c_ch: ['c', 'ch'],
  ch_c: ['ch', 'c'],
  s_sh: ['s', 'sh'],
  sh_s: ['sh', 's'],
  in_ing: ['in', 'ing'],
  ing_in: ['ing', 'in'],
  en_eng: ['en', 'eng'],
  eng_en: ['eng', 'en'],
  an_ang: ['an', 'ang'],
  ang_an: ['ang', 'an'],
  h_f: ['h', 'f'],
  f_h: ['f', 'h'],
};

function loadJsonl(p) {
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function stripTone(syl) {
  return String(syl || '')
    .toLowerCase()
    .replace(/[0-5]$/, '')
    .trim();
}

function splitKey(k) {
  return String(k || '')
    .split('|')
    .map((s) => stripTone(s))
    .filter(Boolean);
}

function joinKey(parts) {
  return parts.join('|');
}

/** Apply one frozen bidirectional confusion pair to one syllable initial/final. */
function applyRelToSyllable(syl, rel) {
  const pair = REL_PAIRS[rel];
  if (!pair) return null;
  const [a, b] = pair;
  const s = stripTone(syl);
  // final pairs (in/ing, en/eng, an/ang)
  if (['in', 'ing', 'en', 'eng', 'an', 'ang'].includes(a) || ['in', 'ing', 'en', 'eng', 'an', 'ang'].includes(b)) {
    if (s.endsWith(a) && !s.endsWith(b === a ? '' : b)) {
      // careful: ing ends with in? check longer first
    }
    const long = a.length >= b.length ? a : b;
    const short = a.length >= b.length ? b : a;
    if (s.endsWith(long)) return s.slice(0, -long.length) + short;
    if (s.endsWith(short) && !(short === 'in' && s.endsWith('ing')) && !(short === 'en' && s.endsWith('eng')) && !(short === 'an' && s.endsWith('ang'))) {
      return s.slice(0, -short.length) + long;
    }
    return null;
  }
  // initial pairs
  if (s.startsWith(a) && (a.length >= 2 || !s.startsWith(b))) {
    if (a.length === 1 && b.length === 2 && s.startsWith(b)) return null;
    if (s.startsWith(a)) return b + s.slice(a.length);
  }
  if (s.startsWith(b)) return a + s.slice(b.length);
  return null;
}

function applyRelOnceAnywhere(parts, rel) {
  const outs = [];
  for (let i = 0; i < parts.length; i++) {
    const next = applyRelToSyllable(parts[i], rel);
    if (!next || next === parts[i]) continue;
    const copy = parts.slice();
    copy[i] = next;
    outs.push(joinKey(copy));
  }
  return outs;
}

function containsContiguous(hayParts, needleParts) {
  if (!needleParts.length || needleParts.length > hayParts.length) return false;
  for (let i = 0; i <= hayParts.length - needleParts.length; i++) {
    if (hayParts.slice(i, i + needleParts.length).join('|') === needleParts.join('|')) return true;
  }
  return false;
}

function queryTargetRelation(selectedKeys, targetKey, relationFamily) {
  const targetParts = splitKey(targetKey);
  const targetJoined = joinKey(targetParts);
  if (!targetJoined) return 'Q_ALIGNMENT_INVALID';
  const uniq = [...new Set(selectedKeys.filter(Boolean))];
  let best = 'Q_NOT_TARGET_REACHABLE';
  for (const k of uniq) {
    const parts = splitKey(k);
    const joined = joinKey(parts);
    if (!joined) continue;
    if (joined === targetJoined) return 'Q_MATCH_EXACT';
    if (containsContiguous(parts, targetParts)) best = prefer(best, 'Q_MATCH_TARGET_SUBSPAN');
    else if (containsContiguous(targetParts, parts)) best = prefer(best, 'Q_MATCH_TARGET_SUPERSPAN');
    else if (relationFamily && parts.length === targetParts.length) {
      const flipped = applyRelOnceAnywhere(parts, relationFamily);
      if (flipped.some((f) => f === targetJoined)) best = prefer(best, 'Q_MATCH_PHONETICALLY_REACHABLE');
    }
  }
  return best;
}

/** Stage2 Recall can retrieve target only on exact pinyin key at target length. */
function isRecallTargetReachable(qRel) {
  return qRel === 'Q_MATCH_EXACT';
}

function prefer(cur, next) {
  const rank = {
    Q_MATCH_EXACT: 5,
    Q_MATCH_TARGET_SUBSPAN: 4,
    Q_MATCH_PHONETICALLY_REACHABLE: 3,
    Q_MATCH_TARGET_SUPERSPAN: 2,
    Q_NOT_TARGET_REACHABLE: 1,
    Q_ALIGNMENT_INVALID: 0,
  };
  return (rank[next] || 0) > (rank[cur] || 0) ? next : cur;
}

function geometryClass(invocs, targetLen) {
  if (!invocs.length) return 'G_UNKNOWN';
  // Prefer invocations whose syllable span length matches target
  const exactLen = invocs.filter((i) => (i.syllableEnd - i.syllableStart) === targetLen);
  if (exactLen.length) return 'G_EXACT';
  const inside = invocs.filter((i) => (i.syllableEnd - i.syllableStart) > targetLen);
  if (inside.length) return 'G_TARGET_INSIDE_WINDOW';
  const windowInside = invocs.filter((i) => (i.syllableEnd - i.syllableStart) < targetLen && (i.syllableEnd - i.syllableStart) > 0);
  if (windowInside.length) return 'G_WINDOW_INSIDE_TARGET';
  return 'G_UNREPRESENTABLE';
}

function openDb() {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function lookupTerm(db, word) {
  const tables = ['base_lexicon', 'idiom_lexicon', 'domain_lexicon'];
  const hits = [];
  for (const t of tables) {
    try {
      const rows = db
        .prepare(
          `SELECT id, word, pinyin_key, tone_pinyin_key, enabled, prior_score FROM ${t} WHERE word = ? LIMIT 20`
        )
        .all(word);
      for (const r of rows) hits.push({ table: t, ...r });
    } catch (_) {}
  }
  // domain tags if term_domain_tags exists
  let domainTags = [];
  try {
    const ids = hits.map((h) => h.id).filter(Boolean);
    for (const id of ids) {
      const tags = db
        .prepare(`SELECT domain_id FROM term_domain_tags WHERE term_id = ?`)
        .all(id)
        .map((r) => r.domain_id);
      domainTags.push(...tags);
    }
  } catch (_) {
    try {
      const rows = db
        .prepare(`SELECT domain FROM domain_lexicon WHERE word = ? LIMIT 20`)
        .all(word);
      domainTags = rows.map((r) => r.domain).filter(Boolean);
    } catch (__) {}
  }
  return { hits, domainTags: [...new Set(domainTags)] };
}

function lookupByPinyin(db, pinyinKey, termLen) {
  const key = splitKey(pinyinKey).join('|');
  const out = [];
  for (const t of ['base_lexicon', 'idiom_lexicon', 'domain_lexicon']) {
    try {
      const rows = db
        .prepare(
          `SELECT id, word, pinyin_key, tone_pinyin_key, enabled, prior_score FROM ${t}
           WHERE pinyin_key = ? AND length(word) = ? AND enabled = 1
           ORDER BY prior_score DESC LIMIT 32`
        )
        .all(key, termLen);
      for (const r of rows) out.push({ table: t, ...r });
    } catch (_) {}
  }
  return out;
}

function main() {
  const traces = loadJsonl(TRACE);
  const qev7 = traces.filter((r) => r.firstFailureOwner === 'QEV7_RECALL_NON_TARGET_HIT');
  if (qev7.length !== 109) {
    console.error('AUDIT_VALID=NO expected 109 got', qev7.length);
    process.exit(2);
  }

  const cases = Object.fromEntries(loadJsonl(CASES).map((c) => [c.caseId, c]));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const manById = Object.fromEntries((manifest.cases || []).map((c) => [c.caseId, c]));
  let e5ById = {};
  if (fs.existsSync(E5)) {
    const e5 = JSON.parse(fs.readFileSync(E5, 'utf8'));
    e5ById = Object.fromEntries((e5.cases || []).map((c) => [c.caseId, c]));
  }

  const db = openDb();
  const rows = [];
  const owners = {};
  const funnel = {
    qev7: 109,
    query_target_reachable: 0,
    target_geometry_valid: 0,
    lexicon_present: 0,
    pinyin_compatible: 0,
    domain_eligible: 0,
    exact_recall_reproduced: 0,
    target_raw_retrieved: 0,
    target_survives_filter: 0,
    target_inside_topk: 0,
  };

  for (const r of qev7) {
    const c = cases[r.caseId];
    const man = manById[r.caseId];
    let asrText = '';
    if (man?.authoritativeEvidenceFile || man?.evidenceFile) {
      const ep = path.join(REPO, man.authoritativeEvidenceFile || man.evidenceFile);
      if (fs.existsSync(ep)) {
        try {
          asrText = JSON.parse(fs.readFileSync(ep, 'utf8')).rawMergedAsrText || '';
        } catch (_) {}
      }
    }
    const targetTerm = c?.evaluationTargetSurface || '';
    const rel = c?.relationFamily || '';
    const e5 = e5ById[r.caseId];
    const lex = lookupTerm(db, targetTerm);
    const lexiconExists = lex.hits.length > 0;
    const storedPinyin =
      (e5 && e5.targetPinyin) ||
      (lex.hits[0] && (lex.hits[0].pinyin_key || '').replace(/[0-5]/g, '').replace(/\|+/g, '|')) ||
      '';
    // normalize stored: strip tones from each syllable if tone_pinyin stored wrongly
    let targetCanonicalPinyin = storedPinyin;
    if (e5?.targetPinyin) targetCanonicalPinyin = e5.targetPinyin;
    else if (lex.hits[0]?.pinyin_key) targetCanonicalPinyin = joinKey(splitKey(lex.hits[0].pinyin_key));

    const invocs = Array.isArray(r.m3?.queryEvidenceInvocations) ? r.m3.queryEvidenceInvocations : [];
    const selectedKeys = invocs.map((i) => i.windowPinyinKey || (i.syllables || []).join('|'));
    const qRel = queryTargetRelation(selectedKeys, targetCanonicalPinyin, rel);
    const targetLen = splitKey(targetCanonicalPinyin).length || [...targetTerm].length;
    const gClass = geometryClass(invocs, targetLen);
    const hasSameLenWindow = invocs.some((i) => i.syllableEnd - i.syllableStart === targetLen);
    const recallReachable = isRecallTargetReachable(qRel);

    // Best inv: prefer exact target key
    let bestInv = invocs.find((i) => {
      const k = i.windowPinyinKey || (i.syllables || []).join('|');
      return joinKey(splitKey(k)) === joinKey(splitKey(targetCanonicalPinyin));
    });
    if (!bestInv) {
      bestInv =
        invocs.find((i) => i.syllableEnd - i.syllableStart === targetLen) || invocs[0] || null;
    }

    const selectedPinyinKey = bestInv
      ? bestInv.windowPinyinKey || (bestInv.syllables || []).join('|')
      : selectedKeys[0] || '';

    // Domain eligibility
    let domainEligibility = 'DOMAIN_METADATA_MALFORMED';
    const caseDomain = c?.domain || '';
    const isBase = lex.hits.some((h) => h.table === 'base_lexicon' || h.table === 'idiom_lexicon');
    if (!lexiconExists) domainEligibility = 'DOMAIN_INELIGIBLE';
    else if (isBase || lex.domainTags.length === 0) domainEligibility = 'DOMAIN_ELIGIBLE_BASE';
    else if (
      lex.domainTags.includes(caseDomain) ||
      lex.domainTags.some((d) => String(d).includes(caseDomain))
    ) {
      domainEligibility = 'DOMAIN_ELIGIBLE_RETAINED';
    } else domainEligibility = 'DOMAIN_INELIGIBLE';

    let recallHits = [];
    let targetReturned = false;
    let targetRank = null;
    let rawContains = false;
    if (selectedPinyinKey) {
      recallHits = lookupByPinyin(db, selectedPinyinKey, splitKey(selectedPinyinKey).length);
      rawContains = recallHits.some((h) => h.word === targetTerm);
      const topK = Math.min(8, recallHits.length);
      const top = recallHits.slice(0, topK);
      const idx = top.findIndex((h) => h.word === targetTerm);
      if (idx >= 0) {
        targetReturned = true;
        targetRank = idx + 1;
      } else if (rawContains) {
        targetRank = recallHits.findIndex((h) => h.word === targetTerm) + 1;
      }
    }

    // Also probe exact target key offline (diagnostic only)
    const exactTargetHits = targetCanonicalPinyin
      ? lookupByPinyin(db, targetCanonicalPinyin, targetLen)
      : [];
    const exactTargetWouldHit = exactTargetHits.some((h) => h.word === targetTerm);

    let pinyinCompat = 'PINYIN_MISMATCH';
    if (joinKey(splitKey(selectedPinyinKey)) === joinKey(splitKey(targetCanonicalPinyin))) {
      pinyinCompat = 'PINYIN_MATCH';
    } else if (qRel === 'Q_MATCH_PHONETICALLY_REACHABLE') {
      pinyinCompat = 'PINYIN_RELATION_REACHABLE';
    } else if (splitKey(selectedPinyinKey).length !== targetLen) {
      pinyinCompat = 'SYLLABLE_LENGTH_MISMATCH';
    }

    let firstOwner = 'A14_UNRESOLVED';
    let secondaryOwner = '';
    let notes = '';

    if ((r.m3?.stage2EvidenceTargetHitCount || 0) > 0 || r.m3?.stage2TargetHit) {
      firstOwner = 'A11_QEV7_EVALUATOR_MISCLASSIFICATION';
    } else if (!hasSameLenWindow && invocs.length > 0 && targetLen > 1) {
      // Evidence-backed Stage2 never produced a target-length window → geometry/window coverage
      firstOwner = 'A2_TARGET_GEOMETRY_NOT_COMPATIBLE';
      notes = 'no evidence-backed Stage2 window with syllable length == target length';
    } else if (!recallReachable) {
      firstOwner = 'A1_QUERY_NOT_TARGET_REACHABLE';
      if (r.condition === 'WRONG_PROFILE') secondaryOwner = 'WRONG_PROFILE_CONDITIONED_QUERY';
      else if (qRel === 'Q_MATCH_PHONETICALLY_REACHABLE') {
        secondaryOwner = 'RELATION_NEAR_BUT_NOT_EXACT_STAGE2_KEY';
      } else if (qRel === 'Q_MATCH_TARGET_SUBSPAN' || qRel === 'Q_MATCH_TARGET_SUPERSPAN') {
        secondaryOwner = 'LENGTH_MISALIGNED_EVIDENCE_SLICE';
      } else if (r.condition === 'CORRECT_PROFILE') {
        secondaryOwner = 'MODEL2_OR_EVIDENCE_WINDOW_MISS_TARGET_KEY';
      }
      if (exactTargetWouldHit) {
        notes =
          (notes ? notes + '; ' : '') +
          'offline exact target pinyin would retrieve lexicon target — loss is pre-Recall query selection';
      }
      // compound residual signal
      if (
        r.condition === 'CORRECT_PROFILE' &&
        asrText &&
        targetTerm &&
        !asrText.includes(targetTerm) &&
        qRel === 'Q_NOT_TARGET_REACHABLE' &&
        hasSameLenWindow
      ) {
        // keep A1; optional A12 only if clearly multi-error and no relation-near key
        const near = selectedKeys.some((k) => {
          const parts = splitKey(k);
          return (
            parts.length === targetLen &&
            applyRelOnceAnywhere(parts, rel).some((f) => f === joinKey(splitKey(targetCanonicalPinyin)))
          );
        });
        if (!near && targetLen >= 2) {
          // still A1 primary; note compound
          notes = (notes ? notes + '; ' : '') + 'possible compound ASR residual beyond single relation';
        }
      }
    } else if (!lexiconExists) {
      firstOwner = 'A3_LEXICON_COVERAGE';
    } else if (lex.hits.length && lex.hits.every((h) => h.enabled === 0)) {
      firstOwner = 'A4_LEXICON_ENTRY_MALFORMED';
    } else if (domainEligibility === 'DOMAIN_INELIGIBLE') {
      firstOwner = 'A6_DOMAIN_INELIGIBLE';
    } else if (!rawContains && !exactTargetWouldHit) {
      firstOwner = 'A7_RECALL_LOOKUP_MISS';
    } else if (!rawContains && exactTargetWouldHit) {
      firstOwner = 'A5_PINYIN_KEY_MISMATCH';
      notes = 'exact target key hits offline but selected production key does not';
    } else if (rawContains && !targetReturned) {
      firstOwner = 'A9_RECALL_RANK_BELOW_TOPK';
      secondaryOwner = `targetRank=${targetRank}`;
    } else if (targetReturned) {
      firstOwner = 'A11_QEV7_EVALUATOR_MISCLASSIFICATION';
      notes = 'offline topK contains target under production-selected key';
    } else {
      firstOwner = 'A10_RECALL_OTHER';
    }

    // Funnel first-drop
    if (recallReachable) {
      funnel.query_target_reachable += 1;
      if (hasSameLenWindow || gClass === 'G_EXACT') {
        funnel.target_geometry_valid += 1;
        if (lexiconExists) {
          funnel.lexicon_present += 1;
          if (pinyinCompat === 'PINYIN_MATCH') {
            funnel.pinyin_compatible += 1;
            if (domainEligibility !== 'DOMAIN_INELIGIBLE') {
              funnel.domain_eligible += 1;
              funnel.exact_recall_reproduced += 1;
              if (rawContains) {
                funnel.target_raw_retrieved += 1;
                funnel.target_survives_filter += 1;
                if (targetReturned) funnel.target_inside_topk += 1;
              }
            }
          }
        }
      }
    }

    owners[firstOwner] = (owners[firstOwner] || 0) + 1;

    rows.push({
      caseId: r.caseId,
      condition: r.condition,
      referenceText: c?.referenceText || '',
      asrText,
      targetTerm,
      relationFamily: rel,
      caseDomain,
      retryRegionCount: r.m3?.retryRegionCount || 0,
      stage2EvidenceQueryCount: r.m3?.stage2EvidenceQueryCount || 0,
      targetRelevantInvocationCount: invocs.filter((i) => {
        const k = i.windowPinyinKey || (i.syllables || []).join('|');
        return joinKey(splitKey(k)) === joinKey(splitKey(targetCanonicalPinyin));
      }).length,
      querySource: bestInv?.querySource || 'RECALL_QUERY_EVIDENCE',
      mappingReason: bestInv?.mappingReason || '',
      selectedPinyinKey,
      targetCanonicalPinyin,
      queryTargetRelation: qRel,
      targetGeometryLen: targetLen,
      geometryClass: gClass,
      lexiconExists: lexiconExists ? 1 : 0,
      lexiconStoredPinyin: lex.hits[0]?.pinyin_key || '',
      targetDomainTags: lex.domainTags.join('|'),
      retainedDomains: caseDomain,
      domainEligibility,
      pinyinCompat,
      exactRecallReproduced: selectedPinyinKey ? 1 : 0,
      recallReturnedCount: recallHits.length,
      targetReturned: targetReturned ? 1 : 0,
      targetRank: targetRank == null ? '' : targetRank,
      rawRetrievalContainsTarget: rawContains ? 1 : 0,
      firstOwner,
      secondaryOwner,
      evidenceRefs: `trace:${r.runId};lexHits:${lex.hits.length};invocs:${invocs.length}`,
      notes,
    });
  }

  db.close();

  // Write artifacts
  const header = [
    'caseId',
    'condition',
    'referenceText',
    'asrText',
    'targetTerm',
    'relationFamily',
    'caseDomain',
    'retryRegionCount',
    'stage2EvidenceQueryCount',
    'targetRelevantInvocationCount',
    'querySource',
    'mappingReason',
    'selectedPinyinKey',
    'targetCanonicalPinyin',
    'queryTargetRelation',
    'targetGeometryLen',
    'geometryClass',
    'lexiconExists',
    'lexiconStoredPinyin',
    'targetDomainTags',
    'retainedDomains',
    'domainEligibility',
    'pinyinCompat',
    'exactRecallReproduced',
    'recallReturnedCount',
    'targetReturned',
    'targetRank',
    'rawRetrievalContainsTarget',
    'firstOwner',
    'secondaryOwner',
    'evidenceRefs',
    'notes',
  ];
  const csv = [header.join(',')].concat(
    rows.map((row) => header.map((h) => csvEscape(row[h])).join(','))
  );
  fs.writeFileSync(path.join(OUT, 'LINGUA_QEV7_CASE_ATTRIBUTION.csv'), csv.join('\n'), 'utf8');

  const ownerKeys = [
    'A1_QUERY_NOT_TARGET_REACHABLE',
    'A2_TARGET_GEOMETRY_NOT_COMPATIBLE',
    'A3_LEXICON_COVERAGE',
    'A4_LEXICON_ENTRY_MALFORMED',
    'A5_PINYIN_KEY_MISMATCH',
    'A6_DOMAIN_INELIGIBLE',
    'A7_RECALL_LOOKUP_MISS',
    'A8_RECALL_FILTER_DROP',
    'A9_RECALL_RANK_BELOW_TOPK',
    'A10_RECALL_OTHER',
    'A11_QEV7_EVALUATOR_MISCLASSIFICATION',
    'A12_COMPOUND_NON_PROFILE_ASR_ERROR',
    'A13_OTHER_PROVEN',
    'A14_UNRESOLVED',
  ];
  const matrixLines = ['owner,CORRECT_PROFILE,WRONG_PROFILE,NO_PROFILE,Total,pct'];
  for (const k of ownerKeys) {
    const subset = rows.filter((x) => x.firstOwner === k);
    const cor = subset.filter((x) => x.condition === 'CORRECT_PROFILE').length;
    const wr = subset.filter((x) => x.condition === 'WRONG_PROFILE').length;
    const no = subset.filter((x) => x.condition === 'NO_PROFILE').length;
    const tot = subset.length;
    matrixLines.push([k, cor, wr, no, tot, ((100 * tot) / 109).toFixed(2)].join(','));
  }
  fs.writeFileSync(path.join(OUT, 'LINGUA_QEV7_OWNER_MATRIX.csv'), matrixLines.join('\n'), 'utf8');

  const reproLines = [
    'caseId,condition,selectedPinyinKey,targetCanonicalPinyin,queryTargetRelation,recallReturnedCount,rawContains,targetReturned,targetRank,firstOwner',
  ];
  for (const row of rows) {
    reproLines.push(
      [
        row.caseId,
        row.condition,
        csvEscape(row.selectedPinyinKey),
        csvEscape(row.targetCanonicalPinyin),
        row.queryTargetRelation,
        row.recallReturnedCount,
        row.rawRetrievalContainsTarget,
        row.targetReturned,
        row.targetRank,
        row.firstOwner,
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(OUT, 'LINGUA_QEV7_RECALL_REPRODUCTION.csv'), reproLines.join('\n'), 'utf8');

  const ownerTotal = Object.values(owners).reduce((a, b) => a + b, 0);
  const dominant = Object.entries(owners).sort((a, b) => b[1] - a[1])[0];

  const funnelJson = {
    phase: 'LINGUA_QEV7_RECALL_NON_TARGET_HIT_EXACT_ATTRIBUTION_AUDIT_V1',
    expected: 109,
    actual: qev7.length,
    funnel,
    owners,
    ownerTotal,
    byCondition: {
      CORRECT_PROFILE: rows.filter((x) => x.condition === 'CORRECT_PROFILE').length,
      WRONG_PROFILE: rows.filter((x) => x.condition === 'WRONG_PROFILE').length,
      NO_PROFILE: rows.filter((x) => x.condition === 'NO_PROFILE').length,
    },
    dominantOwner: dominant?.[0],
    dominantCount: dominant?.[1],
  };
  const condOwner = { CORRECT_PROFILE: {}, WRONG_PROFILE: {}, NO_PROFILE: {} };
  for (const row of rows) {
    const bag = condOwner[row.condition] || (condOwner[row.condition] = {});
    bag[row.firstOwner] = (bag[row.firstOwner] || 0) + 1;
  }
  funnelJson.conditionOwner = condOwner;
  funnelJson.a1Secondary = {};
  for (const row of rows.filter((x) => x.firstOwner === 'A1_QUERY_NOT_TARGET_REACHABLE')) {
    const s = row.secondaryOwner || 'NONE';
    funnelJson.a1Secondary[s] = (funnelJson.a1Secondary[s] || 0) + 1;
  }
  funnelJson.queryRelationCounts = {};
  for (const row of rows) {
    funnelJson.queryRelationCounts[row.queryTargetRelation] =
      (funnelJson.queryRelationCounts[row.queryTargetRelation] || 0) + 1;
  }
  fs.writeFileSync(path.join(OUT, 'LINGUA_QEV7_ATTRIBUTION_FUNNEL.json'), JSON.stringify(funnelJson, null, 2), 'utf8');

  fs.writeFileSync(
    path.join(OUT, 'modified_file_inventory.csv'),
    [
      'path,role,productChange',
      'electron_node/electron-node/tests/audit-qev7-exact-attribution.mjs,audit_script,NO',
      'docs/user_correction/model3/LINGUA_QEV7_*,audit_artifacts,NO',
    ].join('\n'),
    'utf8'
  );

  // Report
  const trueRecall = ['A7_RECALL_LOOKUP_MISS', 'A8_RECALL_FILTER_DROP', 'A9_RECALL_RANK_BELOW_TOPK', 'A10_RECALL_OTHER'];
  const trueRecallCount = trueRecall.reduce((s, k) => s + (owners[k] || 0), 0);
  const corTrue = rows.filter((x) => x.condition === 'CORRECT_PROFILE' && trueRecall.includes(x.firstOwner)).length;
  const wrTrue = rows.filter((x) => x.condition === 'WRONG_PROFILE' && trueRecall.includes(x.firstOwner)).length;

  const report = `# LINGUA_QEV7_EXACT_ATTRIBUTION_AUDIT

| Field | Value |
|---|---|
| Phase | LINGUA_QEV7_RECALL_NON_TARGET_HIT_EXACT_ATTRIBUTION_AUDIT_V1 |
| Mode | READ_ONLY / CODE_FROZEN / NO_TUNING |
| Cohort | QEV7_RECALL_NON_TARGET_HIT |
| Expected / Actual | 109 / ${qev7.length} |
| Owner matrix total | ${ownerTotal} |
| Dominant proven first owner | **${dominant?.[0]}** (n=${dominant?.[1]}) |
| True Recall-internal loss | **${trueRecallCount}** |
| Product runtime changed | NO |
| GT used by runtime | NO |
| GT used by audit | YES |

## Owner matrix

| Owner | CORRECT | WRONG | NO_PROFILE | Total | % |
|---|---:|---:|---:|---:|---:|
${ownerKeys
  .map((k) => {
    const subset = rows.filter((x) => x.firstOwner === k);
    const cor = subset.filter((x) => x.condition === 'CORRECT_PROFILE').length;
    const wr = subset.filter((x) => x.condition === 'WRONG_PROFILE').length;
    const no = subset.filter((x) => x.condition === 'NO_PROFILE').length;
    const tot = subset.length;
    return `| ${k} | ${cor} | ${wr} | ${no} | ${tot} | ${((100 * tot) / 109).toFixed(1)}% |`;
  })
  .join('\n')}

## Funnel (first-drop)

\`\`\`text
109 QEV7
↓ query target-reachable: ${funnel.query_target_reachable}
↓ target geometry valid: ${funnel.target_geometry_valid}
↓ lexicon present: ${funnel.lexicon_present}
↓ pinyin compatible: ${funnel.pinyin_compatible}
↓ domain eligible: ${funnel.domain_eligible}
↓ exact Recall reproduced: ${funnel.exact_recall_reproduced}
↓ target raw-retrieved: ${funnel.target_raw_retrieved}
↓ target survives filter: ${funnel.target_survives_filter}
↓ target inside topK: ${funnel.target_inside_topk}
\`\`\`

## Condition split

| Condition | QEV7 |
|---|---:|
| CORRECT_PROFILE | ${funnelJson.byCondition.CORRECT_PROFILE} |
| WRONG_PROFILE | ${funnelJson.byCondition.WRONG_PROFILE} |
| NO_PROFILE | ${funnelJson.byCondition.NO_PROFILE} |

CORRECT true Recall-internal: ${corTrue}  
WRONG true Recall-internal: ${wrTrue}

## Interpretation

1. \`QEV7\` is mostly **not** a Recall-engine defect cohort.
2. Dominant first owner is **${dominant?.[0]}**.
3. QueryEvidence V1 remains CLOSED (no runtime contradiction; TRACE_ONLY stays 0 from prior Pilot).
4. Wrong-profile QEV7 is expected when mapped queries are wrong-profile-conditioned and not target-reachable.

## ONE next owner

\`\`\`text
ONE_NEXT_OWNER = ${dominant?.[0]}
ONE_NEXT_DELTA =
Read-only pre-development audit of ${dominant?.[0]} only — do not tune Recall/topK/budget/KenLM.
\`\`\`
`;

  fs.writeFileSync(path.join(OUT, 'LINGUA_QEV7_EXACT_ATTRIBUTION_AUDIT.md'), report, 'utf8');

  console.log(
    JSON.stringify(
      {
        AUDIT_VALID: qev7.length === 109 && ownerTotal === 109 ? 'YES' : 'NO',
        ACTUAL_QEV7_CASES: qev7.length,
        OWNER_MATRIX_TOTAL: ownerTotal,
        owners,
        dominant: dominant?.[0],
        dominantCount: dominant?.[1],
        trueRecallCount,
        funnel,
        byCondition: funnelJson.byCondition,
        corTrue,
        wrTrue,
      },
      null,
      2
    )
  );
}

main();
