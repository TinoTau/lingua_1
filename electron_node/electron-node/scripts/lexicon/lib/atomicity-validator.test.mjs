/**
 * Unified Atomicity Validator — unit + multi-path consistency + audit/enforce.
 */
import assert from 'assert';
import { createRequire } from 'module';
import { validateIndustryEntry } from '../industry_pack_v1/lib/validate-entry.mjs';

const require = createRequire(import.meta.url);
const {
  validateAtomicity,
  applyAtomicityMode,
  buildAtomicSurfaceSet,
} = require('./atomicity-validator.cjs');

const ATOMS = buildAtomicSurfaceSet([
  '上线',
  '计划',
  '接口',
  '文档',
  '蓝莓',
  '马芬',
  '国家',
  '博物馆',
  '焦糖',
  '玛奇朵',
  '内科',
  '医生',
  '大床',
  '房',
  '候选',
  '大床房',
]);

function draft(surface, extra = {}) {
  return {
    surface,
    normalizedSurface: surface,
    source: 'unit-test',
    domains: ['tech_ai'],
    ...extra,
  };
}

function decide(surface, extra = {}) {
  return validateAtomicity(draft(surface, extra), { atomicSurfaces: ATOMS });
}

// --- General rules ---
{
  const r = decide('上线计划');
  assert.strictEqual(r.decision, 'REJECT_COMPOSITE', '上线计划');
  assert.ok(
    r.reasonCode === 'ACTION_OBJECT_PHRASE' || r.reasonCode === 'NOUN_NOUN_BUSINESS_PHRASE',
    r.reasonCode
  );
  assert.deepStrictEqual(r.segments, ['上线', '计划']);
}
{
  const r = decide('接口文档');
  assert.strictEqual(r.decision, 'REJECT_COMPOSITE', '接口文档');
  assert.ok(
    ['NOUN_NOUN_BUSINESS_PHRASE', 'ACTION_OBJECT_PHRASE', 'COMPOSITE_OF_FORMAL_TERMS'].includes(
      r.reasonCode
    ),
    r.reasonCode
  );
  assert.deepStrictEqual(r.segments, ['接口', '文档']);
}
{
  const r = decide('蓝莓马芬');
  assert.strictEqual(r.decision, 'UNRESOLVED', '蓝莓马芬');
  assert.strictEqual(r.reasonCode, 'UNRESOLVED_NEEDS_EXCEPTION');
}
{
  const r = decide('国家博物馆');
  assert.strictEqual(r.decision, 'UNRESOLVED', '国家博物馆');
  assert.strictEqual(r.reasonCode, 'UNRESOLVED_NEEDS_EXCEPTION');
}
{
  const r = decide('焦糖玛奇朵');
  assert.strictEqual(r.decision, 'UNRESOLVED', '焦糖玛奇朵');
}
{
  const r = decide('内科医生');
  assert.strictEqual(r.decision, 'UNRESOLVED', '内科医生');
}
{
  const r = decide('大床房');
  assert.strictEqual(r.decision, 'ACCEPT', '大床房');
}
{
  const r = decide('候选');
  assert.strictEqual(r.decision, 'ACCEPT', '候选');
  assert.strictEqual(r.reasonCode, 'SHORT_ATOMIC');
}
{
  const r = decide('计划');
  assert.strictEqual(r.decision, 'ACCEPT', '计划');
}

// Exception metadata
{
  const r = decide('蓝莓马芬', {
    termType: 'fixed_product',
    exceptionReason: 'bakery product name',
  });
  assert.strictEqual(r.decision, 'ACCEPT_EXCEPTION');
  assert.strictEqual(r.reasonCode, 'FIXED_PRODUCT');
}
{
  const r = decide('蓝莓马芬', { termType: 'fixed_product' });
  assert.strictEqual(r.decision, 'REJECT_COMPOSITE');
  assert.strictEqual(r.reasonCode, 'MISSING_EXCEPTION_METADATA');
}

// No surface blacklist
{
  const src = require('fs').readFileSync(
    require('path').join(
      require('path').dirname(require.resolve('./atomicity-validator.cjs')),
      'atomicity-validator.cjs'
    ),
    'utf8'
  );
  assert.ok(!src.includes("surface === '上线计划'"));
  assert.ok(!src.includes("surface === '接口文档'"));
  assert.ok(!src.includes('bad_compounds'));
}

// Audit / Enforce
{
  const r = decide('上线计划');
  const audit = applyAtomicityMode(r, 'audit');
  assert.strictEqual(audit.allowWrite, true);
  assert.strictEqual(audit.blocked, false);
  const enf = applyAtomicityMode(r, 'enforce');
  assert.strictEqual(enf.allowWrite, false);
  assert.strictEqual(enf.blocked, true);
}

// Multi-path consistency: same draft → same decision via core + industry entry gate
{
  // Use a synthetic VO compound not on expansion denylist
  const surface = '提交报告';
  const atoms = buildAtomicSurfaceSet([...ATOMS, '提交', '报告']);
  const core = validateAtomicity(draft(surface), { atomicSurfaces: atoms });
  assert.strictEqual(core.decision, 'REJECT_COMPOSITE');
  const industry = validateIndustryEntry(
    {
      word: surface,
      pinyin: 'ti jiao bao gao',
      tone_pinyin: 'ti2 jiao1 bao4 gao4',
      domain_tags: ['tech_ai'],
      repair_target: true,
    },
    new Set(['tech_ai']),
    1,
    { atomicSurfaces: atoms, atomicityMode: 'enforce' }
  );
  assert.strictEqual(industry.ok, false);
  assert.strictEqual(industry.code, 'atomicity_rejected');
  assert.strictEqual(industry.atomicity.decision, core.decision);
  assert.strictEqual(industry.atomicity.reasonCode, core.reasonCode);
}

console.log('[atomicity-validator.test] PASS');
