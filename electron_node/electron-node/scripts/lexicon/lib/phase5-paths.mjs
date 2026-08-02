import path from 'path';
import { fileURLToPath } from 'url';
import { repoRoot } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function phase5PackageDir() {
  return path.join(repoRoot(), 'electron_node/docs/lexicon-assets/Lexicon_Phase5_Evaluation_Package');
}

export function phase5BenchmarkDir() {
  return path.join(phase5PackageDir(), 'benchmark');
}

export function phase5GatePath(ladder = '5k') {
  if (ladder === '2k') {
    return path.join(
      repoRoot(),
      'electron_node/docs/lexicon-assets/Lexicon_V3_Canonical_Asset_Package/gates/phase5_5k_manifest_gate.json'
    );
  }
  if (ladder === '10k') {
    return path.join(phase5PackageDir(), 'phase5_10k_manifest_gate.json');
  }
  return path.join(phase5PackageDir(), 'phase5_5k_manifest_gate.json');
}

export function phase5BaselinePath() {
  return path.join(phase5PackageDir(), 'phase5_benchmark_baseline.json');
}

export function dialog200ManifestPath() {
  return path.join(repoRoot(), 'test wav/dialog_200/cases.manifest.json');
}

export function dialog200BatchResultPath(electronNodeRoot) {
  return path.join(electronNodeRoot, 'tests/dialog-200-batch-result.json');
}
