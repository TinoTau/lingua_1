/**
 * freeze-config-ssot.json ↔ node-config-defaults.ts frozen field parity.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { DEFAULT_CONFIG } from '../node-config-defaults';

const SSOT_PATH = path.resolve(__dirname, '../../../tests/freeze-config-ssot.json');

function loadSsot() {
  return JSON.parse(fs.readFileSync(SSOT_PATH, 'utf8'));
}

describe('freeze-config-ssot parity', () => {
  it('冻结字段与 DEFAULT_CONFIG 一致', () => {
    const ssot = loadSsot();
    const fw = DEFAULT_CONFIG.features?.fwDetector;
    const v2 = DEFAULT_CONFIG.features?.lexiconRuntimeV2;

    expect(ssot.fwDetector.spanGateMode).toBe(fw?.spanGateMode);
    expect(ssot.fwDetector.useLexiconRuntimeV2Recall).toBe(fw?.useLexiconRuntimeV2Recall);
    expect(ssot.fwDetector.useIndustryRouting).toBe(fw?.useIndustryRouting);
    expect(ssot.fwDetector.useSentenceLevelRerank).toBe(fw?.useSentenceLevelRerank);
    expect(ssot.fwDetector.enableKenLMGate).toBe(fw?.enableKenLMGate);
    expect(ssot.fwDetector.maxSentenceCandidates).toBe(fw?.maxSentenceCandidates);
    expect(ssot.fwDetector.minDeltaToReplace).toBe(fw?.minDeltaToReplace);
    expect(ssot.fwDetector.minPrior).toBe(fw?.minPrior);
    expect(ssot.fwDetector.candidateRequireRepairTarget).toBe(fw?.candidateRequireRepairTarget);
    expect(ssot.fwDetector.fwMetadataSpanGate.maxSpans).toBe(fw?.fwMetadataSpanGate?.maxSpans);
    expect(ssot.fwDetector.kenlmSpanGate.enabled).toBe(fw?.kenlmSpanGate?.enabled);

    expect(ssot.lexiconRuntimeV2.enabled).toBe(v2?.enabled);
    expect(ssot.lexiconRuntimeV2.bundlePath).toBe(v2?.bundlePath);
    expect(ssot.lexiconRuntimeV2.maxBaseCandidates).toBe(v2?.maxBaseCandidates);
    expect(ssot.lexiconRuntimeV2.maxDomainCandidates).toBe(v2?.maxDomainCandidates);
    expect(ssot.lexiconRuntimeV2.maxIdiomCandidates).toBe(v2?.maxIdiomCandidates);
  });
});
