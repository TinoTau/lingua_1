/**
 * 按 Job 汇总各服务输入/输出与耗时
 *
 * 用法: node scripts/analyze-job-per-service.js [log-file-path] [session-id]
 *
 * 示例:
 *   node scripts/analyze-job-per-service.js logs/electron-main.log
 *   node scripts/analyze-job-per-service.js logs/electron-main.log "session-abc"
 *
 * 从节点端 electron-main.log 中提取：
 * - ASR: 输入音频/输出文本、asrServiceDurationMs
 * - 同音纠错: text_in_preview / text_out_preview、changed（节点端无耗时，服务端有 process_time_ms）
 * - 语义修复: 输入/输出预览、decision、process_time_ms
 * - NMT: 输入/输出预览、requestDurationMs
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const logFilePath = args[0] || path.join(__dirname, '../logs/electron-main.log');
const sessionIdFilter = args[1];

if (!fs.existsSync(logFilePath)) {
  console.error('日志文件不存在:', logFilePath);
  console.error('用法: node scripts/analyze-job-per-service.js [log-file-path] [session-id]');
  process.exit(1);
}

const content = fs.readFileSync(logFilePath, 'utf-8');
const lines = content.split('\n').filter((l) => l.trim());

const logs = [];
for (const line of lines) {
  try {
    logs.push(JSON.parse(line));
  } catch (_) {}
}

// 只保留与 job 相关的关键日志（含 job_id/jobId 或 utterance_index）
const keyMsgs = [
  'ASR batch',
  'Phonetic correction step done',
  'Semantic repair job input (sending to service)',
  'Semantic repair job output (received from service)',
  'runSemanticRepairStep: Semantic repair completed',
  'NMT INPUT: Sending NMT request (START)',
  'NMT OUTPUT: NMT request succeeded (END)',
  'runTranslationStep: Translation completed',
];

const relevant = logs.filter((log) => {
  if (sessionIdFilter) {
    const sid = log.sessionId || log.session_id;
    if (!sid || !String(sid).includes(sessionIdFilter)) return false;
  }
  const msg = log.msg || '';
  if (!keyMsgs.some((k) => msg.includes(k))) return false;
  return log.jobId != null || log.job_id != null || log.utteranceIndex != null || log.utterance_index != null;
});

relevant.sort((a, b) => (a.time || 0) - (b.time || 0));

// 按 job 分组：key = job_id + utterance_index（若有多段合并，可能同一 job_id 多条）
const byJob = new Map();

function jobKey(log) {
  const id = log.jobId || log.job_id || '?';
  const u = log.utteranceIndex ?? log.utterance_index ?? -1;
  return `${id}\t${u}`;
}

for (const log of relevant) {
  const key = jobKey(log);
  if (!byJob.has(key)) {
    byJob.set(key, {
      jobId: log.jobId || log.job_id,
      utteranceIndex: log.utteranceIndex ?? log.utterance_index,
      asr: null,
      phonetic: null,
      semanticInput: null,
      semanticOutput: null,
      semanticStep: null,
      nmtInput: null,
      nmtOutput: null,
      translationStep: null,
    });
  }
  const row = byJob.get(key);
  const msg = log.msg || '';

  if (msg.includes('ASR batch') && msg.includes('completed')) {
    row.asr = {
      asrServiceDurationMs: log.asrServiceDurationMs,
      asrTextPreview: log.asrTextPreview,
      asrTextLength: log.asrTextLength,
    };
  }
  if (msg.includes('Phonetic correction step done')) {
    row.phonetic = {
      text_in_preview: log.text_in_preview,
      text_out_preview: log.text_out_preview,
      changed: log.changed,
      step_duration_ms: log.step_duration_ms,
      service_process_time_ms: log.service_process_time_ms,
    };
  }
  if (msg.includes('Semantic repair job input (sending to service)')) {
    row.semanticInput = {
      text_in_preview: log.text_in_preview,
      text_in_len: log.text_in_len,
      lang: log.lang,
    };
  }
  if (msg.includes('Semantic repair job output (received from service)')) {
    row.semanticOutput = {
      decision: log.decision,
      text_out_preview: log.text_out_preview,
      text_out_len: log.text_out_len,
      process_time_ms: log.process_time_ms,
    };
  }
  if (msg.includes('runSemanticRepairStep: Semantic repair completed')) {
    row.semanticStep = {
      decision: log.decision,
      originalText: log.originalText,
      repairedText: log.repairedText,
      textChanged: log.textChanged,
    };
  }
  if (msg.includes('NMT INPUT: Sending NMT request (START)')) {
    row.nmtInput = {
      textPreview: log.textPreview,
      textLength: log.textLength,
      srcLang: log.srcLang,
      tgtLang: log.tgtLang,
    };
  }
  if (msg.includes('NMT OUTPUT: NMT request succeeded (END)')) {
    row.nmtOutput = {
      requestDurationMs: log.requestDurationMs,
      translatedTextPreview: log.translatedTextPreview,
      translatedTextLength: log.translatedTextLength,
    };
  }
  if (msg.includes('runTranslationStep: Translation completed')) {
    row.translationStep = {
      translatedTextLength: log.translatedTextLength,
      fromCache: log.fromCache,
    };
  }
}

// 输出：按 utterance_index 排序
const sorted = Array.from(byJob.entries()).sort((a, b) => {
  const uA = a[1].utteranceIndex ?? -1;
  const uB = b[1].utteranceIndex ?? -1;
  if (uA !== uB) return uA - uB;
  return String(a[1].jobId || '').localeCompare(String(b[1].jobId || ''));
});

console.log('='.repeat(100));
console.log('节点端日志分析：每个 Job 在各服务中的输入/输出与耗时');
console.log('日志文件:', logFilePath);
if (sessionIdFilter) console.log('会话过滤:', sessionIdFilter);
console.log('='.repeat(100));

for (const [, row] of sorted) {
  const id = row.jobId ?? '?';
  const u = row.utteranceIndex ?? '?';
  console.log('\n--- Job', id, '| utterance_index', u, '---\n');

  if (row.asr) {
    console.log('  [ASR]');
    console.log('    耗时(ms):', row.asr.asrServiceDurationMs ?? '—');
    console.log('    输出预览:', (row.asr.asrTextPreview || '').substring(0, 80) + (row.asr.asrTextLength > 80 ? '…' : ''));
    console.log('');
  } else {
    console.log('  [ASR] (无本阶段完成日志)\n');
  }

  if (row.phonetic) {
    console.log('  [同音纠错]');
    console.log('    输入预览:', (row.phonetic.text_in_preview || '').substring(0, 80));
    console.log('    输出预览:', (row.phonetic.text_out_preview || '').substring(0, 80));
    console.log('    有改动:', row.phonetic.changed === true ? '是' : '否');
    console.log('    节点步进耗时(ms):', row.phonetic.step_duration_ms ?? '—');
    console.log('    服务端耗时(ms):', row.phonetic.service_process_time_ms ?? '—');
    console.log('');
  } else {
    console.log('  [同音纠错] (未调用或无日志)\n');
  }

  if (row.semanticInput || row.semanticOutput) {
    console.log('  [语义修复]');
    if (row.semanticInput) {
      console.log('    输入预览:', (row.semanticInput.text_in_preview || '').substring(0, 80));
      console.log('    输入长度:', row.semanticInput.text_in_len ?? '—');
    }
    if (row.semanticOutput) {
      console.log('    输出预览:', (row.semanticOutput.text_out_preview || '').substring(0, 80));
      console.log('    decision:', row.semanticOutput.decision ?? '—');
      console.log('    耗时(ms):', row.semanticOutput.process_time_ms ?? '—');
    }
    if (row.semanticStep && row.semanticStep.textChanged !== undefined) {
      console.log('    textChanged:', row.semanticStep.textChanged);
    }
    console.log('');
  } else {
    console.log('  [语义修复] (未调用或无日志)\n');
  }

  if (row.nmtInput || row.nmtOutput) {
    console.log('  [NMT 翻译]');
    if (row.nmtInput) {
      console.log('    输入预览:', (row.nmtInput.textPreview || '').substring(0, 80));
      console.log('    输入长度:', row.nmtInput.textLength ?? '—');
    }
    if (row.nmtOutput) {
      console.log('    输出预览:', (row.nmtOutput.translatedTextPreview || '').substring(0, 80));
      console.log('    耗时(ms):', row.nmtOutput.requestDurationMs ?? '—');
    }
    if (row.translationStep) {
      console.log('    fromCache:', row.translationStep.fromCache);
    }
    console.log('');
  } else {
    console.log('  [NMT 翻译] (未调用或无日志)\n');
  }
}

console.log('='.repeat(100));
console.log('说明:');
console.log('  - 同音纠错: 节点端记录 step_duration_ms（含网络），服务端返回 service_process_time_ms（仅纠错计算）');
console.log('  - 语义修复耗时: 来自服务端返回的 process_time_ms');
console.log('  - 若某句超过 20 秒才有结果，重点看 ASR 的 asrServiceDurationMs 与 NMT 的 requestDurationMs');
console.log('='.repeat(100));
