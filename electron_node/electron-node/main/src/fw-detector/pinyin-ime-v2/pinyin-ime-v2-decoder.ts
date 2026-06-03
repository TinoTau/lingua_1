import type {
  PinyinImeV2Candidate,
  PinyinImeV2DecodeDiagnostics,
  PinyinImeV2Dict,
  PinyinImeV2DictEntry,
  PinyinImeV2Token,
} from './pinyin-ime-v2-types';
import { FALLBACK_SCORE_FACTOR } from './pinyin-ime-v2-single-char-roles';

const BEAM_WIDTH = 48;

type BeamState = {
  pos: number;
  text: string;
  score: number;
  tokens: PinyinImeV2Token[];
};

function emptyDiagnostics(): PinyinImeV2DecodeDiagnostics {
  return {
    singleCharUsedCount: 0,
    functionSingleCharUsedCount: 0,
    contentFallbackUsedCount: 0,
    fallbackTriggeredCount: 0,
    beamBreakRecoveredCount: 0,
    decodeMs: 0,
    tokenPathAvailableCount: 0,
    candidateTokenCount: 0,
    collapsedPathByTextCount: 0,
  };
}

function trackSingleCharUse(
  diagnostics: PinyinImeV2DecodeDiagnostics,
  entry: PinyinImeV2DictEntry,
  isFallbackPath: boolean
): void {
  if (!entry.isSingleChar) {
    return;
  }
  diagnostics.singleCharUsedCount++;
  if (entry.singleCharRole === 'function_single_char') {
    diagnostics.functionSingleCharUsedCount++;
  }
  if (isFallbackPath) {
    diagnostics.contentFallbackUsedCount++;
  }
}

function syllableMatch(syllables: string[], pos: number, entry: PinyinImeV2DictEntry): boolean {
  const len = entry.syllables.length;
  if (pos + len > syllables.length) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    if (syllables[pos + i] !== entry.syllables[i]) {
      return false;
    }
  }
  return true;
}

function extendState(
  state: BeamState,
  entry: PinyinImeV2DictEntry,
  scoreDelta: number,
  diagnostics: PinyinImeV2DecodeDiagnostics,
  isFallbackPath: boolean
): BeamState {
  trackSingleCharUse(diagnostics, entry, isFallbackPath);
  const syllableStart = state.pos;
  const syllableEnd = state.pos + entry.syllables.length;
  const token: PinyinImeV2Token = {
    word: entry.word,
    syllableStart,
    syllableEnd,
    source: entry.source,
  };
  return {
    pos: syllableEnd,
    text: state.text + entry.word,
    score: state.score + scoreDelta,
    tokens: [...state.tokens, token],
  };
}

function finalizeDecodeDiagnostics(
  diagnostics: PinyinImeV2DecodeDiagnostics,
  candidates: PinyinImeV2Candidate[]
): void {
  let tokenPathAvailableCount = 0;
  let candidateTokenCount = 0;
  for (const candidate of candidates) {
    const n = candidate.tokens?.length ?? 0;
    if (n > 0) {
      tokenPathAvailableCount++;
      candidateTokenCount += n;
    }
  }
  diagnostics.tokenPathAvailableCount = tokenPathAvailableCount;
  diagnostics.candidateTokenCount = candidateTokenCount;
}

export function decodeSyllablesTopK(
  syllables: string[],
  dict: PinyinImeV2Dict,
  topK: number
): { candidates: PinyinImeV2Candidate[]; diagnostics: PinyinImeV2DecodeDiagnostics } {
  const startMs = Date.now();
  const diagnostics = emptyDiagnostics();

  if (!syllables.length) {
    diagnostics.decodeMs = Date.now() - startMs;
    return { candidates: [], diagnostics };
  }

  let beam: BeamState[] = [{ pos: 0, text: '', score: 0, tokens: [] }];

  while (beam.length > 0 && beam[0].pos < syllables.length) {
    const next: BeamState[] = [];

    for (const state of beam) {
      const pos = state.pos;
      const first = syllables[pos];
      const candidates = dict.byFirst.get(first) ?? [];
      for (const entry of candidates) {
        if (!syllableMatch(syllables, pos, entry)) {
          continue;
        }
        next.push(extendState(state, entry, entry.prior, diagnostics, false));
      }
    }

    if (next.length === 0 && dict.byFirstFallback.size > 0) {
      diagnostics.fallbackTriggeredCount++;
      for (const state of beam) {
        const pos = state.pos;
        const first = syllables[pos];
        const fallbackCandidates = dict.byFirstFallback.get(first) ?? [];
        for (const entry of fallbackCandidates) {
          if (!syllableMatch(syllables, pos, entry)) {
            continue;
          }
          const scoreDelta = entry.prior * FALLBACK_SCORE_FACTOR;
          next.push(extendState(state, entry, scoreDelta, diagnostics, true));
          diagnostics.beamBreakRecoveredCount++;
        }
      }
    }

    if (next.length === 0) {
      break;
    }

    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, BEAM_WIDTH);
  }

  const finished = beam.filter((s) => s.pos === syllables.length);
  const seen = new Set<string>();
  const out: PinyinImeV2Candidate[] = [];
  for (const state of finished.sort((a, b) => b.score - a.score)) {
    if (seen.has(state.text)) {
      diagnostics.collapsedPathByTextCount++;
      continue;
    }
    seen.add(state.text);
    out.push({
      text: state.text,
      score: state.score,
      rank: out.length + 1,
      tokens: state.tokens,
    });
    if (out.length >= topK) {
      break;
    }
  }

  diagnostics.decodeMs = Date.now() - startMs;
  finalizeDecodeDiagnostics(diagnostics, out);
  return { candidates: out, diagnostics };
}

export function decodeRawTextTopK(
  syllables: string[],
  dict: PinyinImeV2Dict,
  topK: number
): { candidates: PinyinImeV2Candidate[]; diagnostics: PinyinImeV2DecodeDiagnostics } {
  if (!syllables.length) {
    const diagnostics = emptyDiagnostics();
    return { candidates: [], diagnostics };
  }
  return decodeSyllablesTopK(syllables, dict, topK);
}
