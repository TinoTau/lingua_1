import * as fs from 'fs';
import * as path from 'path';
import { loadNodeConfig } from '../node-config';
import type { FwDetectorSignal, KenlmGateMode } from './types';

export type FinalScoreWeights = {
  pinyin: number;
  prior: number;
  domain: number;
  kenlm: number;
};

const DEFAULT_FINAL_SCORE_WEIGHTS: FinalScoreWeights = {
  pinyin: 0.4,
  prior: 0.3,
  domain: 0.2,
  kenlm: 0.1,
};

export type FwDetectorRuntimeConfig = {
  maxSpans: number;
  spanDetectBudget: number;
  topK: number;
  minPrior: number;
  minRiskScore: number;
  enableKenLMGate: boolean;
  kenlmGateMode: KenlmGateMode;
  kenlmDeltaThreshold: number;
  kenlmVetoThreshold: number;
  finalScoreWeights: FinalScoreWeights;
  enabledDomains: string[];
  windowChars: number;
  minSpanChars: number;
  maxSpanChars: number;
  noSpeechProbThreshold: number;
  recallMinPhoneticScore: number;
  candidateRequireRepairTarget: boolean;
  repairTargetScoreBoost: number;
  signalWeights: Record<FwDetectorSignal, number>;
  domainAnchors: Record<string, string[]>;
};

const DEFAULT_WEIGHTS: Record<FwDetectorSignal, number> = {
  domain_anchor_nearby: 2,
  detector_pinyin_hint: 2,
  pinyin_proximity: 2,
  mixed_language_anomaly: 1,
  low_no_speech_prob: 1,
};

export function loadFwDetectorRuntimeConfig(): FwDetectorRuntimeConfig {
  const cfg = loadNodeConfig().features?.fwDetector ?? {};
  const anchors = loadDomainAnchors(cfg.domainAnchorPath ?? 'data/lexicon/domain_anchor.json');
  return {
    maxSpans: cfg.maxSpans ?? 2,
    spanDetectBudget: cfg.spanDetectBudget ?? Math.max(12, (cfg.maxSpans ?? 2) * 4),
    topK: cfg.topK ?? 3,
    minPrior: cfg.minPrior ?? 0.5,
    minRiskScore: cfg.minRiskScore ?? 2,
    enableKenLMGate: cfg.enableKenLMGate !== false,
    kenlmGateMode: resolveKenlmGateMode(cfg.kenlmGateMode),
    kenlmDeltaThreshold: cfg.kenlmDeltaThreshold ?? 0.8,
    kenlmVetoThreshold: cfg.kenlmVetoThreshold ?? -0.2,
    finalScoreWeights: resolveFinalScoreWeights(cfg.finalScoreWeights),
    enabledDomains: cfg.enabledDomains ?? ['tech_ai', 'travel', 'transport', 'restaurant'],
    windowChars: cfg.windowChars ?? 8,
    minSpanChars: cfg.minSpanChars ?? 2,
    maxSpanChars: cfg.maxSpanChars ?? 4,
    noSpeechProbThreshold: cfg.noSpeechProbThreshold ?? 0.5,
    recallMinPhoneticScore: cfg.recallMinPhoneticScore ?? 0.5,
    candidateRequireRepairTarget:
      cfg.candidateRequireRepairTarget !== false && cfg.enableRepairTargetFilter !== false,
    repairTargetScoreBoost: cfg.repairTargetScoreBoost ?? 0,
    signalWeights: { ...DEFAULT_WEIGHTS, ...(cfg.signalWeights as Partial<Record<FwDetectorSignal, number>>) },
    domainAnchors: anchors,
  };
}

function resolveAnchorPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  const projectRoot = process.env.PROJECT_ROOT?.trim();
  const electronNodeRoot = projectRoot
    ? path.join(projectRoot, 'electron_node', 'electron-node')
    : path.resolve(__dirname, '..', '..', '..');
  return path.join(electronNodeRoot, relativePath);
}

function resolveFinalScoreWeights(
  raw: Partial<FinalScoreWeights> | undefined
): FinalScoreWeights {
  if (!raw) {
    return { ...DEFAULT_FINAL_SCORE_WEIGHTS };
  }
  return {
    pinyin: raw.pinyin ?? DEFAULT_FINAL_SCORE_WEIGHTS.pinyin,
    prior: raw.prior ?? DEFAULT_FINAL_SCORE_WEIGHTS.prior,
    domain: raw.domain ?? DEFAULT_FINAL_SCORE_WEIGHTS.domain,
    kenlm: raw.kenlm ?? DEFAULT_FINAL_SCORE_WEIGHTS.kenlm,
  };
}

function resolveKenlmGateMode(raw: string | undefined): KenlmGateMode {
  if (raw === 'hard_gate' || raw === 'weak_veto') {
    return raw;
  }
  return 'weak_veto';
}

export function loadDomainAnchors(relativePath: string): Record<string, string[]> {
  const filePath = resolveAnchorPath(relativePath);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    anchors?: Record<string, string[]>;
  };
  return raw.anchors ?? {};
}
