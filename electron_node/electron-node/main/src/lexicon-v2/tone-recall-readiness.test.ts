/**
 * Batch 1.1C — ToneRecallReadiness SSOT unit tests.
 */
import { describe, expect, it } from '@jest/globals';
import {
  resolveToneRecallReadiness,
  toneRecallSkipDiagnosticCode,
} from './tone-recall-readiness';

describe('resolveToneRecallReadiness (Mandatory Tone Recall SSOT)', () => {
  it('ready when pattern length matches and tones are legal', () => {
    const r = resolveToneRecallReadiness({
      syllables: ['dian'],
      runtimeSupportsTone: true,
      acousticTonePattern: [3],
    });
    expect(r).toEqual({ state: 'ready', tonePinyinKey: 'dian3' });
  });

  it('caller_disabled wins over pattern presence', () => {
    const r = resolveToneRecallReadiness({
      syllables: ['dian'],
      runtimeSupportsTone: true,
      acousticTonePattern: [3],
      toneCallerEnabled: false,
    });
    expect(r).toEqual({ state: 'caller_disabled' });
    expect(toneRecallSkipDiagnosticCode('caller_disabled')).toBe('tone_caller_disabled');
  });

  it('runtime_unsupported when Runtime lacks tone lookup', () => {
    const r = resolveToneRecallReadiness({
      syllables: ['dian'],
      runtimeSupportsTone: false,
      acousticTonePattern: [3],
    });
    expect(r).toEqual({ state: 'runtime_unsupported' });
  });

  it('no_pattern when pattern missing', () => {
    expect(
      resolveToneRecallReadiness({
        syllables: ['dian'],
        runtimeSupportsTone: true,
      })
    ).toEqual({ state: 'no_pattern' });
    expect(
      resolveToneRecallReadiness({
        syllables: ['dian'],
        runtimeSupportsTone: true,
        acousticTonePattern: [],
      })
    ).toEqual({ state: 'no_pattern' });
  });

  it('invalid_pattern when length mismatch or illegal tone', () => {
    expect(
      resolveToneRecallReadiness({
        syllables: ['jia', 'yi'],
        runtimeSupportsTone: true,
        acousticTonePattern: [3],
      })
    ).toEqual({ state: 'invalid_pattern' });
    expect(
      resolveToneRecallReadiness({
        syllables: ['dian'],
        runtimeSupportsTone: true,
        acousticTonePattern: [9],
      })
    ).toEqual({ state: 'invalid_pattern' });
  });

  it('order: caller_disabled before runtime_unsupported before no_pattern', () => {
    expect(
      resolveToneRecallReadiness({
        syllables: ['dian'],
        runtimeSupportsTone: false,
        toneCallerEnabled: false,
      }).state
    ).toBe('caller_disabled');
    expect(
      resolveToneRecallReadiness({
        syllables: ['dian'],
        runtimeSupportsTone: false,
      }).state
    ).toBe('runtime_unsupported');
  });
});
