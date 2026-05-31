/**
 * Build LexiconSessionIntent SSOT from CPU LLM decision (Phase 2).
 */

import { textToSyllables } from '../lexicon/phonetic/pinyin';
import { syllablesKey } from '../lexicon/pinyin-index';
import type {
  LexiconProfileDecision,
  LexiconSessionIntent,
  LexiconSessionIntentSource,
} from '../session-runtime/types';

export const MAX_TOPIC_KEYWORDS = 8;
const CJK_CHAR_RE = /[\u4e00-\u9fff]/;

function isCjkKeyword(text: string): boolean {
  if (!text || text.length > 8) {
    return false;
  }
  for (const ch of text) {
    if (!CJK_CHAR_RE.test(ch)) {
      return false;
    }
  }
  return true;
}

export function normalizeTopicKeywords(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const keyword = item.trim();
    if (!keyword || !isCjkKeyword(keyword) || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= MAX_TOPIC_KEYWORDS) {
      break;
    }
  }
  return out;
}

export function computeTopicKeywordPinyinKeys(keywords: readonly string[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const syllables = textToSyllables(keyword);
    if (!syllables.length) {
      continue;
    }
    const key = syllablesKey(syllables);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function cloneLexiconSessionIntent(intent: LexiconSessionIntent): LexiconSessionIntent {
  return {
    ...intent,
    topicKeywords: [...intent.topicKeywords],
    topicKeywordPinyinKeys: [...intent.topicKeywordPinyinKeys],
    secondaryDomains: [...intent.secondaryDomains],
    reason: [...intent.reason],
  };
}

export function buildLexiconSessionIntentFromDecision(
  decision: LexiconProfileDecision,
  source: LexiconSessionIntentSource = 'cpu_llm'
): LexiconSessionIntent {
  const topicKeywords = normalizeTopicKeywords(decision.topicKeywords);
  return {
    summary: decision.summary,
    topicKeywords,
    topicKeywordPinyinKeys: computeTopicKeywordPinyinKeys(topicKeywords),
    primaryDomain: decision.primaryDomain,
    secondaryDomains: [...decision.secondaryDomains],
    confidence: decision.confidence,
    updatedAt: Date.now(),
    effectiveFromTurn: decision.effectiveFromTurn,
    source,
    reason: [...decision.reason],
  };
}
