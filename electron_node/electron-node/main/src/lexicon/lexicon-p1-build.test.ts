import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const pilotSeed = path.resolve(__dirname, '../../../data/lexicon/pilot/p1_acceptance_seed.jsonl');
const buildScript = path.resolve(__dirname, '../../../scripts/lexicon/build-lexicon-bundle.mjs');
const patchScript = path.resolve(__dirname, '../../../scripts/lexicon/patch-merge.mjs');
const registryPath = path.resolve(__dirname, '../../../data/lexicon/profile-registry.json');

describe('lexicon P1 build CLI', () => {
  it('builds pilot seed with domains merge, exact/alias index, priorScoreByDomain', () => {
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-p1-'));
    const result = spawnSync(
      process.execPath,
      [buildScript, '--input', pilotSeed, '--output', bundleDir, '--registry', registryPath],
      { encoding: 'utf-8' }
    );
    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf-8'));
    expect(manifest.aliasIndexCount).toBeGreaterThan(0);
    expect(manifest.exactIndexCount).toBeGreaterThan(0);
    expect(manifest.priorScoreByDomain?.tech_ai?.count).toBe(1);
    expect(manifest.domainDistribution?.transport).toBe(1);
    expect(manifest.domainDistribution?.travel).toBe(1);
    fs.rmSync(bundleDir, { recursive: true, force: true });
  });

  it('writes patch lineage summary on approved merge', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-patch-'));
    const seedPath = path.join(dir, 'seed.jsonl');
    fs.writeFileSync(
      seedPath,
      `${JSON.stringify({
        type: 'canonical_term',
        word: '基线',
        pinyin: 'ji xian',
        domains: ['general'],
        priorScore: 0.5,
        source: 'test',
        enabled: true,
      })}\n`,
      'utf-8'
    );
    const reviewPath = path.join(dir, 'review.json');
    fs.writeFileSync(
      reviewPath,
      JSON.stringify({
        replayBatchId: 'batch-p1',
        proposals: [
          {
            reviewId: 'r1',
            missingCandidate: '补丁词',
            suggestedDomain: 'travel',
            priorScore: 0.7,
            operatorDecision: 'approved',
          },
        ],
      }),
      'utf-8'
    );
    const outPath = path.join(dir, 'merged.jsonl');
    const result = spawnSync(
      process.execPath,
      [patchScript, '--patches', reviewPath, '--seed', seedPath, '--output', outPath, '--registry', registryPath],
      { encoding: 'utf-8', env: { ...process.env, PATCH_ID: 'patch-p1-test' } }
    );
    expect(result.status).toBe(0);
    const lineage = JSON.parse(fs.readFileSync(outPath.replace(/\.jsonl$/i, '.patch-lineage.json'), 'utf-8'));
    expect(lineage.patchId).toBe('patch-p1-test');
    expect(lineage.replayBatchId).toBe('batch-p1');
    expect(lineage.approvedCount).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
