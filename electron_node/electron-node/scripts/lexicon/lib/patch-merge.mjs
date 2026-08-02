import fs from 'fs';
import path from 'path';
import { resolvePinyin } from './pinyin-complete.mjs';
import { normalizeDomains, loadDomainRegistry } from './domain-registry.mjs';
import { normalizePriorScore } from './prior-score.mjs';
import { validateSeedRows } from './validate-seed.mjs';
import { loadJsonlInputs } from './read-jsonl.mjs';
import { makeError } from './validation-result.mjs';

export function mergePatchReviewBundle({ reviewPath, seedPath, outPath, registryPath }) {
  const review = JSON.parse(fs.readFileSync(path.resolve(reviewPath), 'utf8'));
  const registry = loadDomainRegistry(registryPath);
  const approved = (review.proposals || []).filter((p) => p.operatorDecision === 'approved');
  const seedLines = fs.readFileSync(path.resolve(seedPath), 'utf8').split(/\r?\n/).filter(Boolean);

  const patchId = process.env.PATCH_ID?.trim() || `patch-${Date.now()}`;
  const parentPatchId = process.env.PARENT_PATCH_ID?.trim() || null;
  const errors = [];
  const additions = [];

  for (const p of approved) {
    const word = (p.missingCandidate ?? '').trim();
    if (!word) {
      errors.push(makeError(reviewPath, 0, 'missingCandidate', 'empty_word', 'Patch missing candidate word'));
      continue;
    }

    const domainResult = normalizeDomains([], p.suggestedDomain || 'general', registry);
    if (!domainResult.ok) {
      errors.push(
        makeError(reviewPath, 0, 'suggestedDomain', domainResult.code, `Invalid patch domain: ${p.suggestedDomain}`)
      );
      continue;
    }

    const pinyin = resolvePinyin(word, p.pinyin ?? '');
    if (!pinyin && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(word)) {
      errors.push(
        makeError(reviewPath, 0, 'pinyin', 'empty_pinyin_unresolvable', `Patch pinyin unresolved: ${word}`)
      );
      continue;
    }

    const priorScore = normalizePriorScore(p.priorScore ?? 0.75, 50);
    if (!(priorScore > 0 && priorScore <= 1)) {
      errors.push(makeError(reviewPath, 0, 'priorScore', 'invalid_priorScore', 'Patch priorScore invalid'));
      continue;
    }

    additions.push(
      JSON.stringify({
        type: 'canonical_term',
        termId: `patch-${p.reviewId}`,
        word,
        replacement: word,
        term: word,
        pinyin,
        domains: domainResult.domains,
        priorScore,
        source: 'replay_patch',
        enabled: true,
        tags: ['patch_review'],
        note: p.operatorNote || '',
        patchLineage: {
          patchId,
          parentPatchId,
          introducedTerms: [word],
          replayBatchId: review.replayBatchId || null,
        },
      })
    );
  }

  if (errors.length) {
    return { ok: false, errors, additions: [] };
  }

  const merged = [...seedLines, ...additions];
  fs.writeFileSync(path.resolve(outPath), merged.join('\n') + '\n', 'utf8');
  const summary = {
    patchId,
    parentPatchId,
    replayBatchId: review.replayBatchId || null,
    approvedCount: additions.length,
    introducedTerms: approved.map((p) => p.missingCandidate),
  };
  fs.writeFileSync(
    path.resolve(outPath.replace(/\.jsonl$/i, '.patch-lineage.json')),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  const { rows } = loadJsonlInputs([path.resolve(outPath)]);
  const validation = validateSeedRows({ rows, registry, strict: true });
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, validation };
  }

  return { ok: true, approvedCount: additions.length, outPath: path.resolve(outPath), validation };
}
