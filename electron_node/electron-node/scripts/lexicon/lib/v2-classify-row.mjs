/**
 * Lexicon V2 shadow build — row tier classification (single responsibility).
 */

import { hasCjk, isMixedLatinToken } from './normalize.mjs';
import { normalizeDomains, loadDomainRegistry } from './domain-registry.mjs';
import { parseSeedRow } from './parse-rows.mjs';
import { resolvePinyinKey } from './v2-pinyin-key.mjs';

const CJK_CHAR_LEN = (word) => [...word.trim()].length;

function parseDomains(parsed, registry) {
  return normalizeDomains(parsed.domains, parsed.domain, registry);
}

function layerFromRow(row) {
  const layer = row?.lexiconLayer ?? row?.lexicon_layer;
  return typeof layer === 'string' ? layer.trim().toLowerCase() : '';
}

function tagsIncludeIdiom(tags) {
  if (!Array.isArray(tags)) {
    return false;
  }
  return tags.some((t) => String(t).toLowerCase() === 'idiom');
}

function reject(code, message, extra = {}) {
  return { tier: 'reject', rejectCode: code, rejectMessage: message, ...extra };
}

function accept(tier, extra = {}) {
  return { tier, rejectCode: null, rejectMessage: null, ...extra };
}

/**
 * @returns {{ tier: 'base'|'idiom'|'domain'|'reject', rejectCode?: string, rejectMessage?: string, domainIds?: string[], pinyinKey?: string }}
 */
export function classifyLexiconV2Row(entry, registry) {
  const parsed = parseSeedRow(entry);
  if (parsed.kind === 'invalid') {
    return reject('invalid_json', parsed.parseError ?? 'invalid row');
  }
  if (parsed.kind === 'confusion') {
    return reject('confusion_row', 'confusion rows are not allowed in V2 shadow build');
  }
  if (!parsed.enabled) {
    return reject('disabled', 'row disabled');
  }

  const word = parsed.word?.trim();
  if (!word) {
    return reject('empty_word', 'word is required');
  }

  if (isMixedLatinToken(word)) {
    return reject('latin_deferred_v1', 'latin token deferred to V1 exactIndex');
  }
  if (!hasCjk(word)) {
    return reject('non_cjk', 'V2 shadow build only accepts CJK canonical rows');
  }

  const charLen = CJK_CHAR_LEN(word);
  const domainResult = parseDomains(parsed, registry);
  if (!domainResult.ok) {
    return reject(domainResult.code ?? 'unknown_domain', `invalid domain: ${domainResult.domain}`);
  }

  const pinyinKey = resolvePinyinKey({ word, pinyinField: parsed.pinyin });
  if (!pinyinKey) {
    return reject('missing_pinyin_key', 'unable to derive pinyin_key');
  }

  const layer = layerFromRow(entry.row);
  if (layer === 'common5') {
    return reject('common5_deferred', 'common5 tier deferred pending DEC-1');
  }

  if (layer === 'base') {
    if (charLen < 2 || charLen > 3) {
      return reject('base_len_invalid', `base layer requires 2-3 chars, got ${charLen}`);
    }
    return accept('base', { pinyinKey, domainIds: [] });
  }

  if (layer === 'idiom') {
    if (charLen !== 4) {
      return reject('idiom_len_invalid', `idiom layer requires 4 chars, got ${charLen}`);
    }
    return accept('idiom', { pinyinKey, domainIds: [] });
  }

  if (layer === 'domain_patch' || layer === 'domain') {
    const domainIds = domainResult.domains.filter((d) => d !== 'general');
    if (!domainIds.length) {
      return reject('domain_missing_id', 'domain layer requires non-general domain_id');
    }
    if (charLen < 2 || charLen > 5) {
      return reject('domain_len_invalid', `domain layer requires 2-5 chars, got ${charLen}`);
    }
    return accept('domain', { pinyinKey, domainIds });
  }

  if (charLen === 1) {
    return reject('one_char', '1-char words are not allowed');
  }
  if (charLen >= 5) {
    return reject('phrase_too_long', '5+ char phrases are not allowed in V2 tiers');
  }

  if (charLen === 4) {
    if (tagsIncludeIdiom(entry.row?.tags)) {
      return accept('idiom', { pinyinKey, domainIds: [] });
    }
    const domainIds = domainResult.domains.filter((d) => d !== 'general');
    if (domainIds.length) {
      return accept('domain', { pinyinKey, domainIds });
    }
    return reject('four_char_non_idiom', '4-char row without idiom tag or domain');
  }

  if (charLen === 2 || charLen === 3) {
    const domainIds = domainResult.domains.filter((d) => d !== 'general');
    if (domainIds.length) {
      return accept('domain', { pinyinKey, domainIds });
    }
    return accept('base', { pinyinKey, domainIds: [] });
  }

  return reject('unclassified', `unable to classify word length ${charLen}`);
}

export function loadRegistry(registryPath) {
  return loadDomainRegistry(registryPath);
}
