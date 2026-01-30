/**
 * AudioAggregator vs UtteranceAggregator 对比分析工具
 * 
 * 功能：
 * 1. 分析AudioAggregator的originalJobIds分配
 * 2. 分析OriginalJobResultDispatcher的文本合并
 * 3. 分析UtteranceAggregator的处理结果
 * 4. 找出文本丢失的原因
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const logFilePath = args[0] || path.join(__dirname, '../logs/electron-main.log');
const sessionIdFilter = args[1];

if (!fs.existsSync(logFilePath)) {
  console.error(`❌ 日志文件不存在: ${logFilePath}`);
  process.exit(1);
}

console.log(`📖 分析日志文件: ${logFilePath}\n`);
console.log('='.repeat(120));

const logContent = fs.readFileSync(logFilePath, 'utf-8');
const lines = logContent.split('\n').filter(line => line.trim());

const logs = [];
for (const line of lines) {
  try {
    const log = JSON.parse(line);
    logs.push(log);
  } catch (e) {
    // 跳过非JSON行
  }
}

// 过滤相关日志
const relevantLogs = logs.filter(log => {
  if (sessionIdFilter) {
    const sessionId = log.sessionId || log.session_id || log.session;
    if (!sessionId || !sessionId.includes(sessionIdFilter)) {
      return false;
    }
  }
  
  const hasJobInfo = log.jobId || log.job_id || 
                     (log.msg && (log.msg.includes('job') || log.msg.includes('Job'))) ||
                     log.originalJobIds;
  return hasJobInfo;
});

// 按时间排序
relevantLogs.sort((a, b) => {
  const timeA = a.time || a.timestamp || 0;
  const timeB = b.time || b.timestamp || 0;
  return timeA - timeB;
});

// ============================================================
// 1. AudioAggregator分析：originalJobIds分配
// ============================================================
console.log('\n📊 第一部分：AudioAggregator的originalJobIds分配\n');
console.log('-'.repeat(120));

const audioAggregatorEvents = [];
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('audioaggregator') && log.originalJobIds) {
    audioAggregatorEvents.push({
      time: log.time ? new Date(log.time).toISOString() : 'N/A',
      jobId: log.jobId || log.job_id,
      originalJobIds: log.originalJobIds,
      audioSegmentsCount: log.audioSegmentsCount || log.outputSegmentCount,
      inputAudioDurationMs: log.inputAudioDurationMs,
      bufferKey: log.bufferKey,
      state: log.state,
      msg: log.msg,
    });
  }
}

console.log(`找到 ${audioAggregatorEvents.length} 个AudioAggregator分配事件\n`);

for (const event of audioAggregatorEvents) {
  console.log(`[${event.time}] ${event.msg}`);
  console.log(`  当前Job: ${event.jobId}`);
  console.log(`  分配的originalJobIds: ${JSON.stringify(event.originalJobIds)}`);
  console.log(`  音频段数: ${event.audioSegmentsCount || 'N/A'}`);
  if (event.inputAudioDurationMs) {
    console.log(`  输入音频时长: ${event.inputAudioDurationMs}ms`);
  }
  console.log('');
}

// ============================================================
// 2. OriginalJobResultDispatcher分析：文本合并
// ============================================================
console.log('\n📊 第二部分：OriginalJobResultDispatcher的文本合并\n');
console.log('-'.repeat(120));

const dispatcherEvents = [];
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('textmerge') || msg.includes('merged asr batches')) {
    dispatcherEvents.push({
      time: log.time ? new Date(log.time).toISOString() : 'N/A',
      originalJobId: log.originalJobId,
      sessionId: log.sessionId || log.session_id,
      batchCount: log.batchCount,
      missingCount: log.missingCount || 0,
      receivedCount: log.receivedCount,
      expectedSegmentCount: log.expectedSegmentCount,
      mergedTextPreview: log.mergedTextPreview,
      mergedTextLength: log.mergedTextLength,
      batchTexts: log.batchTexts || [],
      isPartial: log.isPartial,
      msg: log.msg,
    });
  }
}

console.log(`找到 ${dispatcherEvents.length} 个文本合并事件\n`);

for (const event of dispatcherEvents) {
  console.log(`[${event.time}] ${event.msg}`);
  console.log(`  OriginalJobId: ${event.originalJobId}`);
  console.log(`  批次数量: ${event.batchCount}`);
  console.log(`  缺失批次: ${event.missingCount}`);
  console.log(`  已接收: ${event.receivedCount}/${event.expectedSegmentCount}`);
  if (event.isPartial) {
    console.log(`  ⚠️  部分结果 (isPartial=true)`);
  }
  if (event.mergedTextPreview) {
    console.log(`  合并文本预览: "${event.mergedTextPreview}"`);
  }
  if (event.mergedTextLength) {
    console.log(`  合并文本长度: ${event.mergedTextLength} 字符`);
  }
  if (event.batchTexts && event.batchTexts.length > 0) {
    console.log(`  各批次文本:`);
    for (const batch of event.batchTexts) {
      const missing = batch.isMissing ? ' [缺失]' : '';
      console.log(`    Batch ${batch.batchIndex}: "${batch.textPreview}" (${batch.textLength}字符)${missing}`);
    }
  }
  console.log('');
}

// ============================================================
// 3. UtteranceAggregator分析：聚合结果
// ============================================================
console.log('\n📊 第三部分：UtteranceAggregator的处理结果\n');
console.log('-'.repeat(120));

const aggregationEvents = [];
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('aggregationstage') && (log.aggregatedText || log.action)) {
    aggregationEvents.push({
      time: log.time ? new Date(log.time).toISOString() : 'N/A',
      jobId: log.jobId || log.job_id,
      action: log.action,
      aggregatedText: log.aggregatedText,
      originalText: log.originalText,
      shouldDiscard: log.shouldDiscard,
      shouldWaitForMerge: log.shouldWaitForMerge,
      isLastInMergedGroup: log.isLastInMergedGroup,
      deduped: log.deduped,
      msg: log.msg,
    });
  }
}

console.log(`找到 ${aggregationEvents.length} 个聚合事件\n`);

for (const event of aggregationEvents) {
  console.log(`[${event.time}] ${event.msg}`);
  console.log(`  JobId: ${event.jobId}`);
  console.log(`  动作: ${event.action}`);
  if (event.aggregatedText) {
    console.log(`  聚合文本: "${event.aggregatedText}"`);
  }
  if (event.shouldDiscard) {
    console.log(`  ⚠️  文本被丢弃 (shouldDiscard=true)`);
  }
  if (event.shouldWaitForMerge) {
    console.log(`  ⚠️  等待合并 (shouldWaitForMerge=true)`);
  }
  if (event.deduped) {
    console.log(`  ⚠️  文本被去重 (deduped=true)`);
  }
  console.log('');
}

// ============================================================
// 4. 问题诊断：找出丢失的job
// ============================================================
console.log('\n📊 第四部分：问题诊断\n');
console.log('-'.repeat(120));

// 收集所有涉及的job
const allJobIds = new Set();
for (const log of relevantLogs) {
  if (log.jobId) allJobIds.add(log.jobId);
  if (log.job_id) allJobIds.add(log.job_id);
  if (log.originalJobIds) {
    for (const id of log.originalJobIds) {
      allJobIds.add(id);
    }
  }
  if (log.originalJobId) {
    allJobIds.add(log.originalJobId);
  }
}

console.log(`总共涉及 ${allJobIds.size} 个job\n`);

// 检查每个job的处理流程
const jobStatus = new Map();

for (const jobId of allJobIds) {
  const status = {
    jobId,
    hasAudioAggregator: false,
    hasDispatcher: false,
    hasAggregation: false,
    hasASR: false,
    hasNMT: false,
    originalJobIds: [],
    mergedText: null,
    aggregatedText: null,
    translatedText: null,
    issues: [],
  };
  
  // 检查AudioAggregator
  for (const event of audioAggregatorEvents) {
    if (event.originalJobIds && event.originalJobIds.includes(jobId)) {
      status.hasAudioAggregator = true;
      status.originalJobIds = event.originalJobIds;
    }
  }
  
  // 检查Dispatcher
  for (const event of dispatcherEvents) {
    if (event.originalJobId === jobId) {
      status.hasDispatcher = true;
      status.mergedText = event.mergedTextPreview;
      if (event.missingCount > 0) {
        status.issues.push(`缺失 ${event.missingCount} 个批次`);
      }
      if (event.isPartial) {
        status.issues.push('部分结果 (isPartial=true)');
      }
    }
  }
  
  // 检查Aggregation
  for (const event of aggregationEvents) {
    if (event.jobId === jobId) {
      status.hasAggregation = true;
      status.aggregatedText = event.aggregatedText;
      if (event.shouldDiscard) {
        status.issues.push('文本被丢弃');
      }
      if (event.shouldWaitForMerge) {
        status.issues.push('等待合并');
      }
      if (event.deduped) {
        status.issues.push('文本被去重');
      }
    }
  }
  
  // 检查ASR
  for (const log of relevantLogs) {
    const msg = (log.msg || '').toLowerCase();
    if ((log.jobId === jobId || log.job_id === jobId) && 
        (msg.includes('asr') || msg.includes('faster-whisper'))) {
      status.hasASR = true;
    }
  }
  
  // 检查NMT
  for (const log of relevantLogs) {
    const msg = (log.msg || '').toLowerCase();
    if ((log.jobId === jobId || log.job_id === jobId) && 
        (msg.includes('nmt') || msg.includes('translation'))) {
      status.hasNMT = true;
      if (log.translatedText || log.translated_text) {
        status.translatedText = log.translatedText || log.translated_text;
      }
    }
  }
  
  jobStatus.set(jobId, status);
}

// 输出诊断结果
console.log('Job处理状态汇总:\n');

const sortedJobs = Array.from(jobStatus.values()).sort((a, b) => {
  return a.jobId.localeCompare(b.jobId);
});

for (const status of sortedJobs) {
  const stages = [];
  if (status.hasAudioAggregator) stages.push('✅AudioAgg');
  else stages.push('❌AudioAgg');
  
  if (status.hasASR) stages.push('✅ASR');
  else stages.push('❌ASR');
  
  if (status.hasDispatcher) stages.push('✅Dispatcher');
  else stages.push('❌Dispatcher');
  
  if (status.hasAggregation) stages.push('✅Aggregation');
  else stages.push('❌Aggregation');
  
  if (status.hasNMT) stages.push('✅NMT');
  else stages.push('❌NMT');
  
  console.log(`Job: ${status.jobId}`);
  console.log(`  阶段: ${stages.join(' → ')}`);
  
  if (status.originalJobIds.length > 0) {
    console.log(`  分配的originalJobIds: ${JSON.stringify(status.originalJobIds)}`);
  }
  
  if (status.mergedText) {
    console.log(`  合并文本: "${status.mergedText}"`);
  }
  
  if (status.aggregatedText) {
    console.log(`  聚合文本: "${status.aggregatedText}"`);
  }
  
  if (status.translatedText) {
    console.log(`  翻译文本: "${status.translatedText}"`);
  }
  
  if (status.issues.length > 0) {
    console.log(`  ⚠️  问题: ${status.issues.join(', ')}`);
  }
  
  // 检查是否完全丢失
  if (!status.hasAudioAggregator && !status.hasASR && !status.hasDispatcher && !status.hasAggregation) {
    console.log(`  ❌ 完全丢失：没有任何处理记录`);
  }
  
  console.log('');
}

// ============================================================
// 5. 总结和建议
// ============================================================
console.log('\n📊 第五部分：总结和建议\n');
console.log('-'.repeat(120));

const lostJobs = Array.from(jobStatus.values()).filter(s => 
  !s.hasAudioAggregator && !s.hasASR && !s.hasDispatcher && !s.hasAggregation
);

const partialJobs = Array.from(jobStatus.values()).filter(s => 
  s.issues.some(i => i.includes('缺失') || i.includes('部分结果'))
);

const discardedJobs = Array.from(jobStatus.values()).filter(s => 
  s.issues.some(i => i.includes('丢弃') || i.includes('去重'))
);

console.log(`统计:`);
console.log(`  总job数: ${jobStatus.size}`);
console.log(`  完全丢失: ${lostJobs.length}`);
console.log(`  部分丢失: ${partialJobs.length}`);
console.log(`  被丢弃/去重: ${discardedJobs.length}`);
console.log('');

if (lostJobs.length > 0) {
  console.log(`完全丢失的job:`);
  for (const job of lostJobs) {
    console.log(`  - ${job.jobId}`);
  }
  console.log('');
}

if (partialJobs.length > 0) {
  console.log(`部分丢失的job:`);
  for (const job of partialJobs) {
    console.log(`  - ${job.jobId}: ${job.issues.join(', ')}`);
  }
  console.log('');
}

console.log('💡 诊断建议:');
console.log('  1. 如果job有AudioAggregator但没有Dispatcher，可能是originalJobIds分配错误');
console.log('  2. 如果job有Dispatcher但isPartial=true，可能是批次丢失');
console.log('  3. 如果job有Aggregation但shouldDiscard=true，可能是文本太短被过滤');
console.log('  4. 如果job有Aggregation但deduped=true，可能是去重逻辑误判');
console.log('  5. 检查AudioAggregator的originalJobIds分配，确保所有job都被正确分配');
