/**
 * ASR decode types — downstream hypothesis input (recover v1).
 */

export type ASRHypothesis = {
  text: string;
  acousticScore?: number;
  confidence?: number;
  rank: number;
  tokens?: Array<{
    token: string;
    start?: number;
    end?: number;
    score?: number;
  }>;
};

export type ASRDecodeResult = {
  top1: string;
  hypotheses: ASRHypothesis[];
  language?: string;
  durationMs?: number;
  nbestSynthetic: boolean;
};
