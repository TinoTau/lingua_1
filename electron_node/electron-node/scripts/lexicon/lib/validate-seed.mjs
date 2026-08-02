import { MAX_WORD_LEN, RECALL_PREFERRED_MAX } from './constants.mjs';
import { loadDomainRegistry, normalizeDomains } from './domain-registry.mjs';
import { hasCjk, isMixedLatinToken, normalizePinyin, normalizeWord, tokenCount } from './normalize.mjs';
import { isValidPriorScore, normalizePriorScore, frequencyFromPriority } from './prior-score.mjs';
import { resolvePinyin } from './pinyin-complete.mjs';
import { parseSeedRow } from './parse-rows.mjs';
import { validateProvenanceFields } from './provenance.mjs';
import { loadJsonlInputs } from './read-jsonl.mjs';
import { makeError, makeWarning, buildValidationResult } from './validation-result.mjs';
import { normalizeDomainWeightMap, resolveSeedPriorScore, tagsFromParsed } from './seed-domain-tags.mjs';

function validateAlias(alias, word, canonicalWords, file, line) {
  const issues = [];
  if (!alias || !alias.trim()) {
    issues.push(makeError(file, line, 'aliases', 'invalid_alias', 'Empty alias'));
    return issues;
  }
  const trimmed = alias.trim();
  if (trimmed === word) {
    issues.push(makeError(file, line, 'aliases', 'invalid_alias', 'Alias equals canonical word'));
  }
  if (/[\x00-\x1f]/.test(trimmed)) {
    issues.push(makeError(file, line, 'aliases', 'invalid_alias', 'Alias contains control characters'));
  }
  if (canonicalWords.has(trimmed) && trimmed !== word) {
    issues.push(
      makeError(file, line, 'aliases', 'invalid_alias', `Alias conflicts with canonical word: ${trimmed}`)
    );
  }
  return issues;
}

function validateCanonicalRow(parsed, file, line, registry, errors, warnings, canonicalByWord, canonicalWords, strict) {
  const word = parsed.word?.trim();
  if (!word) {
    errors.push(makeError(file, line, 'word', 'empty_word', 'Canonical word is required'));
    return;
  }

  if (!parsed.source?.trim()) {
    errors.push(makeError(file, line, 'source', 'missing_source', 'source is required'));
  }

  const provenance = validateProvenanceFields(parsed, { strict });
  for (const err of provenance.errors) {
    errors.push(makeError(file, line, 'provenance', err.code, err.message, parsed));
  }

  if (word.length > MAX_WORD_LEN) {
    errors.push(makeError(file, line, 'word', 'word_too_long', `Word exceeds build limit ${MAX_WORD_LEN}`));
  }

  const domainResult = normalizeDomains(parsed.domains, parsed.domain, registry);
  if (!domainResult.ok) {
    errors.push(
      makeError(file, line, 'domains', domainResult.code, `Invalid domain: ${domainResult.domain}`, parsed)
    );
    return;
  }

  const tagIds = tagsFromParsed(parsed);
  const weightKeys = Object.keys(parsed.domainWeights ?? {});
  for (const key of weightKeys) {
    if (!tagIds.includes(key)) {
      errors.push(
        makeError(file, line, 'domain_weights', 'weight_key_not_in_tags', `domain_weights key not in domain_tags: ${key}`, parsed)
      );
    }
  }
  normalizeDomainWeightMap(tagIds, parsed.domainWeights ?? {});

  const frequency = parsed.frequency ?? frequencyFromPriority(parsed.priority);
  const priorScore = normalizePriorScore(resolveSeedPriorScore(parsed), frequency);
  if (!isValidPriorScore(priorScore) || priorScore <= 0) {
    errors.push(makeError(file, line, 'priorScore', 'invalid_priorScore', `Invalid priorScore: ${priorScore}`));
  }

  const latin = isMixedLatinToken(word);
  const pinyin = latin ? normalizePinyin(parsed.pinyin) : resolvePinyin(word, parsed.pinyin);
  if (!latin && hasCjk(word) && !pinyin) {
    errors.push(
      makeError(file, line, 'pinyin', 'empty_pinyin_unresolvable', 'CJK canonical requires pinyin or auto-complete')
    );
  }

  for (const alias of parsed.aliases) {
    errors.push(...validateAlias(alias, word, canonicalWords, file, line));
    if (hasCjk(alias) && !resolvePinyin(alias, '')) {
      errors.push(
        makeError(file, line, 'aliases', 'empty_pinyin_unresolvable', `Chinese alias requires pinyin: ${alias}`)
      );
    }
  }

  const tokens = tokenCount(word);
  if (tokens > RECALL_PREFERRED_MAX) {
    warnings.push(
      makeWarning(
        file,
        line,
        'word',
        'unsupported_mixed_language',
        `Term has ${tokens} tokens; Phase A recall not guaranteed`
      )
    );
  } else if (word.length > RECALL_PREFERRED_MAX) {
    warnings.push(
      makeWarning(
        file,
        line,
        'word',
        'long_word',
        `Word length ${word.length} exceeds recall preferred max ${RECALL_PREFERRED_MAX}`
      )
    );
  }

  const existing = canonicalByWord.get(word);
  if (existing) {
    canonicalByWord.set(word, { ...existing, duplicate: true });
  } else {
    canonicalByWord.set(word, { file, line, word, domains: domainResult.domains });
    canonicalWords.add(word);
  }
}

export function validateSeedRows({ rows, registry, strict = false, anyBom = false }) {
  const errors = [];
  const warnings = [];
  const canonicalByWord = new Map();
  const canonicalWords = new Set();
  const aliasToCanonical = new Map();

  if (anyBom) {
    warnings.push(
      makeWarning('', 0, 'file', 'utf8_bom_detected', 'Input contained UTF-8 BOM; build will strip BOM')
    );
  }

  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    const file = entry.file;
    const line = entry.line;

    if (parsed.kind === 'invalid') {
      errors.push(makeError(file, line, 'json', 'invalid_json', parsed.parseError, entry.raw));
      continue;
    }

    if (parsed.kind === 'confusion') {
      errors.push(
        makeError(
          file,
          line,
          'type',
          'confusion_row_rejected',
          'Confusion rows are not allowed in production seed (canonical-only)'
        )
      );
      continue;
    }

    validateCanonicalRow(parsed, file, line, registry, errors, warnings, canonicalByWord, canonicalWords, strict);

    const word = parsed.word?.trim();
    if (!word) {
      continue;
    }
    for (const alias of parsed.aliases) {
      const trimmed = alias?.trim();
      if (!trimmed) {
        continue;
      }
      const existing = aliasToCanonical.get(trimmed);
      if (existing && existing !== word) {
        errors.push(
          makeError(
            file,
            line,
            'aliases',
            'alias_collision',
            `Alias "${trimmed}" maps to both "${existing}" and "${word}"`
          )
        );
      } else {
        aliasToCanonical.set(trimmed, word);
      }
    }
  }

  for (const item of canonicalByWord.values()) {
    if (item.duplicate) {
      warnings.push(
        makeWarning(item.file, item.line, 'word', 'duplicate_merge', `Duplicate word/domains will merge: ${item.word}`)
      );
    }
  }

  return buildValidationResult({
    inputFiles: [...new Set(rows.map((r) => r.file))],
    rows,
    errors,
    warnings,
    strict,
  });
}

export function validateSeedFiles({ inputFiles, registryPath, strict = false }) {
  const registry = loadDomainRegistry(registryPath);
  const { rows, anyBom } = loadJsonlInputs(inputFiles);
  return validateSeedRows({ rows, registry, strict, anyBom });
}
