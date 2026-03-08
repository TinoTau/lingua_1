/**
 * 对 expired/zh_tts_1.wav～zh_tts_9.wav 逐段跑中文 ASR，输出每段识别结果与耗时，便于写报告。
 * 用法：node tests/run-zh-tts-batch.js
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
    body: JSON.stringify({ wavPath, srcLang: options.srcLang, room_id: options.room_id }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const port = getTestServerPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthRes = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!healthRes || !healthRes.ok) {
    console.error('无法连接节点，请先 npm start 并启动 ASR 服务');
    process.exit(1);
  }

  const results = [];
  for (let i = 1; i <= 9; i++) {
    const wavPath = path.join(DEFAULT_WAV_DIR, `zh_tts_${i}.wav`);
    if (!fs.existsSync(wavPath)) {
      results.push({ segment: i, error: '文件不存在', textAsr: '', pipelineMs: null });
      continue;
    }
    process.stderr.write(`  zh_tts_${i} ...`);
    try {
      const result = await runPipelineWithAudioViaHttp(wavPath, {});
      const textAsr = result.text_asr || '';
      const pipelineMs = result.extra?.pipeline_ms ?? null;
      results.push({ segment: i, textAsr, pipelineMs, error: null });
      process.stderr.write(` ${pipelineMs} ms\n`);
    } catch (e) {
      results.push({ segment: i, error: e.message, textAsr: '', pipelineMs: null });
      process.stderr.write(` 失败\n`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
