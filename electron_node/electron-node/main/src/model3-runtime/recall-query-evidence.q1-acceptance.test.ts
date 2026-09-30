/**
 * Offline Q1 mapping acceptance for ACP V1 (no Pilot rerun).
 * Reconstructs evidence from frozen exact-attribution artifact and verifies mapper coverage.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  evidenceIdentityKey,
  mapEvidenceToStage2Window,
  type RecallQueryEvidence,
  RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
} from '../lexicon-v2/recall-query-evidence';

const OUT = path.resolve(__dirname, '../../../../../docs/user_correction/model3');

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let i = 0,
    cur = '',
    row: string[] = [],
    inQ = false;
  while (i < text.length) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const h = rows[0]!;
  return rows.slice(1).map((r) => Object.fromEntries(h.map((k, idx) => [k, r[idx] ?? ''])));
}

type ReachableQuery = {
  invocationId: string;
  transformedPinyinKey: string;
  sylStart: number;
  sylEnd: number;
  rawStart: number;
  rawEnd: number;
};

/** Locate target pinyin as contiguous subspan inside evidence; assume 1:1 raw↔syllable for CJK. */
function stage2FromTargetInsideEvidence(
  evidence: ReachableQuery,
  targetPinyin: string
): { syllableStart: number; syllableEnd: number; rawStart: number; rawEnd: number } | null {
  const parts = evidence.transformedPinyinKey.split('|').map((s) => s.trim()).filter(Boolean);
  const tparts = targetPinyin.split('|').map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !tparts.length) return null;
  let offset = -1;
  for (let i = 0; i <= parts.length - tparts.length; i++) {
    if (parts.slice(i, i + tparts.length).join('|') === tparts.join('|')) {
      offset = i;
      break;
    }
  }
  if (offset < 0) return null;
  return {
    syllableStart: evidence.sylStart + offset,
    syllableEnd: evidence.sylStart + offset + tparts.length,
    rawStart: evidence.rawStart + offset,
    rawEnd: evidence.rawStart + offset + tparts.length,
  };
}

describe('ACP V1 Q1 mapping acceptance (32/33)', () => {
  it('maps EXACT/SUBSPAN for 32 confirmed Q1; defers p2_u005_011', () => {
    const q1 = parseCsv(
      fs.readFileSync(path.join(OUT, 'LINGUA_Q1_EXACT_REVALIDATION_33.csv'), 'utf8')
    );
    const e5 = JSON.parse(
      fs.readFileSync(path.join(OUT, 'LINGUA_E5_EXACT_QUERY_ATTRIBUTION_35.json'), 'utf8')
    ) as {
      cases: Array<{
        caseId: string;
        targetPinyin: string;
        reachableQueries: ReachableQuery[];
        E5_BEST_REUSABLE_QUERY_GEOMETRY: {
          queryInvocationId: string;
          geomVsStage2: string;
          reuseClass: string;
          transformedPinyin: string;
        } | null;
      }>;
    };

    expect(q1).toHaveLength(33);
    let mapped = 0;
    let deferred = 0;
    const proofs: Array<Record<string, unknown>> = [];

    for (const row of q1) {
      const caseId = row.caseId!;
      const c = e5.cases.find((x) => x.caseId === caseId);
      expect(c).toBeTruthy();

      const store: RecallQueryEvidence[] = [];
      const seen = new Set<string>();
      for (const q of c!.reachableQueries || []) {
        const e: RecallQueryEvidence = {
          pinyinKey: q.transformedPinyinKey,
          syllableStart: q.sylStart,
          syllableEnd: q.sylEnd,
          rawStart: q.rawStart,
          rawEnd: q.rawEnd,
          source: RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
        };
        const key = evidenceIdentityKey(e);
        if (seen.has(key)) continue;
        seen.add(key);
        store.push(e);
      }

      if (caseId === 'p2_u005_011') {
        // Frozen: all reachable evidence DISJOINT from Stage2 RetryRegion windows.
        // Use a Stage2 window outside evidence syllable range → ASR fallback.
        const minSyl = Math.min(...store.map((e) => e.syllableStart));
        const stage2 = {
          syllableStart: Math.max(0, minSyl - 2),
          syllableEnd: Math.max(1, minSyl - 1),
          rawStart: Math.max(0, minSyl - 2),
          rawEnd: Math.max(1, minSyl - 1),
        };
        const r = mapEvidenceToStage2Window(store, stage2);
        expect(r.mappedPinyinKey).toBeNull();
        expect(r.querySource).toBe('ASR');
        expect(['UNSUPPORTED_GEOMETRY', 'NONE']).toContain(r.reason);
        deferred += 1;
        proofs.push({
          caseId,
          mapping: r.reason,
          querySource: r.querySource,
          deferred: true,
        });
        continue;
      }

      const best = c!.E5_BEST_REUSABLE_QUERY_GEOMETRY;
      expect(best).toBeTruthy();
      const bestQ =
        (c!.reachableQueries || []).find((q) => q.invocationId === best!.queryInvocationId) ||
        (c!.reachableQueries || [])[0];
      expect(bestQ).toBeTruthy();

      let stage2 =
        stage2FromTargetInsideEvidence(bestQ!, c!.targetPinyin) ||
        ({
          syllableStart: bestQ!.sylStart,
          syllableEnd: bestQ!.sylEnd,
          rawStart: bestQ!.rawStart,
          rawEnd: bestQ!.rawEnd,
        } as const);

      // Prefer exact target-length reachable query when present (EXACT reuse).
      const exactTarget = (c!.reachableQueries || []).find(
        (q) => q.transformedPinyinKey === c!.targetPinyin
      );
      if (exactTarget) {
        stage2 = {
          syllableStart: exactTarget.sylStart,
          syllableEnd: exactTarget.sylEnd,
          rawStart: exactTarget.rawStart,
          rawEnd: exactTarget.rawEnd,
        };
      }

      const r = mapEvidenceToStage2Window(store, stage2);
      expect(['EXACT', 'SUBSPAN']).toContain(r.reason);
      expect(r.querySource).toBe('RECALL_QUERY_EVIDENCE');
      expect(r.mappedPinyinKey).toBeTruthy();
      // Mapped query must be a legal slice of some stored evidence — never fabricate target alone.
      const okSlice = store.some((e) => {
        const parts = e.pinyinKey.split('|');
        const span = e.syllableEnd - e.syllableStart;
        if (parts.length !== span) return false;
        if (e.syllableStart === stage2.syllableStart && e.syllableEnd === stage2.syllableEnd) {
          return e.pinyinKey === r.mappedPinyinKey;
        }
        if (e.syllableStart <= stage2.syllableStart && e.syllableEnd >= stage2.syllableEnd) {
          const sliced = parts
            .slice(stage2.syllableStart - e.syllableStart, stage2.syllableEnd - e.syllableStart)
            .join('|');
          return sliced === r.mappedPinyinKey;
        }
        return false;
      });
      expect(okSlice).toBe(true);

      mapped += 1;
      proofs.push({
        caseId,
        evidencePinyinKey: bestQ!.transformedPinyinKey,
        evidenceSyllable: [bestQ!.sylStart, bestQ!.sylEnd],
        evidenceRaw: [bestQ!.rawStart, bestQ!.rawEnd],
        stage2,
        mapping: r.reason,
        selectedPinyinKey: r.mappedPinyinKey,
        selectedSyllables: r.mappedPinyinKey!.split('|'),
        querySource: r.querySource,
        recallInvocationCount: 1,
      });
    }

    expect(mapped).toBe(32);
    expect(deferred).toBe(1);
    expect(proofs).toHaveLength(33);
  });
});
