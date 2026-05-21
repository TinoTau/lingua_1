import { buildSpanWindows } from './buildSpanWindows';
import type { WindowPhoneticPreviewItem } from '../phonetic/types';

describe('buildSpanWindows', () => {
  const originalText = '今天我们讨论后选生城和上线计化流程安排';

  it('groups previews with same coordinates into one window', () => {
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: '后选生城',
        spanStart: 6,
        spanEnd: 10,
        candidateText: '候选生成',
        candidateSource: 'confusion',
        phoneticScore: 0.9,
      },
      {
        spanText: '后选生城',
        spanStart: 6,
        spanEnd: 10,
        candidateText: '后选生成',
        candidateSource: 'confusion',
        phoneticScore: 0.95,
      },
    ];
    const windows = buildSpanWindows({ originalText, preview });
    expect(windows).toHaveLength(1);
    expect(windows[0].previews).toHaveLength(2);
    expect(windows[0].span.text).toBe('后选生城');
  });

  it('splits same text at different coordinates into two windows', () => {
    const text = '后选生城后选生城';
    const preview: WindowPhoneticPreviewItem[] = [
      {
        spanText: '后选生城',
        spanStart: 0,
        spanEnd: 4,
        candidateText: '候选生成',
        candidateSource: 'confusion',
        phoneticScore: 1,
      },
      {
        spanText: '后选生城',
        spanStart: 4,
        spanEnd: 8,
        candidateText: '候选生成',
        candidateSource: 'confusion',
        phoneticScore: 1,
      },
    ];
    const windows = buildSpanWindows({ originalText: text, preview });
    expect(windows).toHaveLength(2);
    expect(windows[0].span.start).toBe(0);
    expect(windows[1].span.start).toBe(4);
  });
});
