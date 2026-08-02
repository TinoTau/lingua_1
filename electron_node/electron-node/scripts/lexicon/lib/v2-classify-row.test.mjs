import assert from 'node:assert/strict';
import { classifyLexiconV2Row, loadRegistry } from './v2-classify-row.mjs';
import { syllablesKeyFromArray, pinyinKeyFromPinyinField } from './v2-pinyin-key.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(__dirname, '../../../data/lexicon/profile-registry.json');
const registry = loadRegistry(registryPath);

function entry(row, file = 'test.jsonl', line = 1) {
  return { file, line, row };
}

console.log('[v2-classify-row.test] start');

assert.equal(pinyinKeyFromPinyinField('zhong bei'), 'zhong|bei');
assert.equal(syllablesKeyFromArray(['zhong', 'bei']), 'zhong|bei');

const base = classifyLexiconV2Row(
  entry({
    type: 'canonical_term',
    word: '我们',
    pinyin: 'wo men',
    priorScore: 0.9,
    enabled: true,
    lexiconLayer: 'base',
    domains: ['travel'],
  }),
  registry
);
assert.equal(base.tier, 'base');

const idiom = classifyLexiconV2Row(
  entry({
    type: 'canonical_term',
    word: '胡说八道',
    pinyin: 'hu shuo ba dao',
    priorScore: 0.9,
    enabled: true,
    lexiconLayer: 'idiom',
    domains: ['restaurant'],
  }),
  registry
);
assert.equal(idiom.tier, 'idiom');

const domain = classifyLexiconV2Row(
  entry({
    type: 'canonical_term',
    word: '中杯',
    pinyin: 'zhong bei',
    priorScore: 0.9,
    enabled: true,
    lexiconLayer: 'domain_patch',
    domains: ['restaurant'],
  }),
  registry
);
assert.equal(domain.tier, 'domain');
assert.deepEqual(domain.domainIds, ['restaurant']);

const oneChar = classifyLexiconV2Row(
  entry({
    type: 'canonical_term',
    word: '杯',
    pinyin: 'bei',
    priorScore: 0.9,
    enabled: true,
    domains: ['general'],
  }),
  registry
);
assert.equal(oneChar.tier, 'reject');
assert.equal(oneChar.rejectCode, 'one_char');

const common5 = classifyLexiconV2Row(
  entry({
    type: 'canonical_term',
    word: '中华人民共和国',
    pinyin: 'zhong hua ren min gong he guo',
    priorScore: 0.9,
    enabled: true,
    lexiconLayer: 'common5',
    domains: ['travel'],
  }),
  registry
);
assert.equal(common5.tier, 'reject');
assert.equal(common5.rejectCode, 'common5_deferred');

console.log('[v2-classify-row.test] PASS');
