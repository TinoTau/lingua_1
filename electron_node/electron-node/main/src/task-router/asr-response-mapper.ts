/**
 * Map CTC /utterance HTTP JSON → n-best & KenLM evidence (passthrough only).
 *
 * Frozen CTC schema (Recover V2): `text`, `nbest[]` with `text|score|logit_score|lm_score`;
 * aliases `nbest_list` / `hypotheses`. `meta.decode_ms` is timing only — not Sentence KenLM.
 * `asr lm_score` ≠ sentence `kenlmScore` in rerank.
 */

import { AsrKenlmMeta, AsrNBestItem } from './asr-evidence-types';

export type CtcUtteranceEvidence = {
  nbest?: AsrNBestItem[];
  kenlmMeta?: AsrKenlmMeta;
};

const KENLM_FIELD_KEYS = [
  'kenlm_available',
  'kenlm_called_count',
  'kenlm_veto_count',
  'kenlm_vote_boost_count',
  'kenlm_decision',
  'lm_score_raw',
  'lm_score_candidate',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function mapNbestList(rawList: unknown): AsrNBestItem[] | undefined {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return undefined;
  }
  const items: AsrNBestItem[] = [];
  for (let rank = 0; rank < rawList.length; rank++) {
    const item = asRecord(rawList[rank]);
    if (!item) {
      continue;
    }
    const text = readString(item.text);
    if (text === undefined) {
      continue;
    }
    const score = readNumber(item.score);
    const logitScore = readNumber(item.logit_score);
    const lmScore = readNumber(item.lm_score);
    const mapped: AsrNBestItem = {
      rank: items.length,
      text,
      raw: item,
    };
    if (score !== undefined) {
      mapped.score = score;
      mapped.totalScore = score;
    }
    if (logitScore !== undefined) {
      mapped.acousticScore = logitScore;
    }
    if (lmScore !== undefined) {
      mapped.lmScore = lmScore;
    }
    const kenlmDecision = readString(item.kenlm_decision);
    if (kenlmDecision !== undefined) {
      mapped.kenlmDecision = kenlmDecision;
    }
    items.push(mapped);
  }
  return items.length > 0 ? items : undefined;
}

function hasKenlmKnownFields(obj: Record<string, unknown>): boolean {
  return KENLM_FIELD_KEYS.some((key) => obj[key] !== undefined && obj[key] !== null);
}

function mapKenlmFromObject(obj: Record<string, unknown>): AsrKenlmMeta | undefined {
  if (!hasKenlmKnownFields(obj)) {
    return undefined;
  }
  const meta: AsrKenlmMeta = { raw: obj };
  const available = readBoolean(obj.kenlm_available);
  if (available !== undefined) {
    meta.kenlm_available = available;
  }
  const called = readNumber(obj.kenlm_called_count);
  if (called !== undefined) {
    meta.kenlm_called_count = called;
  }
  const veto = readNumber(obj.kenlm_veto_count);
  if (veto !== undefined) {
    meta.kenlm_veto_count = veto;
  }
  const boost = readNumber(obj.kenlm_vote_boost_count);
  if (boost !== undefined) {
    meta.kenlm_vote_boost_count = boost;
  }
  const decision = readString(obj.kenlm_decision);
  if (decision !== undefined) {
    meta.kenlm_decision = decision;
  }
  const lmRaw = readNumber(obj.lm_score_raw);
  if (lmRaw !== undefined) {
    meta.lm_score_raw = lmRaw;
  }
  const lmCandidate = readNumber(obj.lm_score_candidate);
  if (lmCandidate !== undefined) {
    meta.lm_score_candidate = lmCandidate;
  }
  return meta;
}

function resolveKenlmMeta(data: Record<string, unknown>): AsrKenlmMeta | undefined {
  const sources = [
    data.kenlm,
    data.kenlm_meta,
    data.lm_meta,
    asRecord(data.meta)?.kenlm,
  ];
  for (const source of sources) {
    const obj = asRecord(source);
    if (!obj) {
      continue;
    }
    const mapped = mapKenlmFromObject(obj);
    if (mapped) {
      return mapped;
    }
  }
  return undefined;
}

function resolveNbestList(data: Record<string, unknown>): AsrNBestItem[] | undefined {
  if (Array.isArray(data.nbest)) {
    return mapNbestList(data.nbest);
  }
  if (Array.isArray(data.nbest_list)) {
    return mapNbestList(data.nbest_list);
  }
  if (Array.isArray(data.hypotheses)) {
    return mapNbestList(data.hypotheses);
  }
  if (Array.isArray(data.beams)) {
    return mapNbestList(data.beams);
  }
  return undefined;
}

/**
 * Extract CTC n-best / KenLM evidence from POST /utterance response body.
 * Does not read top-level `text` — caller keeps existing text mapping.
 */
export function mapCtcUtteranceResponse(data: unknown): CtcUtteranceEvidence {
  const record = asRecord(data);
  if (!record) {
    return {};
  }
  const nbest = resolveNbestList(record);
  const kenlmMeta = resolveKenlmMeta(record);
  return {
    ...(nbest ? { nbest } : {}),
    ...(kenlmMeta ? { kenlmMeta } : {}),
  };
}
