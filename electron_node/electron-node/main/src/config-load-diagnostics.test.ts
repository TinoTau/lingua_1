import { describe, expect, it } from '@jest/globals';
import {
  buildRuntimeDiagnosticsExtra,
  createParseFailedDiagnostics,
  createSuccessDiagnostics,
  resetConfigLoadDiagnosticsForTest,
  setConfigLoadDiagnostics,
} from './config-load-diagnostics';

describe('config-load-diagnostics', () => {
  beforeEach(() => {
    resetConfigLoadDiagnosticsForTest();
  });

  it('parse failed diagnostics mark runtime downgrade', () => {
    const d = createParseFailedDiagnostics(new Error('Unexpected token'), true);
    expect(d.configLoadSucceeded).toBe(false);
    expect(d.runtimeFeatureDowngrade).toBe(true);
    expect(d.downgradeReason).toBe('config_parse_failed');
    expect(d.downgradedFeatures).toContain('lexiconV2Intent');
  });

  it('success diagnostics with BOM do not downgrade', () => {
    const d = createSuccessDiagnostics(true);
    expect(d.configLoadSucceeded).toBe(true);
    expect(d.configHadUtf8Bom).toBe(true);
    expect(d.runtimeFeatureDowngrade).toBe(false);
  });

  it('buildRuntimeDiagnosticsExtra reflects current state', () => {
    setConfigLoadDiagnostics(createParseFailedDiagnostics(new Error('bad json'), false));
    const extra = buildRuntimeDiagnosticsExtra();
    expect(extra.configLoadSucceeded).toBe(false);
    expect(extra.runtimeFeatureDowngrade).toBe(true);
    expect(extra.downgradeReason).toBe('config_parse_failed');
  });
});
