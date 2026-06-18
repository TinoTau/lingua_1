import * as fs from 'fs';
import * as path from 'path';
import { loadNodeConfig } from '../node-config';
import logger from '../logger';
import type { KenlmGateMode } from './types';

/** @deprecated Legacy topK pipeline only */
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
  minPrior: number;
  enableKenLMGate: boolean;
  kenlmGateMode: KenlmGateMode;
  /** @deprecated V4 rerank does not use this field; Apply threshold uses minDeltaToReplace */
  kenlmDeltaThreshold: number;
  kenlmVetoThreshold: number;
  enabledDomains: string[];
  candidateRequireRepairTarget: boolean;
  maxSentenceCandidates: number;
  minDeltaToReplace: number;
  spanAssemblyV4Enabled: boolean;
  spanAssemblyV4DiagnosticsEnabled: boolean;
  spanAssemblyV4DiagnosticsLevel: 'summary' | 'trace';
  spanAssemblyV4DiagnosticsTargetIds: string[];
  toneTimestampOnlyEnabled: boolean;
  kenlmSubprocessTimeoutMs: number;
  kenlmSubprocessMaxLines: number;
};

function resolveKenlmSubprocessTimeoutMs(
  cfg: NonNullable<ReturnType<typeof loadNodeConfig>['features']>['fwDetector']
): number {
  return (
    cfg?.kenlmSubprocessTimeoutMs ??
    cfg?.kenlmBatchSubprocessTimeoutMs ??
    5000
  );
}

function resolveKenlmSubprocessMaxLines(
  cfg: NonNullable<ReturnType<typeof loadNodeConfig>['features']>['fwDetector']
): number {
  return (
    cfg?.kenlmSubprocessMaxLines ??
    cfg?.kenlmBatchSubprocessMaxSentences ??
    17
  );
}

export function loadFwDetectorRuntimeConfig(): FwDetectorRuntimeConfig {
  const cfg = loadNodeConfig().features?.fwDetector ?? {};
  const legacyV4False = cfg.spanAssemblyV4Enabled === false;
  if (legacyV4False) {
    logger.warn(
      '[fw-detector] spanAssemblyV4Enabled=false is deprecated; FW Repair runs V4 only'
    );
  }
  const toneTimestampOnlyEnabled =
    cfg.toneTimestampOnlyEnabled ??
    (cfg as { v3ToneTimestampOnlyEnabled?: boolean }).v3ToneTimestampOnlyEnabled ??
    true;
  return {
    minPrior: cfg.minPrior ?? 0.5,
    enableKenLMGate: cfg.enableKenLMGate !== false,
    kenlmGateMode: resolveKenlmGateMode(cfg.kenlmGateMode),
    kenlmDeltaThreshold: cfg.kenlmDeltaThreshold ?? 0.8,
    kenlmVetoThreshold: cfg.kenlmVetoThreshold ?? -0.2,
    enabledDomains: cfg.enabledDomains ?? ['tech_ai', 'travel', 'transport', 'restaurant'],
    candidateRequireRepairTarget: cfg.candidateRequireRepairTarget !== false,
    maxSentenceCandidates: cfg.maxSentenceCandidates ?? 16,
    minDeltaToReplace: cfg.minDeltaToReplace ?? 0.03,
    spanAssemblyV4Enabled: true,
    spanAssemblyV4DiagnosticsEnabled: cfg.spanAssemblyV4DiagnosticsEnabled === true,
    spanAssemblyV4DiagnosticsLevel:
      cfg.spanAssemblyV4DiagnosticsLevel === 'trace' ? 'trace' : 'summary',
    spanAssemblyV4DiagnosticsTargetIds: Array.isArray(cfg.spanAssemblyV4DiagnosticsTargetIds)
      ? cfg.spanAssemblyV4DiagnosticsTargetIds.filter((id): id is string => typeof id === 'string')
      : [],
    toneTimestampOnlyEnabled: toneTimestampOnlyEnabled !== false,
    kenlmSubprocessTimeoutMs: resolveKenlmSubprocessTimeoutMs(cfg),
    kenlmSubprocessMaxLines: resolveKenlmSubprocessMaxLines(cfg),
  };
}

function resolveKenlmGateMode(raw: string | undefined): KenlmGateMode {
  if (raw === 'hard_gate' || raw === 'weak_veto') {
    return raw;
  }
  return 'weak_veto';
}

/** @deprecated Legacy topK pipeline only */
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

/** @deprecated Legacy topK pipeline only */
export function resolveFinalScoreWeights(
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
