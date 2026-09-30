/**
 * Pre-edge Model2 geometry + candidate merge — structural unit tests (no host required for geometry).
 */
import { describe, expect, it } from '@jest/globals';
import { buildWindowEvidence } from '../../model2-runtime/window-evidence';
import { buildModel2PolicyInput } from '../../model2-runtime/finespan-adapter';
import { mergeProfileIntoWindowCandidates } from '../../model2-runtime/merge-profile-candidates';
import { hypothesizeIntendedSyllables } from '../../model2-runtime/relation-direction';
import { buildLexicalEdges } from './build-lexical-edges';
import type { GlobalWindowDescriptor, WindowCandidate } from './v4-types';

function windowDesc(
  text: string,
  syllables: string[],
  start = 0
): GlobalWindowDescriptor {
  const end = start + syllables.length;
  return {
    windowId: `${start}:${end}`,
    syllableStart: start,
    syllableEnd: end,
    rawStart: 0,
    rawEnd: text.length,
    windowText: text,
    windowPinyinKey: syllables.join('|'),
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
  };
}

function cand(partial: Partial<WindowCandidate> & { candidateId: string; windowId: string }): WindowCandidate {
  return {
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 3,
    rawStart: 0,
    rawEnd: 3,
    windowPinyinKey: 'li|shou|bu',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    replacement: '礼宾部',
    termId: 'term-libinbu',
    source: 'base_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: false,
    retrievalProvenance: 'PROFILE_PRONUNCIATION',
    ...partial,
  };
}

describe('Model2 pre-edge SSOT structural contracts', () => {
  it('preserves multi-char window syllable length through relation transform', () => {
    const syllables = ['li', 'shou', 'bu'];
    const { syllables: hyp, nChanged } = hypothesizeIntendedSyllables(syllables, 'n_l');
    expect(hyp.length).toBe(3);
    expect(nChanged).toBeGreaterThan(0);
    const w = windowDesc('李守步', syllables);
    const ev = buildWindowEvidence({
      window: w,
      rawText: '李守步',
      globalSyllables: syllables,
      baseCandidates: [],
      acousticTonePattern: [1, 2, 3],
    });
    expect(ev.spanSyllables.length).toBe(3);
    const policy = buildModel2PolicyInput({
      evidence: ev,
      profile: { schema_version: 1, profile_version: 1, phonetic_bias: { n_l: 0.9 } },
    });
    expect(policy?.spanSyllables.length).toBe(3);
    expect(policy?.spanId).toBe('0:3');
  });

  it('Base miss + Model2 hit yields LexicalEdge; double miss yields none', () => {
    const w = windowDesc('李守步', ['li', 'shou', 'bu']);
    const profileHit = cand({
      candidateId: 'm2:0:3:1',
      windowId: w.windowId,
      originSpanId: w.windowId,
    });
    const merged = mergeProfileIntoWindowCandidates([], [profileHit]);
    expect(merged.introducedTermIds).toContain('term-libinbu');
    const edges = buildLexicalEdges({
      recalledWindows: [
        {
          windowId: w.windowId,
          syllableStart: 0,
          syllableEnd: 3,
          candidates: merged.merged,
        },
      ],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.syllableEnd - edges[0]!.syllableStart).toBe(3);
    expect(edges[0]!.candidates[0]!.retrievalProvenance).toBe('PROFILE_PRONUNCIATION');

    const empty = buildLexicalEdges({
      recalledWindows: [
        { windowId: w.windowId, syllableStart: 0, syllableEnd: 3, candidates: [] },
      ],
    });
    expect(empty).toHaveLength(0);
  });
});
