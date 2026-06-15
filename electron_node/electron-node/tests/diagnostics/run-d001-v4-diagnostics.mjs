#!/usr/bin/env node
/**
 * Export d001 V4 diagnostics trace via orchestrator (offline probe).
 * Usage: node tests/diagnostics/run-d001-v4-diagnostics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname);
const OUT_FILE = path.join(OUT_DIR, 'd001-v4-trace.json');

console.log(
  JSON.stringify(
    {
      note: 'Run Jest integration or batch with spanAssemblyV4DiagnosticsEnabled=true, level=trace, targetIds=[d001].',
      patch: 'node tests/patch-span-assembly-v4-config.mjs true trace',
      output: OUT_FILE,
      fields: [
        'coarseSpans',
        'boundaryWindows',
        'truncatedWindows',
        'skippedRecallWindows',
        'recallHitsPreFilter',
        'recallHits',
        'poolBeforeDrop',
        'poolAfterDrop',
        'compatibilityEdges',
        'emittedParentEvidence',
        'emittedEdges',
        'emittedParentSpanCandidates',
        'graphEdgesAfterMerge',
        'coarsePaths',
        'beamSpanSets',
        'sentenceCandidates',
        'candidateLifecycle',
        'sentenceRerank.allCombinations',
      ],
    },
    null,
    2
  )
);
