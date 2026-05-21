import { detectSuspiciousSpans } from './suspicious-span-detector';
import { textToSyllables } from './phonetic/pinyin';
import type { AsrWindow } from './lexicon-types';

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export type EnumerateAsrWindowsOptions = {
  minChars: number;
  maxChars: number;
  maxWindows: number;
  hypothesisIndex?: number;
};

export const DEFAULT_ENUMERATE_ASR_WINDOWS_OPTIONS: EnumerateAsrWindowsOptions = {
  minChars: 2,
  maxChars: 8,
  maxWindows: 192,
};

function hashShort(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/**
 * Enumerate 2–6 char ASR windows within punctuation chunks (no cross-chunk).
 */
export function enumerateAsrWindows(
  top1Text: string,
  options: Partial<EnumerateAsrWindowsOptions> = {}
): AsrWindow[] {
  const opts = { ...DEFAULT_ENUMERATE_ASR_WINDOWS_OPTIONS, ...options };
  const chunks = detectSuspiciousSpans(top1Text);
  const windows: AsrWindow[] = [];

  for (const chunk of chunks) {
    const text = chunk.text;
    const maxWin = Math.min(opts.maxChars, text.length);

    for (let size = opts.minChars; size <= maxWin; size++) {
      for (let i = 0; i + size <= text.length; i++) {
        if (windows.length >= opts.maxWindows) {
          return windows;
        }

        const windowText = text.slice(i, i + size);
        if (!hasCjk(windowText)) {
          continue;
        }

        const start = chunk.start + i;
        const end = start + size;
        const syllables = textToSyllables(windowText);
        if (!syllables.length) {
          continue;
        }

        const hIdx = opts.hypothesisIndex ?? 0;
        windows.push({
          windowId: `h${hIdx}-aw-${start}-${end}-${hashShort(windowText)}`,
          text: windowText,
          start,
          end,
          syllables,
        });
      }
    }
  }

  return windows;
}
