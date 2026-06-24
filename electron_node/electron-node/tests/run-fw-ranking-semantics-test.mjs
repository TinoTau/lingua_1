#!/usr/bin/env node
/**
 * Semantic frozen set manifest checker (unit-level; full Dialog200 via batch runner).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'fw-ranking-semantics-frozen.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest) || manifest.length < 2) {
  console.error('fw-ranking-semantics-frozen.json invalid');
  process.exit(1);
}

const required = ['d003', 'd048'];
for (const id of required) {
  const entry = manifest.find((row) => row.id === id);
  if (!entry?.finalMustContain) {
    console.error(`missing semantic entry: ${id}`);
    process.exit(1);
  }
}

console.log(`fw-ranking-semantics-frozen: ${manifest.length} entries OK`);
process.exit(0);
