/**
 * pinyin-ime-v2 module boundary — static freeze checks (V1.1 §八).
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

const V2_ROOT = path.resolve(__dirname);

function readV2(relativePath: string): string {
  return fs.readFileSync(path.join(V2_ROOT, relativePath), 'utf8');
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('pinyin-ime-v2 freeze boundaries', () => {
  it('module files do not assign segmentForJobResult', () => {
    for (const file of listTsFiles(V2_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/segmentForJobResult\s*=/);
    }
  });

  it('module files do not import applyFwSpanReplacements', () => {
    for (const file of listTsFiles(V2_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toContain('applyFwSpanReplacements');
      expect(src).not.toContain('apply-span-replacements');
    }
  });

  it('module files do not reference tests/spike or pinyin-ime-v1', () => {
    for (const file of listTsFiles(V2_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toContain('tests/spike');
      expect(src).not.toContain('pinyin-ime-v1');
    }
  });

  it('directRepair is hard-coded false in config loader', () => {
    const cfg = readV2('pinyin-ime-v2-config.ts');
    expect(cfg).toContain('directRepair: false');
  });

  it('decoder emits token path on candidates (Phase 4A)', () => {
    const decoder = readV2('pinyin-ime-v2-decoder.ts');
    expect(decoder).toContain('tokens: state.tokens');
    expect(decoder).not.toContain('backpointer');
  });

  it('dict entry source is union type not string', () => {
    const types = readV2('pinyin-ime-v2-types.ts');
    expect(types).toContain('PinyinImeV2DictEntrySource');
    expect(types).toContain("'fallback'");
  });

  it('alignment normalize uses opencc t2cn only, not business text writers', () => {
    const norm = readV2('normalize-for-ime-alignment.ts');
    expect(norm).toContain('opencc-js/t2cn');
    expect(norm).toContain("from: 't', to: 'cn'");
    expect(norm).not.toMatch(/segmentForJobResult\s*=/);
  });

  it('boundary align is diagnostics-only (Phase 4C)', () => {
    const align = readV2('pinyin-ime-v2-boundary-align.ts');
    expect(align).toContain('BoundaryAlignmentScore');
    expect(align).not.toMatch(/candidates\s*=\s*candidates\.filter/);
    expect(align).not.toMatch(/segmentForJobResult\s*=/);
    expect(align).not.toContain('runPinyinImeV2HintGate');
  });

  it('boundary topk diff is sole V2.0 boundary span source (Phase 4D)', () => {
    const diff = readV2('pinyin-ime-v2-boundary-compatible-topk-diff.ts');
    const proposal = readV2('run-pinyin-ime-v2-span-proposal.ts');
    const gate = readV2('pinyin-ime-v2-hint-gate.ts');
    expect(diff).toContain('buildBoundaryCompatibleTopKDiff');
    expect(proposal).toContain('buildBoundaryCompatibleTopKDiff');
    expect(proposal).toContain('boundaryCompatibleTopKSpans');
    expect(gate).toContain('ime_v2_boundary_topk_diff');
    expect(gate).not.toMatch(/candidates\s*=\s*candidates\.filter/);
  });

  it('hint gate does not output replacement candidate text fields', () => {
    const gate = readV2('pinyin-ime-v2-hint-gate.ts');
    expect(gate).not.toContain('candidateText');
    expect(gate).not.toMatch(/replacementText|FwApprovedReplacement/);
  });
});
