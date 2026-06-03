import * as fs from 'fs';
import * as path from 'path';
import { entryKey, parseDictLine, parseSingleCharDictLine } from './pinyin-ime-v2-dict-tsv';
import { TARGET_BOOST_FACTOR } from './pinyin-ime-v2-dict-weight';
import {
  FALLBACK_SINGLE_CHAR_ROLES,
  MAIN_BEAM_SINGLE_CHAR_ROLES,
} from './pinyin-ime-v2-single-char-roles';
import type { PinyinImeV2Dict, PinyinImeV2DictEntry } from './pinyin-ime-v2-types';

const LAYER_FILES = {
  base: 'base_dictionary.txt',
  domain: 'domain_dictionary.txt',
  target: 'target_dictionary.txt',
} as const;

const DEFAULT_SINGLE_CHAR_FILE = 'single_char_dictionary.tsv';
const DEFAULT_DICT_REL = path.join('node_runtime', 'pinyin-ime-v2', 'dict');

/** Resolve IME dict dir: PROJECT_ROOT-relative (align with Lexicon bundle + export script). */
export function resolvePinyinImeV2DictDir(dictDir?: string): string {
  const raw = (dictDir ?? DEFAULT_DICT_REL).trim();
  if (path.isAbsolute(raw)) {
    return raw;
  }
  const projectRoot = process.env.PROJECT_ROOT?.trim();
  if (projectRoot) {
    return path.join(projectRoot, raw);
  }
  return path.join(process.cwd(), raw);
}

export function defaultPinyinImeV2DictDir(): string {
  return resolvePinyinImeV2DictDir();
}

