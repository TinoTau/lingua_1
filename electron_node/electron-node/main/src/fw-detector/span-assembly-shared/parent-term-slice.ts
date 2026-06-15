/**
 * Parent term syllable→char slice (SSOT aligned with materialize-term-ngrams.mjs sliceFragmentText).
 */

export function parentTermSyllableCount(parentPinyinKey: string): number {
  return parentPinyinKey.split('|').filter(Boolean).length;
}

export function sliceParentTermText(
  parentTerm: string,
  parentSyllableCount: number,
  syllableStart: number,
  syllableEnd: number
): string {
  if (parentSyllableCount === 0 || syllableEnd > parentSyllableCount || syllableStart >= syllableEnd) {
    return '';
  }
  const runLen = parentTerm.length;
  const charsPerSyllable = runLen / parentSyllableCount;
  const charStart = Math.floor(syllableStart * charsPerSyllable);
  const charEnd = Math.ceil(syllableEnd * charsPerSyllable);
  return parentTerm.slice(charStart, charEnd);
}
