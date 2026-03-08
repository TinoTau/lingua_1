/**
 * 测试脚本：语义修复+NMT（直连 5015/5008）或 完整 pipeline（POST 到节点 5020）。
 * 完整 pipeline：先 npm start 启动节点，界面里启动 ASR/语义/NMT/TTS，再 node tests/run-mock-asr-pipeline.js --wav [路径]
 * 本脚本不启动节点，只对已运行节点发请求。
 *
 * 模式 1：node tests/run-mock-asr-pipeline.js（需先起 5015/5008）
 * 模式 2：npm start → 界面启动服务 → node tests/run-mock-asr-pipeline.js --wav [路径]
 *
 * LID 模式（--lid）：需在配置中设置 lid.modelPath 指向 Sherpa-ONNX 模型目录（含 encoder/decoder），
 * 并安装 Python 依赖 pip install sherpa-onnx，重启节点、界面中启动 ASR，否则 pipeline 会在 LID 或 ASR 阶段失败。
 */

const path = require('path');
const fs = require('fs');

/** 与节点端 node-config 默认一致，和 5010/5015/5016/5017 同段 */
const DEFAULT_TEST_SERVER_PORT = 5020;

function getTestServerPort() {
  if (process.env.NODE_TEST_SERVER_PORT) {
    const p = parseInt(process.env.NODE_TEST_SERVER_PORT, 10);
    if (!isNaN(p)) return p;
  }
  const appName = 'lingua-electron-node';
  const configName = 'electron-node-config.json';
  const possiblePaths = [];
  if (process.env.APPDATA) {
    possiblePaths.push(path.join(process.env.APPDATA, appName, configName));
  }
  if (process.env.HOME) {
    possiblePaths.push(path.join(process.env.HOME, '.config', appName, configName));
    possiblePaths.push(path.join(process.env.HOME, 'Library', 'Application Support', appName, configName));
  }
  for (const configPath of possiblePaths) {
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

const SEMANTIC_REPAIR_URL = 'http://127.0.0.1:5015';
const NMT_URL = 'http://127.0.0.1:5008';

const MOCK_ASR_TEXT =
  '接下来追 继续我会尽量地连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后 系统会不会因为操实或者定音判定而挑释把这句话阶段从来到之前 可以拆分成两个不同的任务 甚至出现 在予议上不完整 堵起来前后不连关的情况';

const EXPECTED_REPAIR_SNIPPET = '接下来这一句我会尽量连续地说得长一些';

// 默认测试 WAV：electron-node 在 electron_node/electron-node，expired 在 lingua_1/expired（与 electron_node 平级）
const DEFAULT_WAV_DIR = path.resolve(__dirname, '../../../expired');
const DEFAULT_WAV_PATHS = {
  zh: path.join(DEFAULT_WAV_DIR, 'chinese.wav'),
  en: path.join(DEFAULT_WAV_DIR, 'english.wav'),
};

function parseArgs() {
  const args = process.argv.slice(2);
  const wavIndex = args.findIndex((a) => a === '--wav');
  let wavPath = null;
  if (wavIndex !== -1) {
    if (args[wavIndex + 1] && !args[wavIndex + 1].startsWith('--')) {
      wavPath = path.resolve(args[wavIndex + 1]);
    } else {
      wavPath = DEFAULT_WAV_PATHS.zh;
    }
  }
  const useLid = args.includes('--lid');
  const both = args.includes('--both');
  const en = args.includes('--en');
  return { wavPath, useLid, both, srcLang: en ? 'en' : undefined };
}

async function checkHealth(url, name) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch (e) {
    console.error(`  [${name}] 健康检查失败:`, e.message);
    return false;
  }
}

async function callSemanticRepair(text, lang = 'zh') {
  const res = await fetch(`${SEMANTIC_REPAIR_URL}/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: `mock-${Date.now()}`,
      session_id: 'mock-session',
      utterance_index: 0,
      lang,
      text_in: text,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.detail || body.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return body;
}

async function callNMT(text, srcLang = 'zh', tgtLang = 'en') {
  const res = await fetch(`${NMT_URL}/v1/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      src_lang: srcLang,
      tgt_lang: tgtLang,
      context_text: text,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return data.text || data.translated || '';
}

async function runPipelineWithAudioViaHttp(wavPath, options = {}) {
  const port = getTestServerPort();
  const url = `http://127.0.0.1:${port}/run-pipeline-with-audio`;
  const body = {
    wavPath,
    srcLang: options.srcLang,
    tgtLang: options.tgtLang,
    useLid: options.useLid,
    lidCandidates: options.lidCandidates,
    room_id: options.room_id,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function mainHttpOnly() {
  console.log('='.repeat(60));
  console.log('Mock ASR → 语义修复 → NMT 流程测试');
  console.log('='.repeat(60));

  console.log('\n[1] 健康检查');
  const srOk = await checkHealth(SEMANTIC_REPAIR_URL, 'semantic-repair-en-zh');
  const nmtOk = await checkHealth(NMT_URL, 'nmt-m2m100');
  if (!srOk) {
    console.error('请先启动 semantic-repair-en-zh（端口 5015）');
    process.exit(1);
  }
  if (!nmtOk) {
    console.warn('NMT 未就绪，将只测试语义修复。');
  }
  console.log('  semantic-repair-en-zh: OK');
  console.log('  nmt-m2m100:', nmtOk ? 'OK' : '跳过');

  console.log('\n[2] 语义修复（模拟 ASR 长句）');
  console.log('  输入（节选）:', MOCK_ASR_TEXT.slice(0, 50) + '...');
  let repaired;
  try {
    const repairRes = await callSemanticRepair(MOCK_ASR_TEXT, 'zh');
    repaired = repairRes.text_out ?? repairRes.text;
    const decision = repairRes.decision ?? '-';
    const confidence = repairRes.confidence ?? 0;
    console.log('  决策:', decision, '置信度:', confidence);
    console.log('  修复后:', repaired);
    if (repaired && repaired.includes(EXPECTED_REPAIR_SNIPPET)) {
      console.log('  [OK] 修复结果包含期望片段："', EXPECTED_REPAIR_SNIPPET, '"');
    } else if (repaired && repaired.length > 0) {
      console.log('  [~] 修复结果与期望片段不完全一致，可人工比对。');
    }
  } catch (e) {
    console.error('  语义修复失败:', e.message);
    process.exit(1);
  }

  if (nmtOk && repaired) {
    console.log('\n[3] NMT 翻译（zh → en）');
    try {
      const translated = await callNMT(repaired, 'zh', 'en');
      console.log('  译文:', translated);
    } catch (e) {
      console.error('  NMT 失败:', e.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('若需在节点端跑完整 pipeline（含 ASR + TTS），请使用: node tests/run-mock-asr-pipeline.js --wav [路径]');
  console.log('='.repeat(60));
}

async function runOne(wavPath, label, options) {
  const result = await runPipelineWithAudioViaHttp(wavPath, options);
  const pipelineMs = result.extra?.pipeline_ms;
  const textAsr = result.text_asr || '';
  return { label, textAsr, pipelineMs, result };
}

async function main() {
  const { wavPath, useLid, both, srcLang } = parseArgs();

  if (both || wavPath) {
    const fs = require('fs');
    const port = getTestServerPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    const toRun = both
      ? [
          { path: DEFAULT_WAV_PATHS.zh, label: '中文' },
          { path: DEFAULT_WAV_PATHS.en, label: '英文' },
        ]
      : [{ path: wavPath, label: path.basename(wavPath) }];

    for (const { path: p } of toRun) {
      if (!fs.existsSync(p)) {
        console.error('WAV 文件不存在:', p);
        process.exit(1);
      }
    }

    console.log('='.repeat(60));
    console.log(useLid ? 'LID 二选一 + Pipeline（WAV → LID → ASR → …）' : '完整 Pipeline（WAV → ASR → …）');
    if (both) console.log('--both: 依次测试 中文 / 英文 并输出识别结果与耗时');
    console.log('='.repeat(60));
    console.log('请求节点 ' + baseUrl + ' …\n');

    const healthRes = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!healthRes || !healthRes.ok) {
      console.error('无法连接节点 ' + baseUrl + '。请先启动节点 (npm start)，确认控制台出现 "✅ Test server 已启动"');
      process.exit(1);
    }
    console.log('节点可达，发送 pipeline 请求…\n');

    const opts = { useLid, lidCandidates: useLid ? ['zh', 'en'] : undefined, srcLang };
    const summary = [];
    let lastResult = null;

    for (const { path: p, label } of toRun) {
      try {
        console.log('--- ' + label + ' ---');
        const { textAsr, pipelineMs, result } = await runOne(p, label, opts);
        lastResult = result;
        console.log('ASR 识别:', textAsr.slice(0, 200) + (textAsr.length > 200 ? '…' : ''));
        if (typeof pipelineMs === 'number') console.log('耗时:', pipelineMs, 'ms');
        if (result.extra?.lid) console.log('LID:', result.extra.lid);
        if (result.extra?.router) console.log('Router:', result.extra.router);
        summary.push({ label, pipelineMs, ok: true });
        console.log('');
      } catch (e) {
        console.error(label + ' 失败:', e.message);
        summary.push({ label, pipelineMs: null, ok: false });
      }
    }

    if (toRun.length === 1 && lastResult) {
      console.log('结果:', JSON.stringify(lastResult, null, 2));
      console.log('\n[OK] 完整 pipeline 执行完成。');
    }

    if (summary.length > 1) {
      console.log('='.repeat(60));
      console.log('汇总：');
      summary.forEach(({ label, pipelineMs, ok }) => {
        console.log('  ' + label + ':', ok ? (pipelineMs != null ? pipelineMs + ' ms' : '-') : '失败');
      });
      console.log('='.repeat(60));
    }
    return;
  }

  await mainHttpOnly();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
