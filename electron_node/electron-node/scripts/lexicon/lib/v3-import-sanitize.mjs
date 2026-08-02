import { MAX_WORD_LEN, RECALL_PREFERRED_MAX } from './constants.mjs';

/** Map asset-package review labels → build-time reviewStatus enum. */
export const REVIEW_STATUS_MAP = {
  approved: 'approved',
  pending: 'pending',
  rejected: 'rejected',
  draft_review_required: 'pending',
  pending_review: 'pending',
};

export const CANONICAL_OVERRIDES = {
  '靠 aisle 座位': { word: '过道座', aliases: ['靠 aisle 座位', 'aisle seat'] },
  '免费 WiFi': { word: 'WiFi', aliases: ['免费 WiFi', 'wifi', '无线网'] },
  WebSocket: { word: 'WS', aliases: ['WebSocket', 'websocket'] },
  'JSON Schema': { word: 'JSON', aliases: ['JSON Schema', 'json schema'] },
  TypeScript: { word: 'TS', aliases: ['TypeScript', 'typescript'] },
  JavaScript: { word: 'JS', aliases: ['JavaScript', 'javascript'] },
  Electron: { word: 'Elec', aliases: ['Electron', 'electron'] },
  'Node.js': { word: 'Node', aliases: ['Node.js', 'nodejs'] },
  TensorRT: { word: 'TRT', aliases: ['TensorRT', 'tensorrt'] },
  CTranslate2: { word: 'CT2', aliases: ['CTranslate2', 'ctranslate2'] },
  Whisper: { word: 'Wisp', aliases: ['Whisper', 'whisper'] },
  'Faster Whisper': { word: 'FW', aliases: ['Faster Whisper', 'faster whisper', 'faster-whisper'] },
  'beam search': { word: 'beam', aliases: ['beam search', '波束搜索'] },
  'system prompt': { word: 'syspmt', aliases: ['system prompt'] },
  'llama.cpp': { word: 'llama', aliases: ['llama.cpp', 'llamacpp'] },
  'Feature Flag': { word: 'FFlag', aliases: ['Feature Flag', 'feature flag'] },
  'better-sqlite3': { word: 'sql3', aliases: ['better-sqlite3', 'sqlite3'] },
  'pinyin-pro': { word: 'pyn', aliases: ['pinyin-pro', 'pinyin'] },
  'N-best': { word: 'Nbest', aliases: ['N-best', 'nbest'] },
  KenLM: { word: 'KLM', aliases: ['KenLM', 'kenlm'] },
  'Qwen2.5': { word: 'Qw25', aliases: ['Qwen2.5', '通义千问2.5', '千问2.5'] },
  ChatGPT: { word: 'GPT', aliases: ['ChatGPT', 'chatgpt'] },
  DeepSeek: { word: 'DSeek', aliases: ['DeepSeek', 'deepseek'] },
  SQLite: { word: 'SQLit', aliases: ['SQLite', 'sqlite'] },
  Python: { word: 'Py', aliases: ['Python', 'python'] },
  Docker: { word: 'Dock', aliases: ['Docker', 'docker'] },
};

function cjkLen(word) {
  return [...word].length;
}

function needsShorten(word) {
  const compact = word.replace(/\s+/g, '');
  if (compact.length > MAX_WORD_LEN) {
    return true;
  }
  if (/[\u4e00-\u9fff]/.test(word) && cjkLen(word) > RECALL_PREFERRED_MAX) {
    return true;
  }
  if (compact.length > RECALL_PREFERRED_MAX) {
    return true;
  }
  return false;
}

function shortenWord(word) {
  if (/[\u4e00-\u9fff]/.test(word)) {
    return [...word].slice(0, RECALL_PREFERRED_MAX).join('');
  }
  return word.replace(/\s+/g, '').slice(0, RECALL_PREFERRED_MAX);
}

