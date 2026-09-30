/**
 * Window-local Tone binding + pre-edge Model2 insertion — architecture freeze tests.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

const ORCH = path.join(__dirname, 'span-assembly-v4-orchestrator.ts');
const LATTICE = path.join(__dirname, 'lattice-fine-span-runtime.ts');
const EXPAND = path.join(
  __dirname,
  '..',
  '..',
  'model2-runtime',
  'expand-windows-with-model2.ts'
);

describe('Window-local Tone + pre-edge Model2 insertion (SSOT restore)', () => {
  it('orchestrator does not share first FineSpan tone across path', () => {
    const src = fs.readFileSync(ORCH, 'utf8');
    expect(src).not.toMatch(
      /\.find\(\(p\): p is number\[\] => Array\.isArray\(p\) && p\.length > 0\)/
    );
    expect(src).not.toMatch(/acousticTonePattern:\s*tonePat/);
    expect(src).not.toMatch(/expandActiveCandidatesWithModel2/);
  });

  it('orchestrator uses pre-edge lattice Model2 and does not post-PathFineSpan expand', () => {
    const src = fs.readFileSync(ORCH, 'utf8');
    expect(src).toMatch(/runLatticeFineSpanGenerationWithPreEdgeModel2/);
    expect(src).toMatch(/AUG12_PRE_LEXICAL_EDGE|pre-LexicalEdge/);
    expect(src).toMatch(/Do not re-invoke Model2/);
  });

  it('lattice wires Model2 after Base Recall before LexicalEdge', () => {
    const src = fs.readFileSync(LATTICE, 'utf8');
    expect(src).toMatch(/expandWindowsWithModel2/);
    expect(src).toMatch(/PRE_LEXICAL_EDGE|before buildLexicalEdges/);
    expect(src).toMatch(/runLatticeFineSpanGenerationWithPreEdgeModel2/);
  });

  it('expand uses window-local extractAcousticTonePatternForRecall; no PathFineSpan toneRebindTrace', () => {
    const src = fs.readFileSync(EXPAND, 'utf8');
    expect(src).toMatch(/extractAcousticTonePatternForRecall/);
    expect(src).toMatch(/WINDOW_LOCAL/);
    expect(src).toMatch(/tone_pattern_source/);
    expect(src).not.toMatch(/toneRebindTrace/);
    expect(src).not.toMatch(/import type \{ PathFineSpan \}/);
    expect(src).not.toMatch(/pathFineSpans/);
  });

  it('old expand-active-candidates production file is deleted', () => {
    const old = path.join(
      __dirname,
      '..',
      '..',
      'model2-runtime',
      'expand-active-candidates.ts'
    );
    expect(fs.existsSync(old)).toBe(false);
  });
});
