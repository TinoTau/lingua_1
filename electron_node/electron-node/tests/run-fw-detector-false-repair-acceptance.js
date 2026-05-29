#!/usr/bin/env node
/**
 * false_repair_golden — mock pipeline, weak_veto + KenLM on; must not change text.
 */
const fs = require('fs');
const path = require('path');

const JSONL_PATH = path.resolve(__dirname, '../../lexicon-assets/tests/false_repair_golden.jsonl');

function getPort() {
  const cfgPath = path.join(process.env.APPDATA || '', 'lingua-electron-node', 'electron-node-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.testServer?.port) return cfg.testServer.port;
    } catch (_) {}
  }
  return 5020;
}

async function waitHealth(port, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function readJsonl(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  return lines.map((l) => JSON.parse(l));
}

async function runCase(port, row) {
  const res = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asrText: row.raw,
      srcLang: 'zh',
      enableKenLMGate: true,
      kenlmGateMode: 'weak_veto',
      kenlmVetoThreshold: -0.2,
      session_id: `fw-fr-${row.id || 'case'}-${Date.now()}`,
      utterance_index: 0,
      is_manual_cut: true,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  if (!fs.existsSync(JSONL_PATH)) {
    console.error('Missing jsonl:', JSONL_PATH);
    process.exit(1);
  }
  const port = getPort();
  if (!(await waitHealth(port))) {
    console.error('[FW-FR] Test server not ready.');
    process.exit(1);
  }

  const rows = readJsonl(JSONL_PATH);
  let pass = 0;
  let fail = 0;
  for (const row of rows) {
    const id = row.id || 'unknown';
    try {
      const data = await runCase(port, row);
      const text = (data.text_asr || '').trim();
      const raw = (data.extra?.raw_asr_text || row.raw || '').trim();
      const applied = data.extra?.fw_detector?.summary?.appliedCount ?? 0;
      const ok = row.shouldRepair === false && text === raw && applied === 0;
      if (ok) {
        pass += 1;
        console.log(`[${id}] PASS no_apply`);
      } else {
        fail += 1;
        console.log(`[${id}] FAIL`, { text, raw, applied });
      }
    } catch (e) {
      fail += 1;
      console.log(`[${id}] ERROR`, e.message);
    }
  }
  console.log('\n[FW-FR] Summary', { total: rows.length, pass, fail });
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
