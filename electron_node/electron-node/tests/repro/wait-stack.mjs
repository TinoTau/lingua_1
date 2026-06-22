#!/usr/bin/env node
import { waitTestServer, waitAsrReady } from './lib/asr-repro-utils.mjs';

const nodeOk = await waitTestServer(180000);
if (!nodeOk) {
  console.error('[wait-stack] :5020 not ready');
  process.exit(1);
}
const asr = await waitAsrReady(180000);
if (!asr.ready) {
  console.error('[wait-stack] ASR not ready', asr.last);
  process.exit(1);
}
console.log('[wait-stack] OK', JSON.stringify({ node: 5020, asr: asr.health }));
process.exit(0);
