/**
 * SINGLE_CHAR_COLLECTOR_TRACE_V1 — pure taxonomy.
 * Does not define new collector behavior; classifies already-computed snapshots.
 */
import { describe, expect, it } from '@jest/globals';
import {
  classifyLength1CollectorTerminal,
  type Length1CollectorSnapshot,
} from './single-char-collector-trace';

function snap(partial: Partial<Length1CollectorSnapshot>): Length1CollectorSnapshot {
  return {
    syllablesLength: 1,
    pinyinKey: 'dian',
    windowText: '点',
    windowTextCanonical: '点',
    readinessState: 'ready',
    sqlExecuted: true,
    sqlLimit: 8,
    sqlHitCount: 0,
    eligibleHitCount: 0,
    truncated: false,
    identityLookupRan: false,
    identitySqlHitCount: 0,
    identityEligibleCount: 0,
    chosenSource: null,
    chosenWord: null,
    candidateScore: null,
    minCandidateScore: 0,
    scoreRejected: false,
    hitPresent: false,
    canonicalInSqlHits: false,
    ...partial,
  };
}

describe('classifyLength1CollectorTerminal (mutually exclusive terminals)', () => {
  it('NOT_APPLICABLE_WINDOW_LENGTH', () => {
    expect(classifyLength1CollectorTerminal(snap({ syllablesLength: 2 }))).toBe(
      'NOT_APPLICABLE_WINDOW_LENGTH'
    );
  });

  it('NO_QUERY_KEY', () => {
    expect(classifyLength1CollectorTerminal(snap({ pinyinKey: '' }))).toBe('NO_QUERY_KEY');
  });

  it('NO_TONE_PATTERN vs TONE_READINESS_NOT_READY', () => {
    expect(classifyLength1CollectorTerminal(snap({ readinessState: 'no_pattern' }))).toBe(
      'NO_TONE_PATTERN'
    );
    expect(
      classifyLength1CollectorTerminal(snap({ readinessState: 'runtime_unsupported' }))
    ).toBe('TONE_READINESS_NOT_READY');
  });

  it('SQL_NOT_EXECUTED when ready but no SQL', () => {
    expect(classifyLength1CollectorTerminal(snap({ sqlExecuted: false }))).toBe('SQL_NOT_EXECUTED');
  });

  it('SQL_NO_HIT', () => {
    expect(classifyLength1CollectorTerminal(snap({ sqlHitCount: 0 }))).toBe('SQL_NO_HIT');
  });

  it('INVALID_ROW when raw hits exist but none eligible', () => {
    expect(
      classifyLength1CollectorTerminal(snap({ sqlHitCount: 2, eligibleHitCount: 0 }))
    ).toBe('INVALID_ROW');
  });

  it('LIMIT_TRUNCATION_REJECT residual singleton', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({ sqlHitCount: 8, eligibleHitCount: 1, truncated: true })
      )
    ).toBe('LIMIT_TRUNCATION_REJECT');
  });

  it('NORMALIZATION_SURFACE_MISMATCH overlays script fold', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({
          windowText: '點',
          windowTextCanonical: '点',
          sqlHitCount: 3,
          eligibleHitCount: 3,
          canonicalInSqlHits: true,
        })
      )
    ).toBe('NORMALIZATION_SURFACE_MISMATCH');
  });

  it('MULTIPLE_TONE_EXACT_CANDIDATES', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({ sqlHitCount: 3, eligibleHitCount: 3, identityLookupRan: true })
      )
    ).toBe('MULTIPLE_TONE_EXACT_CANDIDATES');
  });

  it('SURFACE_EXACT_MISS unique eligible but identity miss', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({
          sqlHitCount: 1,
          eligibleHitCount: 1,
          identityLookupRan: true,
          identityEligibleCount: 0,
        })
      )
    ).toBe('SURFACE_EXACT_MISS');
  });

  it('NO_TONE_EXACT_CANDIDATE', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({ sqlHitCount: 1, eligibleHitCount: 0, identityLookupRan: true })
      )
    ).toBe('INVALID_ROW');
    expect(
      classifyLength1CollectorTerminal(
        snap({
          sqlHitCount: 2,
          eligibleHitCount: 0,
          identitySqlHitCount: 1,
          identityEligibleCount: 0,
          identityLookupRan: true,
        })
      )
    ).toBe('INVALID_ROW');
  });

  it('MIN_SCORE_REJECT', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({
          sqlHitCount: 1,
          eligibleHitCount: 1,
          scoreRejected: true,
          chosenWord: '点',
        })
      )
    ).toBe('MIN_SCORE_REJECT');
  });

  it('ACCEPT_UNIQUE_TONE_EXACT / ACCEPT_SURFACE_EXACT', () => {
    expect(
      classifyLength1CollectorTerminal(
        snap({
          hitPresent: true,
          chosenSource: 'unique_tone_exact',
          chosenWord: '点',
          eligibleHitCount: 1,
          sqlHitCount: 1,
        })
      )
    ).toBe('ACCEPT_UNIQUE_TONE_EXACT');
    expect(
      classifyLength1CollectorTerminal(
        snap({
          hitPresent: true,
          chosenSource: 'page_surface_exact',
          chosenWord: '他',
          eligibleHitCount: 3,
          sqlHitCount: 3,
        })
      )
    ).toBe('ACCEPT_SURFACE_EXACT');
  });
});
