/**
 * Config load diagnostics — explicit downgrade state (no silent fallback).
 */

export type ConfigLoadDiagnostics = {
  configLoadSucceeded: boolean;
  configParseError: string | null;
  configFileExists: boolean;
  configHadUtf8Bom: boolean;
  runtimeFeatureDowngrade: boolean;
  downgradeReason: string | null;
  downgradedFeatures: string[];
};

const RUNTIME_FEATURES = [
  'lexiconRecall',
  'lexiconV2',
  'lexiconV2Intent',
  'semanticRepair',
  'phoneticCorrection',
  'punctuationRestore',
] as const;

let currentDiagnostics: ConfigLoadDiagnostics = createMissingFileDiagnostics();

export function getConfigLoadDiagnostics(): ConfigLoadDiagnostics {
  return currentDiagnostics;
}

export function resetConfigLoadDiagnosticsForTest(): void {
  currentDiagnostics = createMissingFileDiagnostics();
}

export function setConfigLoadDiagnostics(diagnostics: ConfigLoadDiagnostics): void {
  currentDiagnostics = diagnostics;
}

export function createMissingFileDiagnostics(): ConfigLoadDiagnostics {
  return {
    configLoadSucceeded: true,
    configParseError: null,
    configFileExists: false,
    configHadUtf8Bom: false,
    runtimeFeatureDowngrade: false,
    downgradeReason: null,
    downgradedFeatures: [],
  };
}

export function createSuccessDiagnostics(hadBom: boolean): ConfigLoadDiagnostics {
  return {
    configLoadSucceeded: true,
    configParseError: null,
    configFileExists: true,
    configHadUtf8Bom: hadBom,
    runtimeFeatureDowngrade: false,
    downgradeReason: null,
    downgradedFeatures: [],
  };
}

export function createParseFailedDiagnostics(error: unknown, hadBom: boolean): ConfigLoadDiagnostics {
  const message = error instanceof Error ? error.message : String(error);
  return {
    configLoadSucceeded: false,
    configParseError: message,
    configFileExists: true,
    configHadUtf8Bom: hadBom,
    runtimeFeatureDowngrade: true,
    downgradeReason: 'config_parse_failed',
    downgradedFeatures: [...RUNTIME_FEATURES],
  };
}

export function buildRuntimeDiagnosticsExtra(): Record<string, unknown> {
  const d = getConfigLoadDiagnostics();
  return {
    configLoadSucceeded: d.configLoadSucceeded,
    configParseError: d.configParseError,
    configFileExists: d.configFileExists,
    configHadUtf8Bom: d.configHadUtf8Bom,
    runtimeFeatureDowngrade: d.runtimeFeatureDowngrade,
    downgradeReason: d.downgradeReason,
    downgradedFeatures: d.downgradedFeatures,
  };
}

export function logConfigLoadFailure(diagnostics: ConfigLoadDiagnostics): void {
  if (diagnostics.configLoadSucceeded) {
    return;
  }
  console.error('\n[CONFIG_LOAD_FAILED]');
  console.error('Lexicon runtime downgraded due to invalid config.');
  console.error(`  parseError: ${diagnostics.configParseError}`);
  console.error(`  downgradeReason: ${diagnostics.downgradeReason}`);
  console.error(`  downgradedFeatures: ${diagnostics.downgradedFeatures.join(', ')}`);
  console.error('');
}
