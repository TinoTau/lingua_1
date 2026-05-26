/**
 * Resolve Lexicon V2 CPU LLM model path under electron-node/models/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadNodeConfig } from '../node-config';

export const LEXICON_INTENT_MODEL_DIR_REL = path.join('models', 'lexicon-intent');
export const LEXICON_INTENT_DEFAULT_MODEL_FILE = 'qwen2.5-3b-instruct-q4_k_m.gguf';

export type LexiconIntentModelResolution = {
  configuredPath: string;
  resolvedPath: string | null;
  exists: boolean;
  source: 'config_file' | 'config_dir_scan' | 'default_file' | 'default_dir_scan' | 'missing';
};

function electronNodeCwd(): string {
  return process.cwd();
}

function resolveConfiguredPath(configured: string): string {
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(electronNodeCwd(), configured);
}

function firstGgufInDir(dir: string): string | null {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.gguf'))
    .sort();
  if (files.length === 0) {
    return null;
  }
  return path.join(dir, files[0]);
}

export function getConfiguredLexiconIntentModelPath(): string {
  const fromConfig = loadNodeConfig()?.features?.lexiconV2?.cpuWorker?.modelPath?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  return path.join(LEXICON_INTENT_MODEL_DIR_REL, LEXICON_INTENT_DEFAULT_MODEL_FILE);
}

export function resolveLexiconIntentModelPath(): LexiconIntentModelResolution {
  const configuredPath = getConfiguredLexiconIntentModelPath();
  const resolvedConfigured = resolveConfiguredPath(configuredPath);

  if (fs.existsSync(resolvedConfigured) && fs.statSync(resolvedConfigured).isFile()) {
    return {
      configuredPath,
      resolvedPath: resolvedConfigured,
      exists: true,
      source: 'config_file',
    };
  }

  if (fs.existsSync(resolvedConfigured) && fs.statSync(resolvedConfigured).isDirectory()) {
    const scanned = firstGgufInDir(resolvedConfigured);
    if (scanned) {
      return {
        configuredPath,
        resolvedPath: scanned,
        exists: true,
        source: 'config_dir_scan',
      };
    }
  }

  const defaultFile = path.resolve(
    electronNodeCwd(),
    LEXICON_INTENT_MODEL_DIR_REL,
    LEXICON_INTENT_DEFAULT_MODEL_FILE
  );
  if (fs.existsSync(defaultFile)) {
    return {
      configuredPath,
      resolvedPath: defaultFile,
      exists: true,
      source: 'default_file',
    };
  }

  const defaultDir = path.resolve(electronNodeCwd(), LEXICON_INTENT_MODEL_DIR_REL);
  const scannedDefault = firstGgufInDir(defaultDir);
  if (scannedDefault) {
    return {
      configuredPath,
      resolvedPath: scannedDefault,
      exists: true,
      source: 'default_dir_scan',
    };
  }

  return {
    configuredPath,
    resolvedPath: null,
    exists: false,
    source: 'missing',
  };
}
