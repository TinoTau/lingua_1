/**
 * Face2Face LID 入口校验：candidates 为调度下发的二选一语言码（来自 Web 用户选择），仅校验格式
 */

export function validateLidCandidates(candidates: unknown): asserts candidates is [string, string] {
  if (!Array.isArray(candidates) || candidates.length !== 2) {
    const err = new Error('LID_INVALID_CANDIDATES: lid.candidates must be an array of exactly 2 language codes');
    (err as any).code = 'LID_INVALID_CANDIDATES';
    throw err;
  }
  const [a, b] = candidates as string[];
  if (typeof a !== 'string' || typeof b !== 'string' || a.trim() === '' || b.trim() === '') {
    const err = new Error('LID_INVALID_CANDIDATES: lid.candidates elements must be non-empty strings');
    (err as any).code = 'LID_INVALID_CANDIDATES';
    throw err;
  }
}

/** 规范化为小写主语言码（如 zh-CN -> zh），保持二选一顺序 */
export function normalizeLidCandidates(candidates: [string, string]): [string, string] {
  const norm = (x: string) => x.split('-')[0].toLowerCase().trim();
  return [norm(candidates[0]), norm(candidates[1])];
}