export function mergeAliases(existing, extra) {
  const seen = new Set();
  for (const a of [...existing, ...extra]) {
    if (a?.trim()) {
      seen.add(a.trim());
    }
  }
  return [...seen];
}

function resolveReviewStatus(raw, deployDefault) {
  const key = raw?.trim() ?? '';
  if (deployDefault === 'approved') {
    return 'approved';
  }
  return REVIEW_STATUS_MAP[key] ?? deployDefault;
}

function stageRow(row, lineIndex, { reviewStatusDeploy, termIdPrefix, importBatchDefault }) {
  let word = String(row.word ?? '').trim();
  if (!word) {
    return null;
  }
  let aliases = Array.isArray(row.aliases) ? row.aliases.map((a) => String(a).trim()).filter(Boolean) : [];
  const originalWord = word;

  if (CANONICAL_OVERRIDES[word]) {
    const o = CANONICAL_OVERRIDES[word];
    aliases = mergeAliases(aliases, [originalWord, ...o.aliases]);
    word = o.word;
  } else if (needsShorten(word)) {
    aliases = mergeAliases(aliases, [originalWord]);
    word = shortenWord(word);
  }

  return {
    type: 'canonical_term',
    termId: row.termId ?? `${termIdPrefix}-${String(lineIndex + 1).padStart(5, '0')}`,
    word,
    pinyin: row.pinyin ?? '',
    domains: row.domains,
    priorScore: row.priorScore,
    aliases,
    enabled: row.enabled !== false,
    source: row.source ?? 'lexicon_v3_canonical_seed_v1',
    license: row.license ?? 'source-reference-open',
    importBatch: row.importBatch ?? importBatchDefault,
    normalizedBy: row.normalizedBy ?? 'import-v3-canonical-asset',
    reviewStatus: resolveReviewStatus(row.reviewStatus, reviewStatusDeploy),
  };
}

function pickKeeper(existing, incoming) {
  const a = existing.priorScore ?? 0;
  const b = incoming.priorScore ?? 0;
  return b > a ? incoming : existing;
}

/**
 * Sanitize raw JSONL rows: shorten words, merge duplicate canonicals, strip conflicting aliases.
 */
export function sanitizeV3CanonicalSeed(rawLines, options = {}) {
  const {
    reviewStatusDeploy = 'approved',
    termIdPrefix = 'v3',
    importBatchDefault = '2026-05-27-v3-canonical-seed',
  } = options;

  const staged = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const row = JSON.parse(rawLines[i]);
    const normalized = stageRow(row, i, { reviewStatusDeploy, termIdPrefix, importBatchDefault });
    if (normalized) {
      staged.push(normalized);
    }
  }

  const byWord = new Map();
  let mergedDup = 0;

  for (const row of staged) {
    const existing = byWord.get(row.word);
    if (!existing) {
      byWord.set(row.word, row);
      continue;
    }
    mergedDup += 1;
    const keeper = pickKeeper(existing, row);
    const other = keeper === existing ? row : existing;
    keeper.aliases = mergeAliases(keeper.aliases, other.aliases);
    if (other.word !== keeper.word) {
      keeper.aliases = mergeAliases(keeper.aliases, [other.word]);
    }
    if (other.termId && other.termId !== keeper.termId) {
      keeper.aliases = mergeAliases(keeper.aliases, [`id:${other.termId}`]);
    }
    byWord.set(row.word, keeper);
  }

  const canonicalWords = new Set(byWord.keys());
  const out = [];
  let aliasStripped = 0;

  for (const row of byWord.values()) {
    const before = row.aliases.length;
    row.aliases = row.aliases.filter((a) => a !== row.word && !canonicalWords.has(a));
    aliasStripped += before - row.aliases.length;
    out.push(row);
  }

  return {
    rows: out,
    stats: {
      rawRows: rawLines.length,
      stagedRows: staged.length,
      deployRows: out.length,
      mergedDup,
      aliasStripped,
      reviewStatusDeploy,
    },
  };
}
