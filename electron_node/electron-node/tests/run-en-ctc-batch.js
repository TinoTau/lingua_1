/**
 * 英文 CTC 批量测试：多次跑 pipeline，统计是否出现「4」、耗时与识别结果摘要。
 * 用法：node tests/run-en-ctc-batch.js --wav [路径] [--runs 20]
 * 默认 --en（srcLang=en），默认 runs=15。
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_TEST_SERVER_PORT = 5020;
const DEFAULT_WAV_DIR = path.resolve(__dirname, '../../../expired');

function getTestServerPort() {
  if (process.env.NODE_TEST_SERVER_PORT) {
    const p = parseInt(process.env.NODE_TEST_SERVER_PORT, 10);
    if (!isNaN(p)) return p;
  }
  const appName = 'lingua-electron-node';
  const configName = 'electron-node-config.json';
  const paths = [];
  if (process.env.APPDATA) paths.push(path.join(process.env.APPDATA, appName, configName));
  if (process.env.HOME) {
    paths.push(path.join(process.env.HOME, '.config', appName, configName));
    paths.push(path.join(process.env.HOME, 'Library', 'Application Support', appName, configName));
  }
  for (const configPath of paths) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const port = parsed.testServer?.port;
        if (typeof port === 'number' && port > 0) return port;
      }
    } catch (_) {}
  }
  return DEFAULT_TEST_SERVER_PORT;
}

async function runPipelineWithAudioViaHttp(wavPath, options = {}) {
  const port = getTestServerPort();
  const url = `http://127.0.0.1:${port}/run-pipeline-with-audio`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      srcLang: options.srcLang || 'en',
      tgtLang: options.tgtLang,
      useLid: options.useLid,
      lidCandidates: options.lidCandidates,
      room_id: options.room_id,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const wavIndex = args.findIndex((a) => a === '--wav');
  let wavPath = wavIndex >= 0 && args[wavIndex + 1] && !args[wavIndex + 1].startsWith('--')
    ? path.resolve(args[wavIndex + 1])
    : path.join(DEFAULT_WAV_DIR, 'en_tts_1.wav');
  const runsIndex = args.findIndex((a) => a === '--runs');
  const runs = runsIndex >= 0 && args[runsIndex + 1] ? parseInt(args[runsIndex + 1], 10) : 15;
  return { wavPath, runs: isNaN(runs) || runs < 1 ? 15 : Math.min(runs, 50) };
}

function main() {
  const { wavPath, runs } = parseArgs();
  if (!fs.existsSync(wavPath)) {
    console.error('WAV 不存在:', wavPath);
    process.exit(1);
  }

  const port = getTestServerPort();
  console.log('英文 CTC 批量测试');
  console.log('  WAV:', wavPath);
  console.log('  次数:', runs);
  console.log('  节点:', 'http://127.0.0.1:' + port);
  console.log('');

  const results = [];
  let has4Count = 0;

  (async () => {
    for (let i = 0; i < runs; i++) {
      process.stderr.write(`  [${i + 1}/${runs}] …`);
      try {
        const result = await runPipelineWithAudioViaHttp(wavPath, { srcLang: 'en' });
        const textAsr = result.text_asr || '';
        const pipelineMs = result.extra?.pipeline_ms;
        const has4 = textAsr.includes('4');
        if (has4) has4Count++;
        results.push({ run: i + 1, pipelineMs, textAsr, has4 });
        process.stderr.write(` ${pipelineMs ?? '-'} ms${has4 ? ' [含4]' : ''}\n`);
      } catch (e) {
        results.push({ run: i + 1, pipelineMs: null, textAsr: '', has4: false, error: e.message });
        process.stderr.write(` 失败: ${e.message}\n`);
      }
    }

    const validMs = results.filter((r) => typeof r.pipelineMs === 'number').map((r) => r.pipelineMs);
    const avgMs = validMs.length ? (validMs.reduce((a, b) => a + b, 0) / validMs.length).toFixed(0) : '-';
    const minMs = validMs.length ? Math.min(...validMs) : '-';
    const maxMs = validMs.length ? Math.max(...validMs) : '-';

    console.log('');
    console.log('========== 汇总 ==========');
    console.log('出现「4」次数:', has4Count, '/', runs);
    console.log('耗时(ms): 平均', avgMs, ' 最小', minMs, ' 最大', maxMs);
    console.log('');
    console.log('各轮识别结果（前 120 字）:');
    results.forEach((r) => {
      const preview = (r.textAsr || r.error || '').slice(0, 120);
      console.log(`  #${r.run} ${r.pipelineMs != null ? r.pipelineMs + 'ms' : 'fail'} ${r.has4 ? '[4]' : ''} ${preview}${preview.length >= 120 ? '…' : ''}`);
    });
    console.log('==========================');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
