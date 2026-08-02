import {
  applyAtomicityMode,
  buildAtomicSurfaceSet,
  validateAtomicity,
} from './atomicity-validator';

const ATOMS = buildAtomicSurfaceSet([
  '上线',
  '计划',
  '接口',
  '文档',
  '蓝莓',
  '马芬',
  '大床房',
  '候选',
]);

describe('Unified Atomicity multipath consistency', () => {
  it('same draft yields identical decision for rebuild/patch/industry owners', () => {
    const draft = {
      surface: '接口文档',
      normalizedSurface: '接口文档',
      source: 'shared',
      domains: ['tech_ai'],
    };
    const a = validateAtomicity(draft, { atomicSurfaces: ATOMS });
    const b = validateAtomicity({ ...draft, source: 'patch-v4' }, { atomicSurfaces: ATOMS });
    const c = validateAtomicity({ ...draft, source: 'industry-import' }, { atomicSurfaces: ATOMS });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.decision).toBe('REJECT_COMPOSITE');
  });

  it('audit allows write; enforce blocks reject', () => {
    const result = validateAtomicity(
      { surface: '上线计划', source: 't', domains: [] },
      { atomicSurfaces: ATOMS }
    );
    expect(applyAtomicityMode(result, 'audit').allowWrite).toBe(true);
    expect(applyAtomicityMode(result, 'enforce').blocked).toBe(true);
  });

  it('short atomic accepts 大床房 / 候选', () => {
    expect(
      validateAtomicity({ surface: '大床房', source: 't', domains: [] }, { atomicSurfaces: ATOMS })
        .decision
    ).toBe('ACCEPT');
    expect(
      validateAtomicity({ surface: '候选', source: 't', domains: [] }, { atomicSurfaces: ATOMS })
        .decision
    ).toBe('ACCEPT');
  });

  it('蓝莓马芬 unresolved without exception metadata', () => {
    const r = validateAtomicity(
      { surface: '蓝莓马芬', source: 't', domains: ['bakery'] },
      { atomicSurfaces: ATOMS }
    );
    expect(r.decision).toBe('UNRESOLVED');
    expect(applyAtomicityMode(r, 'audit').allowWrite).toBe(true);
    expect(applyAtomicityMode(r, 'enforce').blocked).toBe(true);
  });

  it('short independent words are not SENTENCE_FRAGMENT (是否 / 邀请函)', () => {
    expect(validateAtomicity({ surface: '是否', source: 't' }).decision).toBe('ACCEPT');
    expect(validateAtomicity({ surface: '邀请函', source: 't' }).decision).toBe('ACCEPT');
    expect(validateAtomicity({ surface: '迷你吧', source: 't' }).decision).toBe('ACCEPT');
  });

  it('interrogative tails and long phrases with 是否 still REJECT', () => {
    expect(validateAtomicity({ surface: '可以吗', source: 't' }).decision).toBe('REJECT_COMPOSITE');
    expect(validateAtomicity({ surface: '检查是否有', source: 't' }, { atomicSurfaces: ATOMS }).decision).toBe(
      'REJECT_COMPOSITE'
    );
  });

  it('domain_atomic exception metadata accepts', () => {
    const r = validateAtomicity({
      surface: '神经网络',
      source: 't',
      termType: 'domain_atomic',
      exceptionReason:
        '表面可由原子词覆盖，但有效 fine-domain presence 仅由完整词承担；原子词补同域标签会造成过宽或歧义。',
    });
    expect(r.decision).toBe('ACCEPT_EXCEPTION');
    expect(r.reasonCode).toBe('DOMAIN_ATOMIC');
  });
});
