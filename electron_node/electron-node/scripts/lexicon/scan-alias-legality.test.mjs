#!/usr/bin/env node
import assert from 'assert';
import { validateAliasEntry, scanPatchAliasLegality } from './lib/alias-ownership-contract.mjs';

// LEGAL — typed trad/simp
assert.deepStrictEqual(
  validateAliasEntry({ alias: '計劃', canonical: '计划', alias_type: 'TRAD_SIMPLIFIED' }),
  { ok: true }
);

// LEGAL — en/zh
assert.deepStrictEqual(
  validateAliasEntry({ alias: 'hotel', canonical: '酒店', alias_type: 'EN_ZH_MAPPING' }),
  { ok: true }
);

// ILLEGAL — missing alias_type
{
  const r = validateAliasEntry({ alias: '候選', canonical: '候选' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.violation, 'MISSING_ALIAS_TYPE');
}

// ILLEGAL — ASR homophone P0
{
  const r = validateAliasEntry({ alias: '像蔡', canonical: '香菜', alias_type: 'ENTITY_WRITING' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.violation, 'ASR_HOMOPHONE');
}

// ILLEGAL — tone confusion
{
  const r = validateAliasEntry({ alias: '少病', canonical: '少冰', alias_type: 'ENTITY_WRITING' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.violation, 'ASR_HOMOPHONE');
}

// ILLEGAL — near phone
{
  const r = validateAliasEntry({ alias: '巧可力', canonical: '巧克力', alias_type: 'TRAD_SIMPLIFIED' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.violation, 'ASR_NEAR_PHONE');
}

// Patch scan — legal aliasEntries
{
  const patch = {
    patchId: 'fixture-legal',
    operations: [
      {
        op: 'add',
        table: 'term',
        word: '计划',
        entry: {
          word: '计划',
          aliasEntries: [{ alias: '計劃', alias_type: 'TRAD_SIMPLIFIED' }],
        },
      },
    ],
  };
  assert.strictEqual(scanPatchAliasLegality(patch).length, 0);
}

// Patch scan — bare aliases[] without type
{
  const patch = {
    patchId: 'fixture-illegal-bare',
    operations: [
      {
        op: 'add',
        table: 'term',
        word: '香菜',
        entry: {
          word: '香菜',
          aliases: ['像蔡'],
        },
      },
    ],
  };
  const hits = scanPatchAliasLegality(patch);
  assert.ok(hits.length >= 1);
  assert.strictEqual(hits[0].violation, 'MISSING_ALIAS_TYPE');
}

console.log('[scan-alias-legality.test] PASS');
