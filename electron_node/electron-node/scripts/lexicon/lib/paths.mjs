import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function electronNodeRoot() {
  return path.resolve(__dirname, '../../..');
}

export function repoRoot() {
  return path.resolve(electronNodeRoot(), '../..');
}

export function defaultSeedPath() {
  const canonical10k = path.join(electronNodeRoot(), 'data', 'lexicon', '10k', 'lexicon_10k_canonical_merged.jsonl');
  if (fs.existsSync(canonical10k)) {
    return canonical10k;
  }
  const pilot = path.join(electronNodeRoot(), 'data', 'lexicon', 'pilot', 'lexicon_1k_pilot_v1.jsonl');
  if (fs.existsSync(pilot)) {
    return pilot;
  }
  return path.join(electronNodeRoot(), 'data', 'lexicon', 'hotwords.jsonl');
}

export function defaultRegistryPath() {
  return path.join(electronNodeRoot(), 'data', 'lexicon', 'profile-registry.json');
}

export function defaultBundleDir() {
  return path.join(repoRoot(), 'node_runtime', 'lexicon', 'current');
}

/** Migration source / historical FW bundle (P6 退役前保留). */
export function v2ShadowRuntimeDir() {
  return path.join(repoRoot(), 'node_runtime', 'lexicon', 'v2_shadow');
}

/** P1+ 正式 FW runtime 目录（阶段 A 仍用 LexiconRuntimeV2 加载 manifest_v2）。 */
export function v3RuntimeDir() {
  return path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3');
}

export function resolveInputFiles(inputArg) {
  const resolved = path.resolve(inputArg);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return [resolved];
  }
  const files = fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(resolved, name))
    .sort();
  if (!files.length) {
    throw new Error(`No .jsonl files under: ${resolved}`);
  }
  return files;
}

const V2_SHADOW_ENTRIES_FILENAME = 'entries.jsonl';

function collectEntriesJsonlRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectEntriesJsonlRecursive(full));
      continue;
    }
    if (entry.isFile() && entry.name === V2_SHADOW_ENTRIES_FILENAME) {
      out.push(full);
    }
  }
  return out;
}

/**
 * V2 shadow build — resolve seed inputs.
 * - file: single jsonl (legacy combined seed)
 * - directory: all nested `entries.jsonl` (base/idiom/common5/domain_patch_* packs)
 */
export function resolveV2ShadowInputFiles(inputArg) {
  const resolved = path.resolve(inputArg);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return [resolved];
  }
  const files = collectEntriesJsonlRecursive(resolved).sort((a, b) => a.localeCompare(b));
  if (!files.length) {
    throw new Error(`No ${V2_SHADOW_ENTRIES_FILENAME} files under: ${resolved}`);
  }
  return files;
}

export function defaultV2ShadowSeedPath() {
  const assetRoot = path.join(
    repoRoot(),
    'electron_node',
    'docs',
    'lexicon-assets',
    'p1_3_generic_zh_lexicon_v2_fw_domains',
    'p1_3_lexicon_zh_v2'
  );
  if (fs.existsSync(assetRoot)) {
    return assetRoot;
  }
  return defaultSeedPath();
}
