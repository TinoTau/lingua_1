#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultRegistryPath, defaultSeedPath, resolveInputFiles } from './lib/paths.mjs';
import { validateSeedFiles } from './lib/validate-seed.mjs';

const args = parseCliArgs(process.argv);
const input = args.input ?? defaultSeedPath();
const registry = args.registry ?? defaultRegistryPath();
const reportPath =
  args.report ?? path.join(path.dirname(path.resolve(input)), 'validation-report.json');

const inputFiles = resolveInputFiles(input);
const result = validateSeedFiles({ inputFiles, registryPath: registry, strict: args.strict });

fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(JSON.stringify(result, null, 2));
console.log(`[lexicon:validate] report → ${reportPath}`);

if (!result.ok) {
  process.exit(1);
}
