import fs from 'fs';
import path from 'path';

export function resolvePackageSeed(packageDir, explicitSeed) {
  if (explicitSeed && fs.existsSync(path.resolve(explicitSeed))) {
    return path.resolve(explicitSeed);
  }
  const assetsDir = path.join(packageDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`assets/ not found under package: ${packageDir}`);
  }
  const candidates = fs
    .readdirSync(assetsDir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort((a, b) => {
      const score = (name) => {
        if (name.includes('canonical_seed')) {
          return 0;
        }
        return 1;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });
  if (!candidates.length) {
    throw new Error(`no .jsonl seed under ${assetsDir}`);
  }
  return path.join(assetsDir, candidates[0]);
}

export function resolveDeployArtifact(packageDir, packageNameHint) {
  const base = path.basename(packageDir).toLowerCase();
  if (base.includes('5k') || packageNameHint === '5k') {
    return {
      deployFile: 'lexicon_v3_5k_deploy.jsonl',
      bundleTagPrefix: 'v3-canonical-asset-5k',
      termIdPrefix: 'v3-5k',
      gateLadder: '5k',
    };
  }
  return {
    deployFile: 'lexicon_v3_canonical_deploy.jsonl',
    bundleTagPrefix: 'v3-canonical-asset',
    termIdPrefix: 'v3',
    gateLadder: '5k',
  };
}

export function readPackageImportBatch(packageDir) {
  const manifestPath = path.join(packageDir, 'package_manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest.importBatch;
  } catch {
    return undefined;
  }
}
