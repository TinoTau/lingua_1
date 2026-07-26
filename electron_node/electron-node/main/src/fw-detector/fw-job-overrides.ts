import type { JobAssignMessage } from '@shared/protocols/messages';
import type { JobContext } from '../pipeline/context/job-context';
import type { KenlmGateMode } from './types';
import { sanitizeDomainPriors } from './domain-context-contract';

export type FwDetectorJobOverrides = {
  enableKenLMGate?: boolean;
  kenlmGateMode?: KenlmGateMode;
  kenlmVetoThreshold?: number;
  enabledDomains?: string[];
};

export function readFwDetectorJobOverrides(job: JobAssignMessage): FwDetectorJobOverrides | undefined {
  const raw = (job as JobAssignMessage & { fw_detector?: FwDetectorJobOverrides }).fw_detector;
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  return raw;
}

export function buildFwDetectorJobPayload(options: {
  enableKenLMGate?: boolean;
  kenlmGateMode?: KenlmGateMode;
  kenlmVetoThreshold?: number;
  enabledDomains?: string[];
}): FwDetectorJobOverrides | undefined {
  const payload: FwDetectorJobOverrides = {};
  if (typeof options.enableKenLMGate === 'boolean') {
    payload.enableKenLMGate = options.enableKenLMGate;
  }
  if (options.kenlmGateMode === 'hard_gate' || options.kenlmGateMode === 'weak_veto') {
    payload.kenlmGateMode = options.kenlmGateMode;
  }
  if (typeof options.kenlmVetoThreshold === 'number') {
    payload.kenlmVetoThreshold = options.kenlmVetoThreshold;
  }
  if (Array.isArray(options.enabledDomains) && options.enabledDomains.length > 0) {
    payload.enabledDomains = options.enabledDomains;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

/** Bind soft priors from JobAssign.domainPriors — never into enabledDomains. */
export function applyDomainPriorsFromJob(job: JobAssignMessage, ctx: JobContext): void {
  const raw = (job as JobAssignMessage & { domainPriors?: unknown }).domainPriors;
  ctx.domainPriors = sanitizeDomainPriors(raw);
}

export function applyFwDetectorJobOverrides(job: JobAssignMessage, ctx: JobContext): void {
  applyDomainPriorsFromJob(job, ctx);
  const o = readFwDetectorJobOverrides(job);
  if (!o) {
    return;
  }
  // Batch/freeze acceptance must not set enableKenLMGate:false (P4 rerank requires scorer).
  if (typeof o.enableKenLMGate === 'boolean') {
    ctx.fwDetectorEnableKenLMGateOverride = o.enableKenLMGate;
  }
  if (o.kenlmGateMode === 'hard_gate' || o.kenlmGateMode === 'weak_veto') {
    ctx.fwDetectorKenlmGateModeOverride = o.kenlmGateMode;
  }
  if (typeof o.kenlmVetoThreshold === 'number') {
    ctx.fwDetectorKenlmVetoThresholdOverride = o.kenlmVetoThreshold;
  }
  if (Array.isArray(o.enabledDomains) && o.enabledDomains.length > 0) {
    ctx.fwDetectorEnabledDomainsOverride = o.enabledDomains;
  }
}
