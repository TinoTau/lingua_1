/**
 * 段文本规范化 — Q1 冻结：NFKC、去空白与标点（用于 observed / fuzzy 匹配）。
 */

const PUNCT_AND_SPACE_RE = /[\s\u3000-\u303f\uff00-\uffef.,!?;:'"()[\]{}<>，。！？；：、（）【】「」—…·\-@#$%^&*+=|\\/~～]+/g;

export function normalizeSegmentTextForMatch(text: string): string {
  const nfkc = text.normalize('NFKC').trim();
  return nfkc.replace(PUNCT_AND_SPACE_RE, '');
}

/** 编辑距离 ≤ maxDist（仅用于短串 observed，长度通常 ≤ 8）。 */
export function boundedEditDistance(a: string, b: string, maxDist: number): number {
  if (a === b) {
    return 0;
  }
  if (Math.abs(a.length - b.length) > maxDist) {
    return maxDist + 1;
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array<number>(cols);
  let curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) {
    prev[j] = j;
  }
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDist) {
      return maxDist + 1;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function isFuzzyObservedMatch(windowText: string, observed: string, maxEdit = 1): boolean {
  const w = normalizeSegmentTextForMatch(windowText);
  const o = normalizeSegmentTextForMatch(observed);
  if (!w.length || !o.length || w.length < 2 || o.length < 2) {
    return false;
  }
  if (w === o) {
    return true;
  }
  return boundedEditDistance(w, o, maxEdit) <= maxEdit;
}
