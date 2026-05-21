import type { WindowPhoneticPreviewItem } from '../phonetic/types';
import type { SpanWindow } from './types';

function hashSpanText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function groupKey(item: WindowPhoneticPreviewItem): string {
  const text = item.spanText.trim();
  if (
    typeof item.spanStart === 'number' &&
    typeof item.spanEnd === 'number' &&
    item.spanEnd > item.spanStart
  ) {
    return `${item.spanStart}:${item.spanEnd}:${text}`;
  }
  return `text:${text}`;
}

function resolveSpanFromPreview(
  originalText: string,
  item: WindowPhoneticPreviewItem
): { start: number; end: number; text: string } {
  const text = item.spanText.trim();
  if (
    typeof item.spanStart === 'number' &&
    typeof item.spanEnd === 'number' &&
    item.spanEnd > item.spanStart &&
    item.spanEnd <= originalText.length
  ) {
    const slice = originalText.slice(item.spanStart, item.spanEnd);
    if (slice === text) {
      return { start: item.spanStart, end: item.spanEnd, text };
    }
  }
  const idx = originalText.indexOf(text);
  if (idx >= 0) {
    return { start: idx, end: idx + text.length, text };
  }
  return { start: 0, end: 0, text };
}

export function buildSpanWindows(params: {
  originalText: string;
  preview: WindowPhoneticPreviewItem[];
}): SpanWindow[] {
  const originalText = params.originalText.trim();
  if (!originalText || !params.preview.length) {
    return [];
  }

  const groups = new Map<string, WindowPhoneticPreviewItem[]>();
  for (const item of params.preview) {
    const key = groupKey(item);
    const list = groups.get(key);
    if (list) {
      list.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const windows: SpanWindow[] = [];
  for (const [key, previews] of groups) {
    const span = resolveSpanFromPreview(originalText, previews[0]);
    const windowId =
      span.start < span.end
        ? `w-${span.start}-${span.end}-${hashSpanText(span.text)}`
        : `w-${hashSpanText(span.text)}`;

    windows.push({
      windowId,
      span,
      previews,
      boundCandidates: [],
    });
  }

  windows.sort((a, b) => a.span.start - b.span.start || a.span.text.localeCompare(b.span.text));
  return windows;
}
