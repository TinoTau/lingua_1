import { describe, expect, it } from '@jest/globals';
import { enumerateAsrWindows } from './enumerate-asr-windows';

describe('enumerateAsrWindows', () => {
  it('enumerates 后选声城 with coordinates', () => {
    const top1 = '今天我们讨论后选声城流程';
    const idx = top1.indexOf('后选声城');
    const windows = enumerateAsrWindows(top1);
    const hit = windows.find((w) => w.text === '后选声城');
    expect(hit).toBeDefined();
    expect(hit!.start).toBe(idx);
    expect(hit!.end).toBe(idx + 4);
    expect(hit!.syllables.length).toBeGreaterThan(0);
  });

  it('respects maxWindows cap', () => {
    const long = '后选声城'.repeat(40);
    const windows = enumerateAsrWindows(long, { maxWindows: 10 });
    expect(windows.length).toBe(10);
  });
});
