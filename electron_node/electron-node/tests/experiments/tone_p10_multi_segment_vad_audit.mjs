#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getFwFrozenPort, resolveProjectRoot } from '../lib/fw-port-ssot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = resolveProjectRoot(__dirname);
const FW_PORT = getFwFrozenPort(PROJECT);
const DIALOG = path.join(PROJECT, 'test wav/dialog_200');
const OUT = path.join(PROJECT, 'tmp/tone_p10_business_acceptance/multi_segment_vad');

function wavToPcm(w) {
  const buf = fs.readFileSync(w);
  let off = 12;
  let sr = 16000;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
    if (id === 'data') return { pcm: buf.subarray(off + 8, off + 8 + sz), sr };
    off += 8 + sz;
  }
  throw new Error('bad wav');
}

function synth(out, a, b, gap = 1.2) {
  const pa = wavToPcm(a);
  const pb = wavToPcm(b);
  const sr = pa.sr;
  const gapBuf = Buffer.alloc(Math.floor(gap * sr * 2));
  const pcm = Buffer.concat([pa.pcm, gapBuf, pb.pcm]);
  const ds = pcm.length;
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + ds, 4);
  hdr.write('WAVE', 8);
  hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(ds, 40);
  fs.writeFileSync(out, Buffer.concat([hdr, pcm]));
}

async function fw(wav, id) {
  const { pcm, sr } = wavToPcm(wav);
  const r = await fetch(`http://127.0.0.1:${FW_PORT}/utterance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: id,
      trace_id: id,
      src_lang: 'zh',
      audio: pcm.toString('base64'),
      audio_format: 'pcm16',
      sample_rate: sr,
      task: 'transcribe',
      beam_size: 1,
      temperature: 0,
      skip_text_dedup: true,
    }),
    signal: AbortSignal.timeout(180000),
  });
  return r.json();
}

async function node(wav, sid) {
  const r = await fetch('http://127.0.0.1:5020/run-pipeline-with-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath: wav,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      session_id: sid,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  return { ok: r.ok, body: await r.json() };
}

const pairs = [
  ['d001', 'd049'],
  ['d050', 'd051'],
  ['d052', 'd053'],
  ['d088', 'd089'],
  ['d025', 'd026'],
];
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [a, b] of pairs) {
  const wav = path.join(OUT, `${a}_${b}_gap.wav`);
  synth(wav, path.join(DIALOG, `dialog_${a}.wav`), path.join(DIALOG, `dialog_${b}.wav`));
  const f = await fw(wav, `multi-${a}${b}`);
  const n = await node(wav, `multi-${a}${b}-${Date.now()}`);
  const row = {
    id: `${a}_${b}`,
    vadSegmentCount: f.diagnostics?.audio_segmentation?.fw_vad_segment_count,
    fwToneSlices: f.tone?.sliceCount ?? f.tone?.acousticToneSlices?.length,
    nodeToneSlices:
      n.body?.extra?.utterance_tone?.sliceCount ??
      n.body?.extra?.utterance_tone?.acousticToneSlices?.length,
    recallToneSlices: n.body?.extra?.fw_detector?.spanAssemblyV4?.tone?.toneSliceCount,
    toneEnabled: n.body?.extra?.fw_detector?.spanAssemblyV4?.tone?.toneEnabled,
    nodeOk: n.ok,
    textPreview: (n.body?.text_asr || '').slice(0, 60),
  };
  rows.push(row);
  console.log(row);
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
