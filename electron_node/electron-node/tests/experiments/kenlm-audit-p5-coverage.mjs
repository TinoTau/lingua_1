#!/usr/bin/env node
/** P5: KenLM vocab / OOV audit (read-only) */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../../');
const ARPA = path.join(ROOT, 'kenLM/model/zh_char_3gram.arpa');
const TRIE = path.join(ROOT, 'kenLM/model/zh_char_3gram.trie.bin');
const MANIFEST = path.join(ROOT, 'test wav/dialog_200/cases.manifest.json');

function tokenizeForLm(text) {
  const KEEP_PUNCT = new Set('，。！？；：、""\'\'（）()《》<>【】[]—-…·,.!?;:"\'');
  const normalized = text.normalize('NFKC').trim();
  const tokens = [];
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch >= '\u4e00' && ch <= '\u9fff') { tokens.push(ch); i++; continue; }
    const latin = /^[A-Za-z][A-Za-z0-9]*/.exec(normalized.slice(i));
    if (latin) { tokens.push(latin[0]); i += latin[0].length; continue; }
    const digits = /^\d+/.exec(normalized.slice(i));
    if (digits) { tokens.push(digits[0]); i += digits[0].length; continue; }
    if (KEEP_PUNCT.has(ch)) { tokens.push(ch); i++; continue; }
    i++;
  }
  return tokens;
}

function parseArpaVocab(arpaPath) {
  const text = fs.readFileSync(arpaPath, 'utf8');
  const vocab = new Set();
  const in1 = text.indexOf('\\1-grams:');
  const in2 = text.indexOf('\\2-grams:');
  if (in1 < 0 || in2 < 0) return vocab;
  const block = text.slice(in1, in2);
  for (const line of block.split('\n')) {
    const m = /^\s*[-\d.e+]+\s+(\S+)/.exec(line);
    if (m) vocab.add(m[1]);
  }
  return vocab;
}

function runKenlmQuery(tokenized) {
  return new Promise((resolve) => {
    const wslQuery = '/mnt/d/Programs/github/lingua_1/kenLM/kenlm/build/bin/query';
    const wslTrie = '/mnt/d/Programs/github/lingua_1/kenLM/model/zh_char_3gram.trie.bin';
    const proc = spawn('wsl.exe', ['--', wslQuery, wslTrie], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (c) => { out += c; });
    proc.stdout.on('end', () => {
      const line = out.split('\n').find((l) => /Total:/i.test(l)) ?? '';
      const score = parseFloat((line.match(/Total:\s*([-\d.e]+)/i) ?? [])[1] ?? '0');
      const oov = parseInt((line.match(/OOV:\s*(\d+)/i) ?? [])[1] ?? '0', 10);
      resolve({ score, oov, line: line.trim() });
    });
    proc.on('error', () => resolve({ score: 0, oov: -1, line: 'error' }));
    proc.stdin.write(tokenized + '\n', 'utf-8', () => proc.stdin.end());
  });
}

const SAMPLE_TERMS = ['中杯', '少糖', '拿铁', '蓝莓马芬', '大杯', '热美式', '带走', '顺便问一下'];

function extractBigramsFromRefs(manifest, scenarioFilter) {
  const terms = new Set();
  for (const c of manifest) {
    if (scenarioFilter && c.scenario !== scenarioFilter) continue;
    const tokens = tokenizeForLm(c.utterance);
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].length === 1 && tokens[i + 1].length === 1) {
        terms.add(tokens[i] + tokens[i + 1]);
      }
    }
  }
  return [...terms];
}

async function main() {
  const vocab = parseArpaVocab(ARPA);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  const sampleResults = [];
  for (const term of SAMPLE_TERMS) {
    const tokens = tokenizeForLm(term);
    const chars = tokens.filter((t) => t.length === 1);
    const charOov = chars.filter((c) => !vocab.has(c));
    const tokenized = tokens.join(' ');
    const q = fs.existsSync(TRIE) ? await runKenlmQuery(tokenized) : { score: null, oov: null };
    sampleResults.push({
      term,
      tokenized,
      chars,
      charOovInArpa: charOov,
      isOov: charOov.length > 0,
      queryOov: q.oov,
      queryScore: q.score,
    });
  }

  const domainTerms = extractBigramsFromRefs(manifest, 'cafe').slice(0, 100);
  const baseTerms = extractBigramsFromRefs(manifest, null).slice(0, 100);

  function coverage(terms) {
    let hit = 0;
    let charHit = 0;
    let charTotal = 0;
    const misses = [];
    for (const term of terms) {
      const chars = [...term];
      charTotal += chars.length;
      const allIn = chars.every((c) => vocab.has(c));
      if (allIn) hit += 1;
      else misses.push(term);
      charHit += chars.filter((c) => vocab.has(c)).length;
    }
    return {
      termCount: terms.length,
      termCoverage: terms.length ? hit / terms.length : 0,
      charCoverage: charTotal ? charHit / charTotal : 0,
      misses: misses.slice(0, 20),
    };
  }

  const out = {
    arpaPath: ARPA,
    vocabSize: vocab.size,
    trieExists: fs.existsSync(TRIE),
    arpaExists: fs.existsSync(ARPA),
    trainingCorpus: 'kenLM/corpus/zh_sentences.raw.txt (~439k sentences, news summary)',
    sampleTerms: sampleResults,
    sampleOovRate: sampleResults.filter((s) => s.isOov).length / sampleResults.length,
    domainTop100: coverage(domainTerms.length ? domainTerms : SAMPLE_TERMS),
    baseTop100: coverage(baseTerms),
  };

  const outPath = path.join(__dirname, 'kenlm-audit-p5-coverage.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch(console.error);
