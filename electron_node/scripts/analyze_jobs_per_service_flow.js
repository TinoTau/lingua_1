/**
 * 按 Job 分析各服务处理过程：ASR / 聚合 / 语义修复 / NMT / TTS
 * 用法: node scripts/analyze_jobs_per_service_flow.js [logPath] [--out report.md]
 * 示例: node scripts/analyze_jobs_per_service_flow.js electron-node/logs/electron-main.log
 * 示例: node scripts/analyze_jobs_per_service_flow.js electron-node/logs/electron-main.log --out logs/docs/asr_performance/JOB_SERVICE_FLOW_REPORT.md
 */

const fs = require('fs');
const path = require('path');

let logPath = null;
let outPath = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--out' && process.argv[i + 1]) {
    outPath = process.argv[i + 1];
    i++;
  } else if (!logPath) {
    logPath = process.argv[i];
  }
}
logPath = logPath || path.join(__dirname, '..', 'electron-node', 'logs', 'electron-main.log');

if (!fs.existsSync(logPath)) {
  console.error('日志文件不存在:', logPath);
  console.error('用法: node scripts/analyze_jobs_per_service_flow.js <logPath>');
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/).filter(Boolean);

// 支持 JSON 行（"jobId":"job-xxx-xxx"）和纯文本中的 job_id/jobId
const jobIds = {};
for (const line of lines) {
  let jid = null;
  try {
    if (line.trim().startsWith('{')) {
      const o = JSON.parse(line);
      jid = o.jobId || o.job_id || null;
    }
  } catch (_) {}
  if (!jid) {
    const m = line.match(/jobId["\s:]+"([^"]+)"/) || line.match(/job_id["\s:]+"([^"]+)"/);
    jid = m ? m[1] : null;
  }
  if (!jid) continue;
  if (!jobIds[jid]) jobIds[jid] = [];
  jobIds[jid].push(line);
}

const jobList = Object.keys(jobIds);
if (jobList.length === 0) {
  console.log('未找到包含 jobId 的日志行');
  process.exit(0);
}

function getUtteranceIndex(logLines) {
  for (const l of logLines) {
    const o = parseJsonLine(l);
    if (o && (o.utteranceIndex != null || o.utterance_index != null))
      return parseInt(o.utteranceIndex ?? o.utterance_index, 10);
    const m = l.match(/utteranceIndex.*?(\d+)/) || l.match(/utterance_index.*?(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return -1;
}

const sorted = jobList
  .map((jid) => ({ jobId: jid, ui: getUtteranceIndex(jobIds[jid]) }))
  .sort((a, b) => a.ui - b.ui || (a.jobId < b.jobId ? -1 : 1));

function extract(line, re) {
  const m = line.match(re);
  return m ? m[1] : null;
}
function parseJsonLine(line) {
  try {
    if (line.trim().startsWith('{')) return JSON.parse(line);
  } catch (_) {}
  return null;
}
function preview(s, len = 80) {
  if (!s) return '(未找到或为空)';
  return s.length <= len ? s : s.slice(0, len) + '...';
}

// 从整份日志提取 session_id（用于报告标题）
let sessionId = null;
for (const line of lines) {
  const o = parseJsonLine(line);
  if (o && (o.sessionId != null || o.session_id != null)) {
    sessionId = o.sessionId || o.session_id;
    break;
  }
  const m = line.match(/sessionId["\s:]+"([^"]+)"/) || line.match(/session_id["\s:]+"([^"]+)"/);
  if (m) { sessionId = m[1]; break; }
}

// 扩展异常关键词：error/exception/failed + timeout/ECONN/5xx/unhandled/undefined/null
function getErrorLines(jobLines) {
  const errs = [];
  const patterns = [
    /\berror\b/i, /\bexception\b/i, /\bfailed\b/i,
    /\btimeout\b/i, /\bECONNRESET\b/i, /\bECONNREFUSED\b/i,
    /\b429\b/, /\b502\b/, /\b503\b/, /\b504\b/,
    /\bUnhandled\b/, /\bunhandled\b/, /\bundefined\b/, /\bnull\b/,
  ];
  for (const l of jobLines) {
    if (patterns.some((re) => re.test(l))) {
      const o = parseJsonLine(l);
      const msg = o ? (o.msg || o.message || JSON.stringify(o).slice(0, 200)) : l.slice(0, 200);
      errs.push(msg);
    }
  }
  return errs;
}

// 从日志行解析 job_id（仅当能明确解析出才参与闭环统计）
function getJobIdFromLine(line) {
  try {
    if (line.trim().startsWith('{')) {
      const o = JSON.parse(line);
      return o.jobId || o.job_id || null;
    }
  } catch (_) {}
  const m = line.match(/jobId["\s:]+"([^"]+)"/) || line.match(/job_id["\s:]+"([^"]+)"/);
  return m ? m[1] : null;
}
function lineBelongsToJob(line, jobId) {
  const lineJid = getJobIdFromLine(line);
  return lineJid === jobId;
}

// 为每个 job 建统计结构体，并在解析时累加
function createJobStats() {
  return {
    asrOutCount: 0,
    aggregationCount: 0,
    semanticRepairRequestCount: 0,
    semanticRepairResponseCount: 0,
    nmtRequestCount: 0,
    nmtResponseCount: 0,
    ttsRequestCount: 0,
    ttsResponseCount: 0,
    jobResultSendCount: 0,
    translatedTextNonEmpty: false,
    ttsAudioLengthMax: 0,
    shouldSendToSemanticRepairSeenTrue: false,
    shouldSendToSemanticRepairSeenFalse: false,
    repairedTextSeen: false,
    nmtResponseEvidence: [],
    ttsResponseEvidence: [],
    jobResultSendEvidence: [],
  };
}

// 对单个 job 的日志行做一遍计数（Patch A: 仅当行能解析出 job_id 且等于当前 jobId 才计；Patch B: 每阶段只认 1 个 response 判定点）
function accumulateStats(jobLines, stats, jobId) {
  let ttsResponseCounted = false; // TTS 每 job 只计一次 response（有音频 length>0 的第一条）
  for (const l of jobLines) {
    const belongs = lineBelongsToJob(l, jobId);

    if (/asrText|ASR batch.*completed|ASR completed/i.test(l)) stats.asrOutCount++;
    if (/segmentForJobResult|shouldSendToSemanticRepair|runAggregationStep|Aggregation/.test(l)) stats.aggregationCount++;
    if (/shouldSendToSemanticRepair.*true/.test(l)) stats.shouldSendToSemanticRepairSeenTrue = true;
    if (/shouldSendToSemanticRepair.*false/.test(l)) stats.shouldSendToSemanticRepairSeenFalse = true;
    if (/repairedText/.test(l)) stats.repairedTextSeen = true;
    if (belongs) {
      if (/runSemanticRepairStep.*(Semantic repair completed|Semantic repair rejected|initializer missing|stage not available|initialization failed)/.test(l)) stats.semanticRepairRequestCount++;
      if (/Semantic repair (completed|rejected)/.test(l)) stats.semanticRepairResponseCount++;
      if (/NMT INPUT: Sending NMT request/.test(l)) stats.nmtRequestCount++;
      // NMT response：只认一条——“NMT OUTPUT: NMT request succeeded”（不认 Translation completed / preview / length 单独行）
      if (/NMT OUTPUT: NMT request succeeded/.test(l)) {
        stats.nmtResponseCount++;
        if (stats.nmtResponseEvidence.length < 2) stats.nmtResponseEvidence.push(l.slice(0, 140));
      }
      const translatedLen = l.match(/translatedTextLength["\s:]+(\d+)/);
      if (translatedLen && parseInt(translatedLen[1], 10) > 0) stats.translatedTextNonEmpty = true;
      if (/translatedText["\s:]+"[^"]+"/.test(l) && !/translatedTextLength["\s:]+0/.test(l)) stats.translatedTextNonEmpty = true;

      if (/routeTTSTask|tts-step.*request|TTS request/.test(l)) stats.ttsRequestCount++;
      // TTS response：只认“有 ttsAudioLength 且值>0”的第一条（无音频/length=0/skipped 不计）
      const ttsLenM = l.match(/ttsAudioLength["\s:]+(\d+)/);
      if (ttsLenM) {
        const len = parseInt(ttsLenM[1], 10);
        if (len > 0) {
          stats.ttsAudioLengthMax = Math.max(stats.ttsAudioLengthMax, len);
          if (!ttsResponseCounted) {
            ttsResponseCounted = true;
            stats.ttsResponseCount++;
            if (stats.ttsResponseEvidence.length < 2) stats.ttsResponseEvidence.push(l.slice(0, 140));
          }
        }
      }

      if (/Job result sent successfully/.test(l)) {
        stats.jobResultSendCount++;
        if (stats.jobResultSendEvidence.length < 2) stats.jobResultSendEvidence.push(l.slice(0, 140));
      }
    }
  }
  return stats;
}

// 闭环断言：返回 flags 数组（DUP_*, MISS_*, TTS_WITH_EMPTY_NMT 等）
// 缺失响应：仅当 request > response 时标出（避免因多行 response 日志导致的误报）
function auditFlags(stats) {
  const flags = [];
  if (stats.nmtRequestCount > 1 || stats.ttsRequestCount > 1 || stats.semanticRepairRequestCount > 1) flags.push('DUP_CALL');
  if (stats.nmtRequestCount > stats.nmtResponseCount) flags.push('MISS_NMT_RESP');
  if (stats.semanticRepairRequestCount > stats.semanticRepairResponseCount) flags.push('MISS_REPAIR_RESP');
  if (!stats.translatedTextNonEmpty && stats.ttsAudioLengthMax > 0) flags.push('TTS_WITH_EMPTY_NMT');
  if (stats.jobResultSendCount > 1) flags.push('DUP_SEND');
  return flags;
}

// 先为每个 job 计算 stats（用于 Summary 与 [Audit]）
const jobStatsMap = {};
for (const { jobId, ui } of sorted) {
  const st = createJobStats();
  accumulateStats(jobIds[jobId], st, jobId);
  jobStatsMap[jobId] = st;
}

const md = [];
if (outPath) {
  md.push('# 本次集成测试 · 各 Job 在各服务中的处理过程');
  md.push('');
  md.push('**日志文件**: `' + logPath + '`');
  if (sessionId) md.push('**Session**: ' + sessionId);
  md.push('**日期**: ' + new Date().toISOString().slice(0, 10));
  md.push('');
  md.push('## Summary（每 Job 一行，快速定位问题）');
  md.push('');
  md.push('| utterance_index | job_id | ASR | Agg | Repair req/resp | NMT req/resp | TTS req/resp | job_result sent | Flags |');
  md.push('| --------------- | ------ | --: | --: | --------------: | -----------: | -----------: | --------------: | ----- |');
  for (const { jobId, ui } of sorted) {
    const st = jobStatsMap[jobId];
    const flags = auditFlags(st);
    const repairStr = st.semanticRepairRequestCount + '/' + st.semanticRepairResponseCount;
    const nmtStr = st.nmtRequestCount + '/' + st.nmtResponseCount;
    const ttsStr = st.ttsRequestCount + '/' + st.ttsResponseCount;
    const jobIdShort = jobId.length > 24 ? jobId.slice(0, 21) + '...' : jobId;
    md.push('| ' + ui + ' | `' + jobIdShort + '` | ' + st.asrOutCount + ' | ' + st.aggregationCount + ' | ' + repairStr + ' | ' + nmtStr + ' | ' + ttsStr + ' | ' + st.jobResultSendCount + ' | ' + (flags.length ? flags.join(', ') : '—') + ' |');
  }
  md.push('');
  md.push('---');
  md.push('');
}

console.log('========================================');
console.log('按 Job 分析：ASR → 聚合 → 语义修复 → NMT → TTS');
console.log('日志文件:', logPath);
if (outPath) console.log('Markdown 报告输出:', outPath);
console.log('========================================\n');

for (const { jobId, ui } of sorted) {
  const jobLines = jobIds[jobId];
  const errorLines = getErrorLines(jobLines);

  console.log('----------------------------------------');
  console.log('Job:', jobId, ' (utterance_index:', ui + ')');
  console.log('----------------------------------------');

  let asrText = null;
  for (const l of jobLines.filter((x) => /asrText|ASR batch.*completed|ASR completed/.test(x))) {
    const o = parseJsonLine(l);
    if (o && (o.asrText != null || o.asrTextPreview != null)) {
      asrText = o.asrText || o.asrTextPreview || null;
      break;
    }
    asrText = extract(l, /asrText.*?"(.*?)"/) || extract(l, /asrTextPreview.*?"(.*?)"/);
    if (asrText) break;
  }
  console.log('  [ASR] 输出:', preview(asrText || '', 80));

  let segmentForJob = null;
  let shouldSend = null;
  for (const l of jobLines.filter((x) => /segmentForJobResult|shouldSendToSemanticRepair|runAggregationStep|Aggregation/.test(x))) {
    const o = parseJsonLine(l);
    if (o) {
      if (o.segmentForJobResult != null || o.segmentForJobResultPreview != null)
        segmentForJob = segmentForJob || o.segmentForJobResult || o.segmentForJobResultPreview;
      if (o.shouldSendToSemanticRepair != null) shouldSend = String(o.shouldSendToSemanticRepair);
    }
    if (!segmentForJob)
      segmentForJob = segmentForJob || extract(l, /segmentForJobResultPreview.*?"(.*?)"/) || extract(l, /segmentForJobResult.*?"(.{1,200})"/);
    const sm = l.match(/shouldSendToSemanticRepair.*?(true|false)/);
    if (sm) shouldSend = sm[1];
  }
  console.log('  [聚合] segmentForJobResult:', preview(segmentForJob || '', 80));
  console.log('  [聚合] shouldSendToSemanticRepair:', shouldSend ?? '?');

  const semOut = jobLines.filter((x) => /runSemanticRepairStep|Semantic repair|repairedText/.test(x));
  const semSkipped = semOut.some((x) => /skipped|no semantic repair initializer|stage not available/.test(x));
  let repaired = null;
  let semDone = semOut.some((x) => /Semantic repair (completed|rejected|failed)/.test(x));
  for (const l of semOut) {
    const o = parseJsonLine(l);
    if (o && o.repairedText != null) repaired = repaired || o.repairedText;
    // 只匹配键 "repairedText" 的值，避免误匹配 repairedTextLength
    if (!repaired) {
      const m = l.match(/"repairedText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) repaired = m[1].replace(/\\"/g, '"');
    }
    if (!repaired) repaired = repaired || extract(l, /"repairedText"\s*:\s*"(.*?)"/);
  }
  if (semSkipped) {
    console.log('  [语义修复] 未执行（跳过/无 initializer）');
  } else {
    console.log('  [语义修复] 已执行:', semDone ? 'Y' : '?', '; repairedText:', preview(repaired || '?', 60));
  }

  const nmtIn = jobLines.filter((x) => /NMT INPUT: Sending NMT request/.test(x));
  let nmtTextIn = null;
  let nmtContextLen = null;
  for (const l of nmtIn) {
    const o = parseJsonLine(l);
    if (o && (o.textPreview != null || o.text != null)) nmtTextIn = nmtTextIn || o.textPreview || o.text;
    if (!nmtTextIn) {
      const m = l.match(/"textPreview"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) nmtTextIn = m[1].replace(/\\"/g, '"');
    }
    if (!nmtTextIn) nmtTextIn = nmtTextIn || extract(l, /"textPreview"\s*:\s*"(.*?)"/) || extract(l, /"text"\s*:\s*"(.*?)"/);
    const cm = l.match(/contextTextLength.*?(\d+)/);
    if (cm) nmtContextLen = parseInt(cm[1], 10);
  }
  if (nmtTextIn) {
    console.log('  [NMT 输入] text:', preview(nmtTextIn, 100));
    if (nmtContextLen != null && nmtContextLen > 0) console.log('  [NMT 输入] contextTextLength:', nmtContextLen);
  }

  let translated = null;
  let translatedPreview = null;
  let nmtDone = false;
  let nmtSkip = false;
  for (const l of jobLines) {
    const o = parseJsonLine(l);
    if (o) {
      if (/Translation completed/.test(o.msg || '')) nmtDone = true;
      if (o.translatedText != null) translated = translated || o.translatedText;
      if (o.translatedTextPreview != null) translatedPreview = translatedPreview || o.translatedTextPreview;
      if (o.translatedTextLength != null && parseInt(o.translatedTextLength, 10) === 0) translated = '';
    }
    if (/Translation completed/.test(l)) nmtDone = true;
    if (/Translation failed|skip|shouldSendToSemanticRepair.*false/.test(l)) nmtSkip = true;
    translated = translated || extract(l, /translatedText.*?"(.*?)"/);
    translatedPreview = translatedPreview || extract(l, /translatedTextPreview.*?"(.*?)"/);
    const tm = l.match(/translatedTextLength.*?(\d+)/);
    if (tm && parseInt(tm[1], 10) === 0) translated = '';
  }
  let ttsLen = null;
  const ttsOut = jobLines.filter((x) => /routeTTSTask|tts-step|tts_audio|ttsAudioLength|TTS completed/.test(x));
  for (const l of ttsOut) {
    const tm = l.match(/ttsAudioLength.*?(\d+)/);
    if (tm) { ttsLen = parseInt(tm[1], 10); break; }
    if (/tts_audio.*length|base64.*length/.test(l)) { ttsLen = 1; break; }
  }

  if (nmtSkip && !nmtDone) {
    console.log('  [NMT] 未执行或跳过（如未走语义修复则跳过）');
  } else {
    console.log('  [NMT] 已执行:', nmtDone ? 'Y' : '?', '; translatedText 长度:', translated != null ? translated.length : '?');
    if (translatedPreview) console.log('  [NMT 输出] translatedTextPreview:', preview(translatedPreview, 100));
    if (ttsOut.length === 0) console.log('  [TTS] 未找到 TTS 相关日志');
    else console.log('  [TTS]', ttsLen && ttsLen > 0 ? '有音频 (length: ' + ttsLen + ')' : '无音频或长度为 0 -> 客户端会显示 [音频丢失]');
  }

  if (errorLines.length > 0) {
    console.log('  [异常] 本 Job 日志中含 error/exception/failed:', errorLines.length, '条');
    errorLines.slice(0, 3).forEach((e) => console.log('    -', e.slice(0, 120)));
  }
  console.log('');

  if (outPath) {
    md.push('### Job ' + ui + ' (utterance_index=' + ui + ', ' + jobId + ')');
    md.push('');
    md.push('| 阶段 | 输入 | 输出 |');
    md.push('|------|------|------|');
    md.push('| **ASR** | 音频 | ' + (asrText ? preview(asrText, 60) : '(未找到)') + ' |');
    md.push('| **聚合** | asrText | segmentForJobResult=' + preview(segmentForJob || '', 50) + ', shouldSendToSemanticRepair=' + (shouldSend ?? '?') + ' |');
    md.push('| **语义修复** | ' + preview(segmentForJob || '', 40) + ' | ' + (semSkipped ? '未执行（跳过/无 initializer）' : (semDone ? 'decision=PASS/REPAIR/REJECT, repairedText=' + preview(repaired || '', 40) : '?')) + ' |');
    md.push('| **NMT** | ' + preview(nmtTextIn || repaired || '', 40) + (nmtContextLen != null && nmtContextLen > 0 ? ', contextLength=' + nmtContextLen : '') + ' | translatedText 长度=' + (translated != null ? translated.length : '0') + (translatedPreview ? ', preview=' + preview(translatedPreview, 40) : '') + ' |');
    md.push('| **TTS** | 译文 | ' + (ttsLen && ttsLen > 0 ? '有音频 length=' + ttsLen : '无音频或 0') + ' |');
    const st = jobStatsMap[jobId];
    const flags = st ? auditFlags(st) : [];
    md.push('');
    md.push('#### [Audit] 闭环断言');
    md.push('');
    if (flags.length === 0) {
      md.push('- 无异常：request/response 配对正常，无重复调用/重复发送。');
    } else {
      if (flags.includes('DUP_CALL')) md.push('- **重复调用**：NMT 或 TTS 或语义修复 request 次数 > 1');
      if (flags.includes('MISS_NMT_RESP')) md.push('- **缺失响应**：NMT request 次数 ≠ response 次数');
      if (flags.includes('MISS_REPAIR_RESP')) md.push('- **缺失响应**：语义修复 request 次数 ≠ response 次数');
      if (flags.includes('TTS_WITH_EMPTY_NMT')) md.push('- **矛盾链路**：translatedText 为空但存在 TTS 音频');
      if (flags.includes('DUP_SEND')) md.push('- **重复发送结果**：job_result 实际发送次数 > 1');
    }
    md.push('');
    md.push('#### [Stats Evidence] 统计来源（自证计数依据）');
    md.push('');
    md.push('**NMT responses matched:**');
    if (st && st.nmtResponseEvidence && st.nmtResponseEvidence.length) {
      st.nmtResponseEvidence.slice(0, 2).forEach((e) => md.push('- `' + e.replace(/`/g, "'").slice(0, 120) + (e.length > 120 ? '...' : '') + '`'));
    } else {
      md.push('- none');
    }
    md.push('');
    md.push('**TTS responses matched:**');
    if (st && st.ttsResponseEvidence && st.ttsResponseEvidence.length) {
      st.ttsResponseEvidence.slice(0, 2).forEach((e) => md.push('- `' + e.replace(/`/g, "'").slice(0, 120) + (e.length > 120 ? '...' : '') + '`'));
    } else {
      md.push('- none');
    }
    md.push('');
    md.push('**job_result sent matched:**');
    if (st && st.jobResultSendEvidence && st.jobResultSendEvidence.length) {
      st.jobResultSendEvidence.slice(0, 2).forEach((e) => md.push('- `' + e.replace(/`/g, "'").slice(0, 120) + (e.length > 120 ? '...' : '') + '`'));
    } else {
      md.push('- none');
    }
    if (errorLines.length > 0) {
      md.push('');
      md.push('**本 Job 异常/错误**（日志中含 error/exception/failed/timeout/ECONN/5xx/unhandled 等）:');
      errorLines.slice(0, 5).forEach((e) => md.push('- ' + e.replace(/\|/g, ' ').slice(0, 150)));
    }
    md.push('');
  }
}

console.log('========================================');
console.log('说明: segmentForJobResult = 本段送 NMT 与 text_asr（客户端原文）');
console.log('      若 NMT 译文为空或 TTS 无音频，客户端会显示 [音频丢失]');
console.log('========================================');

if (outPath) {
  md.push('---');
  md.push('');
  md.push('## 结论摘要');
  md.push('');
  md.push('- Job 总数: ' + sorted.length);
  md.push('- 说明: **Summary** 表为每 Job 各阶段 request/response 计数与 Flags；** [Audit]** 为闭环断言（重复调用/缺失响应/矛盾链路/重复发送）。若某 Job 出现「本 Job 异常/错误」，请在该 Job 的日志行中排查 error/exception/failed/timeout/ECONN/5xx/unhandled 等。');
  md.push('');
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, md.join('\n'), 'utf8');
  console.log('\n已写入 Markdown 报告:', outPath);
}