export function defaultSingleCharDictPath(dictDir?: string): string {
  const projectRoot = process.env.PROJECT_ROOT?.trim();
  const candidates = [
    projectRoot
      ? path.join(projectRoot, 'docs', 'pinyin-v2', 'import', DEFAULT_SINGLE_CHAR_FILE)
      : path.join(process.cwd(), '..', '..', 'docs', 'pinyin-v2', 'import', DEFAULT_SINGLE_CHAR_FILE),
    path.join(resolvePinyinImeV2DictDir(dictDir), DEFAULT_SINGLE_CHAR_FILE),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function layerPath(layer: keyof typeof LAYER_FILES, dictDir: string): string {
  return path.join(dictDir, LAYER_FILES[layer]);
}

function readLayerFile(
  filePath: string,
  parser: (line: string) => ReturnType<typeof parseDictLine> = parseDictLine
): NonNullable<ReturnType<typeof parseDictLine>>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: NonNullable<ReturnType<typeof parseDictLine>>[] = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const row = parser(line);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

function upsertEntry(
  map: Map<string, PinyinImeV2DictEntry & { prior: number }>,
  row: NonNullable<ReturnType<typeof parseDictLine>>,
  extra: Partial<PinyinImeV2DictEntry> = {}
): void {
  const syllables = row.pinyin.split(/\s+/).filter(Boolean);
  if (!syllables.length) {
    return;
  }
  const key = entryKey(row.surface, row.pinyin);
  const prior = row.imeWeight ?? row.weight;
  const existing = map.get(key);
  if (!existing || prior > existing.prior) {
    map.set(key, {
      word: row.surface,
      syllables,
      prior,
      ...extra,
    } as PinyinImeV2DictEntry & { prior: number });
  }
}

function buildByFirst(entries: PinyinImeV2DictEntry[]): Map<string, PinyinImeV2DictEntry[]> {
  const byFirst = new Map<string, PinyinImeV2DictEntry[]>();
  for (const entry of entries) {
    const first = entry.syllables[0];
    const list = byFirst.get(first) ?? [];
    list.push(entry);
    byFirst.set(first, list);
  }
  for (const list of byFirst.values()) {
    list.sort((a, b) => b.prior - a.prior);
  }
  return byFirst;
}

export type LoadPinyinImeV2DictOptions = {
  enabledDomains?: string[];
  singleCharPath?: string;
};

/**
 * Load IME decode dictionary: merge(base, domain, single_char main-beam), target boost keys.
 * Fallback single-char roles indexed in byFirstFallback.
 */
export function loadPinyinImeV2Dictionaries(
  dictDir: string = defaultPinyinImeV2DictDir(),
  opts: LoadPinyinImeV2DictOptions = {}
): PinyinImeV2Dict {
  if (!fs.existsSync(dictDir)) {
    throw new Error(`[pinyin-ime-v2] dict dir missing: ${dictDir}`);
  }
  const basePath = layerPath('base', dictDir);
  if (!fs.existsSync(basePath)) {
    throw new Error(`[pinyin-ime-v2] missing base_dictionary in ${dictDir}`);
  }

  const entryMap = new Map<string, PinyinImeV2DictEntry & { prior: number }>();
  for (const row of readLayerFile(basePath)) {
    upsertEntry(entryMap, row, { source: 'base' });
  }
  for (const row of readLayerFile(layerPath('domain', dictDir))) {
    if (opts.enabledDomains?.length && row.domainId && !opts.enabledDomains.includes(row.domainId)) {
      continue;
    }
    upsertEntry(entryMap, row, { source: 'domain' });
  }

  const fallbackMap = new Map<string, PinyinImeV2DictEntry & { prior: number }>();
  const singleCharPath = opts.singleCharPath ?? defaultSingleCharDictPath(dictDir);
  let singleCharLoaded = false;
  for (const row of readLayerFile(singleCharPath, parseSingleCharDictLine)) {
    singleCharLoaded = true;
    const role = row.singleCharRole!;
    if (MAIN_BEAM_SINGLE_CHAR_ROLES.has(role)) {
      upsertEntry(entryMap, row, { source: 'single_char', singleCharRole: role, isSingleChar: true });
    } else if (FALLBACK_SINGLE_CHAR_ROLES.has(role)) {
      upsertEntry(fallbackMap, row, {
        source: 'fallback',
        singleCharRole: role,
        isSingleChar: true,
        isFallback: true,
      });
    }
  }

  const targetKeys = new Set<string>();
  for (const row of readLayerFile(layerPath('target', dictDir))) {
    targetKeys.add(entryKey(row.surface, row.pinyin));
  }

  const entries: PinyinImeV2DictEntry[] = [];
  const byFirst = new Map<string, PinyinImeV2DictEntry[]>();
  for (const [key, entry] of entryMap) {
    let prior = entry.prior;
    if (targetKeys.has(key)) {
      prior *= TARGET_BOOST_FACTOR;
    }
    const e: PinyinImeV2DictEntry = {
      word: entry.word,
      syllables: entry.syllables,
      prior,
      source: targetKeys.has(key) ? 'target' : entry.source,
      singleCharRole: entry.singleCharRole,
      isSingleChar: entry.isSingleChar ?? false,
    };
    entries.push(e);
    const first = entry.syllables[0];
    const list = byFirst.get(first) ?? [];
    list.push(e);
    byFirst.set(first, list);
  }
  for (const list of byFirst.values()) {
    list.sort((a, b) => b.prior - a.prior);
  }

  const fallbackEntries: PinyinImeV2DictEntry[] = [];
  for (const [, entry] of fallbackMap) {
    fallbackEntries.push({
      word: entry.word,
      syllables: entry.syllables,
      prior: entry.prior,
      source: 'fallback',
      singleCharRole: entry.singleCharRole,
      isSingleChar: true,
      isFallback: true,
    });
  }

  return {
    entries,
    byFirst,
    byFirstFallback: buildByFirst(fallbackEntries),
    singleCharLoaded,
    dictDir,
  };
}

/** Build an in-memory dict for unit tests. */
export function buildPinyinImeV2DictFromEntries(
  entries: Array<Omit<PinyinImeV2DictEntry, 'source'> & { source?: PinyinImeV2DictEntry['source'] }>
): PinyinImeV2Dict {
  const normalized: PinyinImeV2DictEntry[] = entries.map((e) => ({
    ...e,
    source: e.source ?? 'base',
    isSingleChar: e.isSingleChar ?? false,
    isFallback: e.isFallback ?? false,
  }));
  const mainBeam = normalized.filter((e) => !e.isFallback);
  const fallbackBeam = normalized.filter((e) => e.isFallback);
  return {
    entries: normalized,
    byFirst: buildByFirst(mainBeam),
    byFirstFallback: buildByFirst(fallbackBeam),
    singleCharLoaded: normalized.some((e) => e.isSingleChar),
    dictDir: '<in-memory>',
  };
}
