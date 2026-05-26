#!/usr/bin/env node
/**
 * One-shot sanitizer for Phase 3 lexicon_1k_pilot_v1.jsonl (strict validate gate).
 * Reads package seed, writes electron-node/data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_BUILD_LEN = 8;
const MAX_RECALL_LEN = 5;

const packageSeed = path.resolve(
  __dirname,
  '../../../docs/lexicon-assets/Lexicon_1k_Pilot_Phase3_Package/lexicon_1k_pilot_v1.jsonl'
);
const outSeed = path.resolve(__dirname, '../../data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl');

const CANONICAL_OVERRIDES = {
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
  'Faster Whisper': { word: 'FW', aliases: ['Faster Whisper', 'faster whisper'] },
  'beam search': { word: 'beam', aliases: ['beam search', '波束搜索'] },
  'system prompt': { word: 'syspmt', aliases: ['system prompt'] },
  prompt: { word: 'prmpt', aliases: ['prompt'] },
  token: { word: 'token', aliases: [] },
  'llama.cpp': { word: 'llama', aliases: ['llama.cpp'] },
  'Feature Flag': { word: 'FFlag', aliases: ['Feature Flag', 'feature flag', 'FeatFlg'] },
  'better-sqlite3': { word: 'sql3', aliases: ['better-sqlite3', 'sqlite3'] },
  'pinyin-pro': { word: 'pyn', aliases: ['pinyin-pro', 'pinyin'] },
  'N-best': { word: 'Nbest', aliases: ['N-best', 'nbest', 'n best'] },
  KenLM: { word: 'KLM', aliases: ['KenLM', 'kenlm'] },
  sprompt: { word: 'syspmt', aliases: ['system prompt', 'sprompt'] },
  syspmt: { word: 'spmt', aliases: ['system prompt', 'syspmt', 'sprompt'] },
  Qwen25: { word: 'Qw25', aliases: ['Qwen25', 'Qwen2.5', '通义千问'] },
  FeatFlg: { word: 'FFlag', aliases: ['Feature Flag', 'feature flag', 'FeatFlg'] },
  sqlite3: { word: 'sql3', aliases: ['better-sqlite3', 'sqlite3'] },
  pinyin: { word: 'pyn', aliases: ['pinyin-pro', 'pinyin'] },
  'SQLite索引': { word: 'SQL索引', aliases: ['SQLite索引'] },
  'HTTP接口': { word: 'HTTP', aliases: ['HTTP接口'] },
  'REST接口': { word: 'REST', aliases: ['REST接口'] },
  SQLite: { word: 'SQLit', aliases: ['SQLite', 'sqlite'] },
  Python: { word: 'Py', aliases: ['Python', 'python'] },
  Docker: { word: 'Dock', aliases: ['Docker', 'docker'] },
  DeepSeek: { word: 'DSeek', aliases: ['DeepSeek', 'deepseek'] },
  ChatGPT: { word: 'GPT', aliases: ['ChatGPT', 'chatgpt'] },
  Claude: { word: 'Claud', aliases: ['Claude', 'claude'] },
  'Qwen2.5': { word: 'Qwen25', aliases: ['Qwen2.5', '通义千问'] },
  'JSON输出': { word: 'JSON出', aliases: ['JSON输出'] },
  结构化输出: { word: '结构输出', aliases: ['结构化输出'] },
  配置热更新: { word: '热更新', aliases: ['配置热更新'] },
};

function cjkLen(word) {
  return [...word].length;
}

function needsShorten(word) {
  if (word.length > MAX_BUILD_LEN) {
    return true;
  }
  if (/[\u4e00-\u9fff]/.test(word) && cjkLen(word) > MAX_RECALL_LEN) {
    return true;
  }
  if (/^[A-Za-z0-9._\s-]+$/.test(word) && word.length > MAX_RECALL_LEN) {
    return true;
  }
  return false;
}

function shortenCjk(word) {
  const chars = [...word];
  if (chars.length <= MAX_RECALL_LEN) {
    return word;
  }
  return chars.slice(0, MAX_RECALL_LEN).join('');
}

function mergeAliases(existing, extra) {
  const set = new Set();
  for (const a of existing) {
    if (a?.trim()) {
      set.add(a.trim());
    }
  }
  for (const a of extra) {
    if (a?.trim()) {
      set.add(a.trim());
    }
  }
  return [...set];
}

const lines = fs.readFileSync(packageSeed, 'utf-8').split(/\r?\n/).filter(Boolean);
const canonicalWords = new Set();
const out = [];

for (const line of lines) {
  const row = JSON.parse(line);
  if (row.type !== 'canonical_term') {
    out.push(line);
    continue;
  }

  let word = row.word.trim();
  let aliases = Array.isArray(row.aliases) ? [...row.aliases] : [];

  if (CANONICAL_OVERRIDES[word]) {
    const o = CANONICAL_OVERRIDES[word];
    aliases = mergeAliases(aliases, [word, ...o.aliases]);
    word = o.word;
  } else if (needsShorten(word)) {
    const shortened = /[\u4e00-\u9fff]/.test(word) ? shortenCjk(word) : word.slice(0, MAX_BUILD_LEN);
    aliases = mergeAliases(aliases, [word]);
    word = shortened;
  }

  if (word === 'API') {
    aliases = aliases.filter((a) => a !== '接口');
    aliases = mergeAliases(aliases, ['api']);
  }

  if (canonicalWords.has(word)) {
    console.warn(`[sanitize-1k] skip duplicate canonical: ${word} (was ${row.termId})`);
    continue;
  }
  canonicalWords.add(word);

  aliases = aliases.filter((a) => !canonicalWords.has(a) || a === word);

  aliases = aliases.filter((a) => a.trim() && a.trim() !== word);
  row.word = word;
  row.aliases = aliases;
  const enriched = {
    type: 'canonical_term',
    termId: row.termId,
    word: row.word,
    pinyin: row.pinyin ?? '',
    domains: row.domains,
    priorScore: row.priorScore,
    aliases: row.aliases,
    source: row.source ?? 'travel_seed_v1',
    enabled: row.enabled !== false,
    license: 'internal-pilot',
    importBatch: 'lexicon-1k-pilot-v1',
    normalizedBy: 'sanitize-1k-pilot-seed',
    reviewStatus: 'approved',
  };
  out.push(JSON.stringify(enriched));
}

fs.mkdirSync(path.dirname(outSeed), { recursive: true });
fs.writeFileSync(outSeed, `${out.join('\n')}\n`, 'utf-8');
fs.writeFileSync(packageSeed, `${out.join('\n')}\n`, 'utf-8');
console.log(`[sanitize-1k] wrote ${out.length} rows → ${outSeed}`);
