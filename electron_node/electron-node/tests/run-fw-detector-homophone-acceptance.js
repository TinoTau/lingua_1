#!/usr/bin/env node
/**
 * FW detector homophone acceptance — run via /run-lexicon-mock (no ASR).
 *
 * Goal: verify Detector → Recall → Apply closed loop (appliedCount > 0).
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const fileArg = args[0];
const JSONL_PATH = fileArg
  ? path.resolve(fileArg)
  : path.resolve(__dirname, '../../lexicon-assets/tests/restaurant_homophone.jsonl');

function getPort() {
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
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

function resolveKenlmFields(row) {
  const enableKenLMGate = row.enableKenLMGate === true;
  const kenlmGateMode =
    row.kenlmGateMode === 'hard_gate' || row.kenlmGateMode === 'weak_veto'
      ? row.kenlmGateMode
      : enableKenLMGate
        ? 'weak_veto'
        : undefined;
  const kenlmVetoThreshold =
    typeof row.kenlmVetoThreshold === 'number' ? row.kenlmVetoThreshold : undefined;
  return { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold };
}

async function runCase(port, row) {
  const enabledDomains = row.enabledDomains || ['restaurant'];
  const profilePrimaryDomain = row.profilePrimaryDomain || 'restaurant';
  const { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold } = resolveKenlmFields(row);
  const body = {
    asrText: row.raw,
    srcLang: 'zh',
    enabledDomains,
    profilePrimaryDomain,
    session_id: `fw-homo-${row.id || 'case'}-${Date.now()}`,
    utterance_index: 0,
    is_manual_cut: true,
  };
  if (typeof enableKenLMGate === 'boolean') {
    body.enableKenLMGate = enableKenLMGate;
  }
  if (kenlmGateMode) {
    body.kenlmGateMode = kenlmGateMode;
  }
  if (typeof kenlmVetoThreshold === 'number') {
    body.kenlmVetoThreshold = kenlmVetoThreshold;
  }
  const res = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  console.log('[FW-HOMO] Waiting test server on', port, '...');
  if (!(await waitHealth(port))) {
    console.error('[FW-HOMO] Test server not ready.');
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
      const fw = data.extra?.fw_detector || {};
      const applied = fw.summary?.appliedCount ?? 0;
      const ok = row.shouldRepair === true && text === row.expected && applied > 0;
      if (ok) {
        pass += 1;
        console.log(
          `[${id}] PASS applied=${applied} kenlm=${fw.configSnapshot?.kenlmGateMode} text=${text.slice(0, 50)}`
        );
      } else {
        fail += 1;
        console.log(`[${id}] FAIL`, {
          applied,
          expected: row.expected,
          textPreview: text.slice(0, 50),
          selectedKenlm: fw.spans?.[0]?.candidates?.find((c) => c.selected)?.kenlm,
        });
      }
    } catch (e) {
      fail += 1;
      console.log(`[${id}] ERROR`, e.message);
    }
  }

  console.log('\n[FW-HOMO] Summary', { total: rows.length, pass, fail });
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
