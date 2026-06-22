#!/usr/bin/env node
/**
 * Schema V2 Only — 12 句专项 scripted 验收（需 test server :5020 + 节点运行）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures/schema-v2-seed-acceptance-12.json');
const outPath = path.join(__dirname, 'schema-v2-seed-acceptance-12-result.json');

const V2_MANIFEST = 'lexicon-v3-five-table-v2';

async function runMockAsr(port, asrText, sessionId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asrText,
      srcLang: 'zh',
      session_id: sessionId,
      is_manual_cut: true,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function evaluateCase(caseDef, data) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const v4 = fw.spanAssemblyV4 || {};
  const summary = fw.summary || {};
  const failures = [];

  const lexiconManifest = extra.lexicon_manifest_version;
  const lexiconStatus = extra.lexicon_runtime_status;
  if (lexiconManifest !== V2_MANIFEST) {
    failures.push(`lexicon_manifest_version=${lexiconManifest ?? 'null'}`);
  }
  if (lexiconStatus !== 'ok') {
    failures.push(`lexicon_runtime_status=${lexiconStatus ?? 'null'}`);
  }
  if (v4.insufficientEvidence === true && !caseDef.allowInsufficientEvidence) {
    failures.push('insufficientEvidence=true');
  }

  const winning = v4.winningFineDomain ?? v4.utteranceDomain ?? 'general';
  const allowed = caseDef.expectedWinningFineDomains || [];
  if (allowed.length && !allowed.includes(winning)) {
    failures.push(`winningFineDomain=${winning}, expected one of ${allowed.join('|')}`);
  }

  return {
    id: caseDef.id,
    label: caseDef.label,
    pass: failures.length === 0,
    failures,
    raw_asr_text: extra.raw_asr_text ?? caseDef.asrText,
    final_text: data.text_asr ?? '',
    lexicon_manifest_version: lexiconManifest,
    winningFineDomain: winning,
    domainScores: v4.domainScores ?? {},
    recallEnabledFineDomains: v4.recallEnabledFineDomains ?? [],
    insufficientEvidence: v4.insufficientEvidence === true,
    fw_applied_count: summary.appliedCount ?? 0,
    schemaVersion: lexiconManifest,
    lexicon_runtime_status: lexiconStatus,
    pipeline_ms: extra.pipeline_ms,
  };
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const port = getTestServerPort();
  console.log('[seed-acceptance-12] waiting for test server on', port);
  if (!(await waitTestServerHealth(port))) {
    console.error('[seed-acceptance-12] test server not ready');
    process.exit(1);
  }

  const results = [];
  let pass = 0;
  let fail = 0;

  for (const caseDef of fixture.cases) {
    const sessionId = `sv2-12-${caseDef.id}-${Date.now()}`;
    try {
      const data = await runMockAsr(port, caseDef.asrText, sessionId);
      const row = evaluateCase(caseDef, data);
      results.push(row);
      if (row.pass) {
        pass += 1;
        console.log(`[${caseDef.id}] PASS ${caseDef.label} domain=${row.winningFineDomain}`);
      } else {
        fail += 1;
        console.log(`[${caseDef.id}] FAIL ${caseDef.label}`, row.failures);
      }
    } catch (err) {
      fail += 1;
      results.push({
        id: caseDef.id,
        label: caseDef.label,
        pass: false,
        failures: [err instanceof Error ? err.message : String(err)],
      });
      console.log(`[${caseDef.id}] ERROR`, err instanceof Error ? err.message : String(err));
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    fixture: fixturePath,
    schemaVersion: V2_MANIFEST,
    summary: { total: fixture.cases.length, pass, fail },
    cases: results,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('[seed-acceptance-12] wrote', outPath);
  console.log('[seed-acceptance-12] summary', report.summary);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[seed-acceptance-12] fatal', err);
  process.exit(1);
});
