#!/usr/bin/env node
/**
 * Lexicon V3 — canonical source manager (offline asset governance).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultRegistryPath, defaultSeedPath, resolveInputFiles } from './lib/paths.mjs';
import { loadDomainRegistry } from './lib/domain-registry.mjs';
import { loadJsonlInputs } from './lib/read-jsonl.mjs';
import { parseSeedRow } from './lib/parse-rows.mjs';
import { validateSeedFiles } from './lib/validate-seed.mjs';
import { provenanceReport, validateProvenanceFields } from './lib/provenance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function domainBalance(rows, registry) {
  const counts = {};
  for (const domain of Object.keys(registry.domains ?? {})) {
    counts[domain] = 0;
  }
  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    if (parsed.kind !== 'canonical' || !parsed.enabled) {
      continue;
    }
    for (const domain of parsed.domains ?? (parsed.domain ? [parsed.domain] : [])) {
      counts[domain] = (counts[domain] ?? 0) + 1;
    }
  }
  return counts;
}

function aliasCollisionScan(rows) {
  const aliasToCanonical = new Map();
  const collisions = [];
  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    if (parsed.kind !== 'canonical') {
      continue;
    }
    const word = parsed.word?.trim();
    if (!word) {
      continue;
    }
    for (const alias of parsed.aliases ?? []) {
      const trimmed = alias?.trim();
      if (!trimmed) {
        continue;
      }
      const existing = aliasToCanonical.get(trimmed);
      if (existing && existing !== word) {
        collisions.push({ alias: trimmed, canonicalA: existing, canonicalB: word, file: entry.file, line: entry.line });
      } else {
        aliasToCanonical.set(trimmed, word);
      }
    }
  }
  return collisions;
}

function duplicateWordScan(rows) {
  const byWord = new Map();
  const duplicates = [];
  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    if (parsed.kind !== 'canonical') {
      continue;
    }
    const word = parsed.word?.trim();
    if (!word) {
      continue;
    }
    const prev = byWord.get(word);
    if (prev) {
      duplicates.push({ word, first: prev, second: { file: entry.file, line: entry.line } });
    } else {
      byWord.set(word, { file: entry.file, line: entry.line });
    }
  }
  return duplicates;
}

function main() {
  const args = parseCliArgs(process.argv);
  const input = args.input ?? defaultSeedPath();
  const registryPath = args.registry ?? defaultRegistryPath();
  const out = args.report ?? path.join(path.dirname(input), 'canonical-source-manager-report.json');
  const strict = args.strict ?? true;

  const inputFiles = resolveInputFiles(input);
  const registry = loadDomainRegistry(registryPath);
  const { rows } = loadJsonlInputs(inputFiles);

  const validation = validateSeedFiles({ inputFiles, registryPath, strict });
  const canonicalRows = rows
    .map((entry) => ({ entry, parsed: parseSeedRow(entry) }))
    .filter(({ parsed }) => parsed.kind === 'canonical');

  const provenanceErrors = [];
  for (const { entry, parsed } of canonicalRows) {
    const result = validateProvenanceFields(parsed, { strict });
    for (const err of result.errors) {
      provenanceErrors.push({ file: entry.file, line: entry.line, ...err });
    }
  }

  const report = {
    schemaVersion: 'lexicon-v3-source-manager-v1',
    generatedAt: new Date().toISOString(),
    inputFiles,
    validationOk: validation.ok,
    validationErrorCount: validation.errors?.length ?? 0,
    provenanceOk: provenanceErrors.length === 0,
    provenanceErrors,
    duplicateWords: duplicateWordScan(rows),
    aliasCollisions: aliasCollisionScan(rows),
    domainBalance: domainBalance(rows, registry),
    provenance: provenanceReport(canonicalRows.map(({ parsed }) => parsed)),
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf-8');

  console.log('[canonical-source-manager] report →', out);
  console.log('[canonical-source-manager] validationOk=', report.validationOk, 'provenanceOk=', report.provenanceOk);
  console.log('[canonical-source-manager] duplicates=', report.duplicateWords.length, 'aliasCollisions=', report.aliasCollisions.length);

  if (!report.validationOk || !report.provenanceOk) {
    process.exit(1);
  }
}

main();
