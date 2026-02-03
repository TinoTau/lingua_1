/**
 * Mock ASR 长句语义修复 + NMT 流程测试（不依赖 Electron，仅 HTTP 调用服务）
 *
 * 用途：确认语义修复服务、NMT 服务可用，且长句能被修复与翻译。
 * 前置：先启动 semantic-repair-en-zh（端口 5015）、nmt-m2m100（端口 5008）。
 *
 * 运行: node tests/run-mock-asr-pipeline.js
 */

const SEMANTIC_REPAIR_URL = 'http://127.0.0.1:5015';
const NMT_URL = 'http://127.0.0.1:5008';

// 模拟 ASR 识别出的长句（含同音/断句/标点问题），期望被修复为正确语句
const MOCK_ASR_TEXT =
  '接下来追 继续我会尽量地连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后 系统会不会因为操实或者定音判定而挑释把这句话阶段从来到之前 可以拆分成两个不同的任务 甚至出现 在予议上不完整 堵起来前后不连关的情况';

const EXPECTED_REPAIR_SNIPPET =
  '接下来这一句我会尽量连续地说得长一些';

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

async function main() {
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
      console.log('  [OK] 修复结果包含期望片段：“', EXPECTED_REPAIR_SNIPPET, '”');
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
  console.log('测试结束。若需在节点端跑完整 pipeline（含聚合/去重），请启动 Electron 后在 DevTools 中执行 runPipelineWithMockAsr。');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
