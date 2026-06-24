import type Database from 'better-sqlite3';
import type { PatchOperationV4 } from './patch-types-v4';
import { resolvePinyinKey } from '../lexicon-patch-v3/pinyin-resolve';
import { slugTermIdForPatch } from '../lexicon-patch-v3/term-materialize-bridge';

export type TermRefError = {
  code: 'term_not_found' | 'ambiguous_term_word' | 'missing_pinyin_key';
  message: string;
};

export type ResolvedTermRef = {
  termId: string;
  word: string;
  pinyinKey: string;
};

export function resolvePinyinKeyForOp(op: PatchOperationV4): string | null {
  return resolvePinyinKey(op.word, op.pinyin_key, op.pinyin);
}

export function assertAddTermNoCollision(
  db: Database.Database,
  op: PatchOperationV4
): { ok: true; termId: string; pinyinKey: string } | { ok: false; code: 'term_already_exists'; message: string } {
  const pinyinKey = resolvePinyinKeyForOp(op);
  if (!pinyinKey) {
    return { ok: false, code: 'term_already_exists', message: 'addTerm requires pinyin_key or pinyin' };
  }

  const explicitId = op.term_id?.trim();
  if (explicitId) {
    const byId = db.prepare('SELECT id FROM term WHERE id = ?').get(explicitId) as { id: string } | undefined;
    if (byId) {
      return {
        ok: false,
        code: 'term_already_exists',
        message: `term_id already exists: ${explicitId}`,
      };
    }
  }

  const byWordPinyin = db
    .prepare('SELECT id FROM term WHERE word = ? AND pinyin_key = ?')
    .get(op.word.trim(), pinyinKey) as { id: string } | undefined;
  if (byWordPinyin) {
    return {
      ok: false,
      code: 'term_already_exists',
      message: `term already exists for word=${op.word} pinyin_key=${pinyinKey}`,
    };
  }

  const termId = explicitId || slugTermIdForPatch(op.word.trim(), pinyinKey);
  return { ok: true, termId, pinyinKey };
}

export function resolveTermRef(
  db: Database.Database,
  op: PatchOperationV4
): { ok: true; ref: ResolvedTermRef } | { ok: false; error: TermRefError } {
  const explicitId = op.term_id?.trim();
  if (explicitId) {
    const row = db
      .prepare('SELECT id, word, pinyin_key FROM term WHERE id = ?')
      .get(explicitId) as { id: string; word: string; pinyin_key: string } | undefined;
    if (!row) {
      return {
        ok: false,
        error: { code: 'term_not_found', message: `term_id not found: ${explicitId}` },
      };
    }
    return {
      ok: true,
      ref: { termId: row.id, word: row.word, pinyinKey: row.pinyin_key },
    };
  }

  const rows = db
    .prepare('SELECT id, word, pinyin_key FROM term WHERE word = ?')
    .all(op.word.trim()) as Array<{ id: string; word: string; pinyin_key: string }>;

  if (rows.length === 0) {
    return {
      ok: false,
      error: { code: 'term_not_found', message: `term not found for word: ${op.word}` },
    };
  }
  if (rows.length > 1) {
    return {
      ok: false,
      error: {
        code: 'ambiguous_term_word',
        message: `ambiguous word=${op.word} (${rows.length} terms); use term_id`,
      },
    };
  }

  const row = rows[0];
  return {
    ok: true,
    ref: { termId: row.id, word: row.word, pinyinKey: row.pinyin_key },
  };
}
