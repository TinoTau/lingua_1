#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir } from './lib/paths.mjs';
import { parseChecksum, verifyChecksumFile } from './lib/checksum.mjs';

const args = parseCliArgs(process.argv);
const bundleDir = args.bundle ?? args.input ?? defaultBundleDir();
const manifestPath = path.join(bundleDir, 'manifest.json');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const checksumPath = path.join(bundleDir, 'checksum.txt');

if (!fs.existsSync(manifestPath) || !fs.existsSync(sqlitePath)) {
  console.error('[lexicon:report] bundle missing manifest or sqlite');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
verifyChecksumFile(sqlitePath, manifest.checksum, checksumPath);

const report = {
  ok: true,
  bundleDir: path.resolve(bundleDir),
  schemaVersion: manifest.schemaVersion,
  prior_score_scale: manifest.prior_score_scale,
  lexiconCount: manifest.lexiconCount ?? manifest.term_count,
  enabledCount: manifest.enabledCount ?? manifest.enabled_term_count,
  pinyinIndexCount: manifest.pinyinIndexCount ?? manifest.pinyin_index_count,
  exactIndexCount: manifest.exactIndexCount ?? 0,
  aliasIndexCount: manifest.aliasIndexCount ?? 0,
  domainDistribution: manifest.domainDistribution ?? {},
  priorScoreDistribution: manifest.priorScoreDistribution ?? manifest.priorScoreCalibration,
  checksum: manifest.checksum,
  checksumHex: parseChecksum(manifest.checksum),
};

const outPath = args.output ?? path.join(bundleDir, 'bundle-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(JSON.stringify(report, null, 2));
console.log(`[lexicon:report] → ${outPath}`);
