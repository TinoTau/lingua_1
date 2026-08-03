import { describe, expect, it } from '@jest/globals';
import type { JobContext } from './context/job-context';
import { buildUtteranceToneFromSsot, normalizeToneEvidenceProduction } from './utterance-tone-ssot';
import { buildCoreResultExtra } from './result-builder-core';
import type { JobAssignMessage } from '@shared/protocols/messages';

function slice(start: number, end: number, t1 = 0.9) {
  return {
    start,
    end,
    confidence: t1,
    tonePosterior: { t1, t2: 0.025, t3: 0.025, t4: 0.025, t5: 0.025 },
  };
}

describe('utterance-tone SSOT export', () => {
  it('exports all multi-batch slices from ctx.acousticToneSlices (not first-batch asrResult.tone)', () => {
    const batch0 = [slice(0.0, 0.1), slice(0.1, 0.2), slice(0.2, 0.3)];
    const batch1 = [slice(1.0, 1.1), slice(1.1, 1.2), slice(1.2, 1.3), slice(1.3, 1.4), slice(1.4, 1.5)];
    const batch2 = [slice(2.0, 2.1), slice(2.1, 2.2), slice(2.2, 2.3), slice(2.3, 2.4)];
    const all = [...batch0, ...batch1, ...batch2];

    const ctx: JobContext = {
      acousticToneSlices: all,
      toneEvidenceProduction: normalizeToneEvidenceProduction(
        [
          {
            word: 'a',
            startSec: 0,
            endSec: 0.1,
            durationSec: 0.1,
            segmentIndex: 0,
            status: 'slice_created',
          },
        ],
        0,
        0
      ),
      // First-batch-only trap: must NOT be used for slices
      asrResult: {
        text: 'x',
        tone: {
          toneEnabled: true,
          acousticToneSlices: batch0,
          sliceCount: 3,
        },
      },
    };

    const payload = buildUtteranceToneFromSsot(ctx);
    expect(payload).toBeDefined();
    expect(payload!.sliceCount).toBe(12);
    expect(payload!.acousticToneSlices).toHaveLength(12);
    expect(payload!.acousticToneSlices.map((s) => s.start)).toEqual(
      all.map((s) => s.start).sort((a, b) => a - b)
    );
    // Posteriors unchanged (same object values)
    expect(payload!.acousticToneSlices[0].tonePosterior.t1).toBe(0.9);

    const extra = buildCoreResultExtra({ job_id: 'j1' } as JobAssignMessage, ctx);
    const ut = extra.utterance_tone as { sliceCount: number; acousticToneSlices: unknown[] };
    expect(ut.sliceCount).toBe(12);
    expect(ut.acousticToneSlices).toHaveLength(12);
  });

  it('offsets evidence production times once per batch', () => {
    const rows = normalizeToneEvidenceProduction(
      [
        {
          word: '点',
          startSec: 0.1,
          endSec: 0.2,
          durationSec: 0.1,
          segmentIndex: 0,
          status: 'short_duration_skipped',
          errorCode: 'below_min_slice_sec',
        },
      ],
      3.5,
      2
    );
    expect(rows[0].startSec).toBeCloseTo(3.6);
    expect(rows[0].endSec).toBeCloseTo(3.7);
    expect(rows[0].batchIndex).toBe(2);
    expect(rows[0].status).toBe('short_duration_skipped');
  });
});
