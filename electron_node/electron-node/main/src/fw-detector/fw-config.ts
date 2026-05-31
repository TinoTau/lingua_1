import * as fs from 'fs';
import * as path from 'path';
import { loadNodeConfig } from '../node-config';
import type { FwDetectorSignal, FwSpanGateMode, KenlmGateMode } from './types';

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

export type KenlmSpanGateRuntimeConfig = {
  enabled: boolean;
  maxSpans: number;
  minSpanChars: number;
  maxSpanChars: number;
  minLocalDelta: number;
  stopwordFilterEnabled: boolean;
  preFilterMaxWindows: number;
};

export type FwMetadataSpanGateRuntimeConfig = {
  enabled: boolean;
  maxSpans: number;
  minSpanChars: number;
  maxSpanChars: number;
  wordProbabilityThreshold: number;
  segmentAvgLogprobThreshold: number;
  compressionRatioThreshold: number;
  noSpeechProbThreshold: number;
  allowAliasExactHit: boolean;
  allowSegmentFallbackScan: boolean;
  fallbackLegacyMaxSpans: number;
};

export type FwDetectorRuntimeConfig = {
  spanGateMode: FwSpanGateMode;
  kenlmSpanGate: KenlmSpanGateRuntimeConfig;
  fwMetadataSpanGate: FwMetadataSpanGateRuntimeConfig;
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
  useSentenceLevelRerank: boolean;
  maxSentenceCandidates: number;
  minDeltaToReplace: number;
  signalWeights: Record<FwDetectorSignal, number>;
  domainAnchors: Record<string, string[]>;
};

const DEFAULT_WEIGHTS: Record<FwDetectorSignal, number> = {
  domain_anchor_nearby: 2,
  detector_pinyin_hint: 2,
  pinyin_proximity: 2,
  mixed_language_anomaly: 1,
  low_no_speech_prob: 1,
  kenlm_local_low_prob: 0,
  alias_exact_hit: 0,
  low_word_probability: 0,
  low_segment_avg_logprob: 0,
  high_compression_ratio: 0,
};

const DEFAULT_KENLM_SPAN_GATE: KenlmSpanGateRuntimeConfig = {
  enabled: false,
  maxSpans: 2,
  minSpanChars: 2,
  maxSpanChars: 4,
  minLocalDelta: 0.05,
  stopwordFilterEnabled: true,
  preFilterMaxWindows: 20,
};

/** Fallback when node config omits fwMetadataSpanGate fields. Align with P4 freeze (node-config-defaults). */
const DEFAULT_FW_METADATA_SPAN_GATE: FwMetadataSpanGateRuntimeConfig = {
  enabled: true,
  maxSpans: 4,
  minSpanChars: 2,
  maxSpanChars: 4,
  wordProbabilityThreshold: 0.65,
  segmentAvgLogprobThreshold: -1.0,
  compressionRatioThreshold: 2.4,
  noSpeechProbThreshold: 0.5,
  allowAliasExactHit: true,
  allowSegmentFallbackScan: true,
  fallbackLegacyMaxSpans: 1,
};

export function isKenlmSpanGateActive(config: FwDetectorRuntimeConfig): boolean {
  return config.spanGateMode === 'kenlm_gate_filter' && config.kenlmSpanGate.enabled;
}

export function isFwMetadataSpanGateActive(config: FwDetectorRuntimeConfig): boolean {
  return config.spanGateMode === 'fw_metadata_gate' && config.fwMetadataSpanGate.enabled;
}

function resolveSpanGateMode(raw: string | undefined): FwSpanGateMode {
  if (raw === 'legacy_detector') {
    return 'legacy_detector';
  }
  if (raw === 'kenlm_gate_filter') {
    return 'kenlm_gate_filter';
  }
  return 'fw_metadata_gate';
}

export function loadFwDetectorRuntimeConfig(): FwDetectorRuntimeConfig {
  const cfg = loadNodeConfig().features?.fwDetector ?? {};
  const anchors = loadDomainAnchors(cfg.domainAnchorPath ?? 'data/lexicon/domain_anchor.json');
  const kenlmSpanGateRaw = cfg.kenlmSpanGate ?? {};
  const fwMetadataSpanGateRaw = cfg.fwMetadataSpanGate ?? {};
  return {
    spanGateMode: resolveSpanGateMode(cfg.spanGateMode),
    kenlmSpanGate: {
      enabled: kenlmSpanGateRaw.enabled === true,
      maxSpans: kenlmSpanGateRaw.maxSpans ?? DEFAULT_KENLM_SPAN_GATE.maxSpans,
      minSpanChars: kenlmSpanGateRaw.minSpanChars ?? DEFAULT_KENLM_SPAN_GATE.minSpanChars,
      maxSpanChars: kenlmSpanGateRaw.maxSpanChars ?? DEFAULT_KENLM_SPAN_GATE.maxSpanChars,
      minLocalDelta: kenlmSpanGateRaw.minLocalDelta ?? DEFAULT_KENLM_SPAN_GATE.minLocalDelta,
      stopwordFilterEnabled:
        kenlmSpanGateRaw.stopwordFilterEnabled !== false,
      preFilterMaxWindows:
        kenlmSpanGateRaw.preFilterMaxWindows ?? DEFAULT_KENLM_SPAN_GATE.preFilterMaxWindows,
    },
    fwMetadataSpanGate: {
      enabled: fwMetadataSpanGateRaw.enabled !== false,
      maxSpans: fwMetadataSpanGateRaw.maxSpans ?? DEFAULT_FW_METADATA_SPAN_GATE.maxSpans,
      minSpanChars: fwMetadataSpanGateRaw.minSpanChars ?? DEFAULT_FW_METADATA_SPAN_GATE.minSpanChars,
      maxSpanChars: fwMetadataSpanGateRaw.maxSpanChars ?? DEFAULT_FW_METADATA_SPAN_GATE.maxSpanChars,
      wordProbabilityThreshold:
        fwMetadataSpanGateRaw.wordProbabilityThreshold ??
        DEFAULT_FW_METADATA_SPAN_GATE.wordProbabilityThreshold,
      segmentAvgLogprobThreshold:
        fwMetadataSpanGateRaw.segmentAvgLogprobThreshold ??
        DEFAULT_FW_METADATA_SPAN_GATE.segmentAvgLogprobThreshold,
      compressionRatioThreshold:
        fwMetadataSpanGateRaw.compressionRatioThreshold ??
        DEFAULT_FW_METADATA_SPAN_GATE.compressionRatioThreshold,
      noSpeechProbThreshold:
        fwMetadataSpanGateRaw.noSpeechProbThreshold ??
        DEFAULT_FW_METADATA_SPAN_GATE.noSpeechProbThreshold,
      allowAliasExactHit: fwMetadataSpanGateRaw.allowAliasExactHit !== false,
      allowSegmentFallbackScan: fwMetadataSpanGateRaw.allowSegmentFallbackScan !== false,
      fallbackLegacyMaxSpans:
        fwMetadataSpanGateRaw.fallbackLegacyMaxSpans ??
        DEFAULT_FW_METADATA_SPAN_GATE.fallbackLegacyMaxSpans,
    },
    maxSpans: cfg.maxSpans ?? 4,
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
    useSentenceLevelRerank: cfg.useSentenceLevelRerank !== false,
    maxSentenceCandidates: cfg.maxSentenceCandidates ?? 16,
    minDeltaToReplace: cfg.minDeltaToReplace ?? 0.03,
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
