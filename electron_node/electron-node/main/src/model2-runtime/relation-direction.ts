/**
 * Phonetic relation direction SSOT — mirrors
 * training/model2/stage_b/phonetic_relation_direction_contract_v1.json
 * and training/model2/stage_b/condition.py OPPOSITE_DIRECTION.
 *
 * X_Y = intended X → observed Y
 * Retrieval reverse: observed Y → intended X via OPPOSITE_DIRECTION[X_Y]
 */

export const OPPOSITE_DIRECTION: Readonly<Record<string, string>> = Object.freeze({
  n_l: 'l_n',
  l_n: 'n_l',
  zh_z: 'z_zh',
  z_zh: 'zh_z',
  ch_c: 'c_ch',
  c_ch: 'ch_c',
  sh_s: 's_sh',
  s_sh: 'sh_s',
  an_ang: 'ang_an',
  ang_an: 'an_ang',
  en_eng: 'eng_en',
  eng_en: 'en_eng',
  in_ing: 'ing_in',
  ing_in: 'in_ing',
  f_h: 'h_f',
  h_f: 'f_h',
});

export const ACTIVE_SET_V1 = Object.freeze([
  'n_l',
  'z_zh',
  'ch_c',
  'sh_s',
  'eng_en',
  'in_ing',
  'h_f',
] as const);

const INITIALS = [
  'zh',
  'ch',
  'sh',
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
  'y',
  'w',
] as const;

export type SyllableParts = {
  raw: string;
  initial: string;
  final: string;
  tone: string;
  base: string;
};

export function stripTone(syl: string): string {
  return (syl || '').toLowerCase().replace(/[^a-z]/g, '');
}

export function parseSyllable(syl: string): SyllableParts | null {
  const s = (syl || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  const m = s.match(/^([a-z]+)([0-5]?)$/);
  if (!m) return null;
  const body = m[1]!;
  const tone = m[2] || '';
  let initial = '';
  let final = body;
  for (const ini of INITIALS) {
    if (body.startsWith(ini) && body.length > ini.length) {
      initial = ini;
      final = body.slice(ini.length);
      break;
    }
    if (body === ini) {
      initial = '';
      final = body;
      break;
    }
  }
  return { raw: s, initial, final, tone, base: body };
}

function applyFamilyToParts(parts: SyllableParts, family: string): SyllableParts | null {
  const bits = family.split('_');
  if (bits.length !== 2) return null;
  const [src, dst] = bits as [string, string];
  const initials = new Set(['n', 'l', 'zh', 'z', 'ch', 'c', 'sh', 's', 'f', 'h']);
  const finals = new Set(['an', 'ang', 'en', 'eng', 'in', 'ing']);
  if (initials.has(src) && initials.has(dst)) {
    if (parts.initial !== src) return null;
    const newBase = dst + parts.final;
    return {
      raw: `${newBase}${parts.tone}`,
      initial: dst,
      final: parts.final,
      tone: parts.tone,
      base: newBase,
    };
  }
  if (finals.has(src) && finals.has(dst)) {
    if (parts.final !== src) return null;
    const newBase = parts.initial + dst;
    return {
      raw: `${newBase}${parts.tone}`,
      initial: parts.initial,
      final: dst,
      tone: parts.tone,
      base: newBase,
    };
  }
  return null;
}

/** Apply family on one syllable; preserve tone in output string. */
export function applyFamilyToSyllable(syl: string, family: string): string | null {
  const parts = parseSyllable(syl);
  if (!parts) return null;
  const out = applyFamilyToParts(parts, family);
  if (!out) return null;
  return out.tone ? `${out.base}${out.tone}` : out.base;
}

/**
 * observed → intended using reverse of user feature X_Y.
 * Output tone-stripped for lexicon pinyin key lookup.
 */
export function hypothesizeIntendedSyllables(
  observed: readonly string[],
  userFeatureXY: string
): { syllables: string[]; nChanged: number } {
  const rev = OPPOSITE_DIRECTION[userFeatureXY];
  if (!rev) {
    return { syllables: observed.map(stripTone), nChanged: 0 };
  }
  let nChanged = 0;
  const out: string[] = [];
  for (const syl of observed) {
    const neu = applyFamilyToSyllable(syl, rev);
    if (neu != null && neu !== syl) {
      out.push(stripTone(neu));
      nChanged += 1;
    } else {
      out.push(stripTone(syl));
    }
  }
  return { syllables: out, nChanged };
}

export function actionIdToRelations(actionId: string): string[] {
  if (actionId === 'identity') return [];
  if (actionId.startsWith('single:')) {
    return [actionId.slice('single:'.length)];
  }
  if (actionId.startsWith('composed:')) {
    const body = actionId.slice('composed:'.length);
    return body.split('>').filter(Boolean);
  }
  return [];
}

/** Apply relation chain (for composed); Stage P skeleton uses singles only. */
export function applyRelationsChain(
  syllables: readonly string[],
  relations: readonly string[]
): string[] {
  let cur = [...syllables];
  for (const rel of relations) {
    const { syllables: next } = hypothesizeIntendedSyllables(cur, rel);
    cur = next;
  }
  return cur;
}
