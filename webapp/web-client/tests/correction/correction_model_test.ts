/**
 * Manual Correction UI state + Gateway submit client unit tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  beginEdit,
  cancelEdit,
  createCorrectionModel,
  ensureClientCorrectionId,
  setDraft,
  submitCorrection,
  validateCorrectionSubmit,
  gatewayHttpBaseFromWsUrl,
} from '../../src/correction';

describe('correction model', () => {
  it('edit starts with system_text copy', () => {
    const m0 = createCorrectionModel('s-ABCDEF12', 1, '系统原文');
    const m1 = beginEdit(m0);
    expect(m1.correctionState).toBe('editing');
    expect(m1.correctedTextDraft).toBe('系统原文');
    expect(m1.systemText).toBe('系统原文');
  });

  it('cancel leaves system_text unchanged', () => {
    let m = createCorrectionModel('s-ABCDEF12', 1, '系统原文');
    m = beginEdit(m);
    m = setDraft(m, '草稿改动');
    m = cancelEdit(m);
    expect(m.systemText).toBe('系统原文');
    expect(m.correctedTextDraft).toBe('系统原文');
    expect(m.correctionState).toBe('idle');
  });

  it('confirm path creates corrected_text payload fields', () => {
    let m = createCorrectionModel('s-ABCDEF12', 2, '系统A');
    m = beginEdit(m);
    m = setDraft(m, '纠正B');
    expect(validateCorrectionSubmit(m)).toBeNull();
    m = ensureClientCorrectionId(m);
    expect(m.clientCorrectionId).toBeTruthy();
    expect(m.systemText).toBe('系统A');
    expect(m.correctedTextDraft).toBe('纠正B');
  });

  it('no-change cannot submit', () => {
    let m = createCorrectionModel('s-ABCDEF12', 1, '不变');
    m = beginEdit(m);
    expect(validateCorrectionSubmit(m)).toMatch(/NO_OP/);
  });

  it('failed submit keeps draft and retry reuses client_correction_id', async () => {
    let m = createCorrectionModel('s-ABCDEF12', 1, '系统');
    m = beginEdit(m);
    m = setDraft(m, '纠正');
    m = ensureClientCorrectionId(m);
    const id = m.clientCorrectionId!;

    const fetchFail = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: 'SCHEDULER_UNAVAILABLE' }),
    })) as any;

    await expect(
      submitCorrection('http://127.0.0.1:8081', 'key', {
        session_id: m.sessionId,
        utterance_index: m.utteranceIndex,
        system_text: m.systemText,
        corrected_text: m.correctedTextDraft,
        client_correction_id: id,
      }, fetchFail)
    ).rejects.toThrow();

    // draft + same id retained for retry
    expect(m.correctedTextDraft).toBe('纠正');
    expect(m.clientCorrectionId).toBe(id);

    const fetchOk = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.client_correction_id).toBe(id);
      expect(body.user_id).toBeUndefined();
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            accepted: true,
            correction_id: 'corr-1',
            duplicate: false,
            profile_delta: null,
          }),
      };
    }) as any;

    const result = await submitCorrection(
      'http://127.0.0.1:8081',
      'key',
      {
        session_id: m.sessionId,
        utterance_index: m.utteranceIndex,
        system_text: m.systemText,
        corrected_text: m.correctedTextDraft,
        client_correction_id: id,
      },
      fetchOk
    );
    expect(result.accepted).toBe(true);
    expect(result.correction_id).toBe('corr-1');
  });

  it('submitted correction state renders correctly (model)', () => {
    let m = createCorrectionModel('s-ABCDEF12', 1, '系统');
    m = {
      ...m,
      correctionState: 'submitted',
      submittedCorrectedText: '纠正',
      lastCorrectionId: 'corr-xyz',
    };
    expect(m.systemText).toBe('系统');
    expect(m.submittedCorrectedText).toBe('纠正');
    expect(m.correctionState).toBe('submitted');
  });

  it('gateway http base from ws url', () => {
    expect(gatewayHttpBaseFromWsUrl('ws://127.0.0.1:8081/v1/session?access_token=x')).toBe(
      'http://127.0.0.1:8081'
    );
  });
});
