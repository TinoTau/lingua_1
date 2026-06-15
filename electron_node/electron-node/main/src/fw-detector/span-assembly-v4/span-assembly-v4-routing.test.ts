import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { DEFAULT_CONFIG } from '../../node-config-defaults';
import { loadFwDetectorRuntimeConfig } from '../fw-config';

const SRC_ROOT = path.resolve(__dirname, '..');

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf8');
}

describe('span-assembly-v4 routing', () => {
  it('V4 is the only FW Repair pipeline (defaults + runtime)', () => {
    expect(DEFAULT_CONFIG.features?.fwDetector?.spanAssemblyV4Enabled).toBe(true);
    expect(loadFwDetectorRuntimeConfig().spanAssemblyV4Enabled).toBe(true);
    expect(loadFwDetectorRuntimeConfig().toneTimestampOnlyEnabled).toBe(true);
  });

  it('orchestrator is V4-only without V2/V3 branches', () => {
    const orch = readSrc('fw-detector-orchestrator.ts');
    expect(orch).toContain('runFwDetectorV4Path');
    expect(orch).toContain("pipelinePath: 'v4'");
    expect(orch).not.toContain('spanAssemblyV3Enabled');
    expect(orch).not.toContain('runFwDetectorV3Path');
    expect(orch).not.toContain('resolvePinyinImeV2Spans');
    expect(orch).not.toContain('runFwSentenceRerankPipeline');
    expect(orch).not.toContain('if (config.spanAssemblyV4Enabled)');
  });
});
