/**
 * FW Repair V4 canonical repair-surface normalization (Recall Foundation V1).
 * Reuses existing OpenCC t→cn capability; does not mutate ctx.rawAsrText.
 */
import { normalizeTraditionalChinese } from './pinyin-ime-v2/normalize-for-ime-alignment';

export type FwRepairNormalizedText = {
  /** Original ASR surface (trace / business observation). */
  rawAsrText: string;
  /** Canonical simplified repair input for lexical recall / span assembly. */
  repairText: string;
  /** True when NFKC+OpenCC changed any code unit. */
  scriptNormalized: boolean;
};

/** NFKC + OpenCC Traditional→Simplified on the full repair input string. Idempotent for simplified input. */
export function normalizeForFwRepairInput(rawAsrText: string): FwRepairNormalizedText {
  const raw = rawAsrText ?? '';
  const nfkc = raw.normalize('NFKC');
  const repairText = normalizeTraditionalChinese(nfkc);
  return {
    rawAsrText: raw,
    repairText,
    scriptNormalized: repairText !== nfkc,
  };
}
