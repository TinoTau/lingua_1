import * as fs from 'fs';
import * as path from 'path';
import { sanitizeSegmentForOutput } from './dedup';

const D067_FIXTURE_PATH = path.join(
  __dirname,
  '../../../tests/experiments/schema-v2-dialog200-summary.json'
);

function loadD067Raw(): string {
  const summary = JSON.parse(fs.readFileSync(D067_FIXTURE_PATH, 'utf8')) as {
    worst_final: Array<{ id: string; raw: string }>;
  };
  const row = summary.worst_final.find((item) => item.id === 'd067');
  if (!row?.raw) {
    throw new Error('d067 raw fixture missing in schema-v2-dialog200-summary.json');
  }
  return row.raw;
}

function maxConsecutiveUnit(text: string, unit: string): number {
  let max = 0;
  for (let i = 0; i < text.length; i += 1) {
    let count = 0;
    let pos = i;
    while (text.slice(pos, pos + unit.length) === unit) {
      count += 1;
      pos += unit.length;
    }
    if (count > max) {
      max = count;
    }
  }
  return max;
}

describe('sanitizeSegmentForOutput', () => {
  it('d067 fixture: no prefix loop ≥3 and output shorter than input', () => {
    const raw = loadD067Raw();
    const unit = '您好,我定,';
    const { text, trace } = sanitizeSegmentForOutput(raw);

    expect(trace.applied).toBe(true);
    expect(trace.rule).toBe('prefix_repeat');
    expect(trace.repeatUnit).toBe(unit);
    expect(trace.repeatCount).toBeGreaterThanOrEqual(3);
    expect(maxConsecutiveUnit(text, unit)).toBeLessThan(3);
    expect(text.length).toBeLessThan(raw.length);
    expect(text).toBe(unit);
  });

  it('prefix × N + tail: keeps tail only', () => {
    const input = '您好,我定,您好,我定,您好,我定,\n\n订单显示已发货';
    const { text, trace } = sanitizeSegmentForOutput(input);

    expect(trace.applied).toBe(true);
    expect(trace.rule).toBe('prefix_repeat');
    expect(text).toBe('订单显示已发货');
    expect(text).not.toContain('您好,我定,');
  });

  it('oral double reduplication stays unchanged', () => {
    for (const sample of ['谢谢谢谢', '好的好的', '可以可以']) {
      const { text, trace } = sanitizeSegmentForOutput(sample);
      expect(text).toBe(sample);
      expect(trace.applied).toBe(false);
      expect(trace.rule).toBe('none');
    }
  });

  it('triple reduplication collapses to single unit', () => {
    const { text, trace } = sanitizeSegmentForOutput('谢谢谢谢谢谢');
    expect(trace.applied).toBe(true);
    expect(trace.rule).toBe('prefix_repeat');
    expect(text).toBe('谢谢');
  });

  it('empty input returns none trace', () => {
    const { text, trace } = sanitizeSegmentForOutput('   ');
    expect(text).toBe('');
    expect(trace).toEqual({
      applied: false,
      rule: 'none',
      beforeLength: 3,
      afterLength: 0,
    });
  });
});
