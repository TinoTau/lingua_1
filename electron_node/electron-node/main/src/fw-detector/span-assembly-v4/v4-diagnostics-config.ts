import { loadFwDetectorRuntimeConfig } from '../fw-config';
import type { V4DiagnosticsLevel } from './v4-diagnostics-types';

export type V4DiagnosticsRuntimeConfig = {
  enabled: boolean;
  level: V4DiagnosticsLevel;
  targetIds: string[];
  traceActive: boolean;
};

function matchesTargetId(caseId: string | undefined, targetIds: string[]): boolean {
  if (!targetIds.length) {
    return true;
  }
  if (!caseId) {
    return false;
  }
  return targetIds.some(
    (id) => caseId === id || caseId.includes(id) || caseId.endsWith(`-${id}`)
  );
}

export function resolveV4DiagnosticsConfig(traceCaseId?: string): V4DiagnosticsRuntimeConfig {
  const cfg = loadFwDetectorRuntimeConfig();
  const enabled = cfg.spanAssemblyV4DiagnosticsEnabled === true;
  const level = cfg.spanAssemblyV4DiagnosticsLevel ?? 'summary';
  const targetIds = cfg.spanAssemblyV4DiagnosticsTargetIds ?? [];
  const traceActive = enabled && level === 'trace' && matchesTargetId(traceCaseId, targetIds);
  return { enabled, level, targetIds, traceActive };
}
