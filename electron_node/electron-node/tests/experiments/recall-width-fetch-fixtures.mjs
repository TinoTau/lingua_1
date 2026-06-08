#!/usr/bin/env node
/** EXPERIMENT ONLY — build fixtures via /run-pipeline-with-audio for approved-span case ids */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
const DIALOG = path.join(PROJECT_ROOT, 'test wav/dialog_200');
const PERF = path.join(__dirname, '../fw-detector-dialog-200-phase4e-quality-perf.json');
const MANIFEST = path.join(DIALOG, 'cases.manifest.json');
const OUT = path.join(__dirname, 'recall-width-fixtures.json');

async function waitHealth(port, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  const port = 5020;
  if (!(await waitHealth(port))) {
    console.error('server not ready');
    process.exit(1);
  }
  const perf = JSON.parse(fs.readFileSync(PERF, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
  const targets = new Set(
    (perf.samples?.approvedSpan || [])
      .filter((c) => (c.approvedSpanCount || 0) > 0)
      .map((c) => c.id)
  );
  const fixtures = [];
  for (const c of manifest) {
    if (!targets.has(c.id)) continue;
    const wav = path.join(DIALOG, c.file);
    if (!fs.existsSync(wav)) continue;
    const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wavPath: wav,
        srcLang: 'zh',
        tgtLang: 'en',
        use_lexicon: true,
        is_manual_cut: true,
        session_id: `rw-fix-${c.id}`,
      }),
      signal: AbortSignal.timeout(300000),
    });
    const data = await res.json();
    const fw = data.extra?.fw_detector || {};
    const spans = (fw.spans || [])
      .filter((s) => (s.candidates?.length || 0) > 0 || s.text)
      .map((s) => ({ text: s.text, start: s.start, end: s.end }));
    if (!spans.length) continue;
    fixtures.push({
      id: c.id,
      scenario: c.scenario,
      raw: (data.extra?.raw_asr_text || '').trim(),
      ref: refById[c.id] || '',
      spans,
    });
    console.log('[fixture]', c.id, 'spans', spans.length);
  }
  fs.writeFileSync(OUT, JSON.stringify({ experimentOnly: true, fixtures }, null, 2), 'utf8');
  console.log('[fixture] wrote', OUT, fixtures.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
