/**
 * Build utterance_tone JobResult export from the production Tone Evidence SSOT.
 * SSOT = ctx.acousticToneSlices (utterance-local, multi-batch merged).
 * Does not re-infer or invent posteriors.
 */

import type {
  AcousticToneSlice,
  ToneEvidenceProductionDiagnostic,
  UtteranceAcousticTonePayload,
} from '../task-router/types';
import type { JobContext } from './context/job-context';

export function normalizeToneEvidenceProduction(
  rows: ToneEvidenceProductionDiagnostic[] | undefined | null,
  batchOffsetSec = 0,
  batchIndex?: number
): ToneEvidenceProductionDiagnostic[] {
  if (!rows?.length) {
    return [];
  }
  return rows.map((row) => ({
    word: row.word ?? '',
    startSec: Number((row as any).startSec ?? (row as any).start ?? 0) + batchOffsetSec,
    endSec: Number((row as any).endSec ?? (row as any).end ?? 0) + batchOffsetSec,
    durationSec: Number(
      (row as any).durationSec ??
        (Number((row as any).endSec ?? (row as any).end ?? 0) -
          Number((row as any).startSec ?? (row as any).start ?? 0))
    ),
    segmentIndex: Number(row.segmentIndex ?? (row as any).segment_index ?? 0),
    batchIndex: batchIndex ?? row.batchIndex,
    status: row.status,
    errorCode: row.errorCode ?? (row as any).error_code,
  }));
}

export function buildUtteranceToneFromSsot(ctx: JobContext): UtteranceAcousticTonePayload | undefined {
  const slices = [...(ctx.acousticToneSlices ?? [])].sort((a, b) => a.start - b.start);
  const evidenceProduction = [...(ctx.toneEvidenceProduction ?? [])].sort(
    (a, b) => a.startSec - b.startSec
  );
  const meta = ctx.asrResult?.tone;
  const toneModule = (ctx.asrDiagnostics?.toneModule ??
    (ctx.asrResult?.diagnostics as Record<string, unknown> | undefined)?.toneModule) as
    | Record<string, unknown>
    | undefined;

  if (!slices.length && !evidenceProduction.length && !meta) {
    return undefined;
  }

  let toneConfidenceAvg: number | undefined;
  if (slices.length) {
    const sum = slices.reduce((acc, s) => acc + (s.confidence ?? 0), 0);
    toneConfidenceAvg = sum / slices.length;
  } else if (meta?.toneConfidenceAvg != null) {
    toneConfidenceAvg = meta.toneConfidenceAvg;
  }

  const model =
    (typeof toneModule?.modelVersion === 'string' && toneModule.modelVersion) ||
    (typeof toneModule?.backend === 'string' && toneModule.backend) ||
    meta?.model;
  const version =
    (typeof toneModule?.runtimeVersion === 'string' && toneModule.runtimeVersion) ||
    (typeof toneModule?.trainingVersion === 'string' && toneModule.trainingVersion) ||
    meta?.version;

  return {
    toneEnabled: slices.length > 0 ? true : Boolean(meta?.toneEnabled),
    acousticToneSlices: slices,
    sliceCount: slices.length,
    toneConfidenceAvg,
    skippedReason: slices.length ? undefined : meta?.skippedReason,
    evidenceProduction: evidenceProduction.length ? evidenceProduction : undefined,
    ...(model ? { model } : {}),
    ...(version ? { version } : {}),
  };
}

/** Test helper: clone slices without mutating posteriors. */
export function cloneAcousticSlices(slices: AcousticToneSlice[]): AcousticToneSlice[] {
  return slices.map((s) => ({
    start: s.start,
    end: s.end,
    confidence: s.confidence,
    tonePosterior: { ...s.tonePosterior },
  }));
}
