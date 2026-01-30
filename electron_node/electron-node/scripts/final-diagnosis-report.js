/**
 * 最终诊断报告
 * 对比AudioAggregator和UtteranceAggregator，找出文本丢失的根本原因
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

console.log('='.repeat(120));
console.log('📊 AudioAggregator vs UtteranceAggregator 诊断报告');
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
// 收集所有job的完整处理流程
// ============================================================
const jobFlows = new Map();

// 收集所有job
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

// 为每个job创建处理流程
for (const jobId of allJobIds) {
  const flow = {
    jobId,
    audioAggregator: {
      hasAllocation: false,
      originalJobIds: [],
      audioSegmentsCount: 0,
      inputDurationMs: 0,
      shouldReturnEmpty: false,
      isTimeoutPending: false,
      state: null,
    },
    dispatcher: {
      hasMerge: false,
      mergedText: null,
      batchCount: 0,
      missingCount: 0,
      isPartial: false,
    },
    aggregation: {
      hasProcessing: false,
      aggregatedText: null,
      action: null,
      shouldDiscard: false,
      shouldWaitForMerge: false,
      deduped: false,
    },
    nmt: {
      hasTranslation: false,
      translatedText: null,
    },
    issues: [],
  };
  
  // 分析AudioAggregator
  for (const log of relevantLogs) {
    const msg = (log.msg || '').toLowerCase();
    if (msg.includes('audioaggregator') && log.originalJobIds) {
      if (log.originalJobIds.includes(jobId)) {
        flow.audioAggregator.hasAllocation = true;
        flow.audioAggregator.originalJobIds = log.originalJobIds;
        flow.audioAggregator.audioSegmentsCount = log.audioSegmentsCount || log.outputSegmentCount || 0;
        flow.audioAggregator.inputDurationMs = log.inputAudioDurationMs || 0;
        flow.audioAggregator.shouldReturnEmpty = log.shouldReturnEmpty || false;
        flow.audioAggregator.isTimeoutPending = log.isTimeoutPending || false;
        flow.audioAggregator.state = log.state;
      }
    }
  }
  
  // 分析Dispatcher
  for (const log of relevantLogs) {
    const msg = (log.msg || '').toLowerCase();
    if ((msg.includes('textmerge') || msg.includes('merged asr batches')) && log.originalJobId === jobId) {
      flow.dispatcher.hasMerge = true;
      flow.dispatcher.mergedText = log.mergedTextPreview || '';
      flow.dispatcher.batchCount = log.batchCount || 0;
      flow.dispatcher.missingCount = log.missingCount || 0;
      flow.dispatcher.isPartial = log.isPartial || false;
    }
  }
  
  // 分析Aggregation
  for (const log of relevantLogs) {
    const msg = (log.msg || '').toLowerCase();
    if (msg.includes('aggregationstage') && (log.jobId === jobId || log.job_id === jobId)) {
      flow.aggregation.hasProcessing = true;
      flow.aggregation.aggregatedText = log.aggregatedText;
      flow.aggregation.action = log.action;
      flow.aggregation.shouldDiscard = log.shouldDiscard || false;
      flow.aggregation.shouldWaitForMerge = log.shouldWaitForMerge || false;
      flow.aggregation.deduped = log.deduped || false;
    }
  }
  
  // 分析NMT
  for (const log of relevantLogs) {
    const msg = (log.msg || '').toLowerCase();
    if ((msg.includes('nmt') || msg.includes('translation')) && 
        (log.jobId === jobId || log.job_id === jobId)) {
      flow.nmt.hasTranslation = true;
      if (log.translatedText || log.translated_text) {
        flow.nmt.translatedText = log.translatedText || log.translated_text;
      }
    }
  }
  
  // 诊断问题
  if (flow.audioAggregator.hasAllocation && !flow.dispatcher.hasMerge) {
    flow.issues.push('AudioAggregator分配了但没有Dispatcher合并记录');
  }
  
  if (flow.dispatcher.hasMerge && !flow.dispatcher.mergedText) {
    flow.issues.push('Dispatcher合并了但文本为空');
  }
  
  if (flow.dispatcher.hasMerge && flow.dispatcher.isPartial) {
    flow.issues.push('Dispatcher合并了但标记为部分结果');
  }
  
  if (flow.aggregation.hasProcessing && flow.aggregation.shouldDiscard) {
    flow.issues.push('Aggregation处理了但文本被丢弃');
  }
  
  if (flow.aggregation.hasProcessing && flow.aggregation.deduped) {
    flow.issues.push('Aggregation处理了但文本被去重');
  }
  
  if (flow.audioAggregator.shouldReturnEmpty) {
    flow.issues.push('AudioAggregator返回空结果');
  }
  
  jobFlows.set(jobId, flow);
}

// ============================================================
// 输出诊断报告
// ============================================================
console.log('\n📋 第一部分：问题分类\n');
console.log('-'.repeat(120));

// 问题1：AudioAggregator问题
const audioAggregatorIssues = Array.from(jobFlows.values()).filter(f => 
  f.audioAggregator.hasAllocation && !f.dispatcher.hasMerge
);

console.log(`\n1️⃣ AudioAggregator问题（有分配但无Dispatcher记录）: ${audioAggregatorIssues.length} 个`);
for (const flow of audioAggregatorIssues) {
  console.log(`   Job: ${flow.jobId}`);
  console.log(`     分配的originalJobIds: ${JSON.stringify(flow.audioAggregator.originalJobIds)}`);
  console.log(`     问题: 音频被分配了，但ASR结果没有被Dispatcher合并`);
  console.log(`     可能原因:`);
  console.log(`       - ASR处理失败，没有返回结果`);
  console.log(`       - originalJobIds分配错误，ASR结果被发送到其他job`);
  console.log(`       - 音频太短，被AudioAggregator丢弃（shouldReturnEmpty=true）`);
  console.log('');
}

// 问题2：Dispatcher问题
const dispatcherIssues = Array.from(jobFlows.values()).filter(f => 
  f.dispatcher.hasMerge && (!f.dispatcher.mergedText || f.dispatcher.isPartial)
);

console.log(`\n2️⃣ Dispatcher问题（合并了但文本为空或部分）: ${dispatcherIssues.length} 个`);
for (const flow of dispatcherIssues) {
  console.log(`   Job: ${flow.jobId}`);
  if (!flow.dispatcher.mergedText) {
    console.log(`     问题: Dispatcher合并了但文本为空`);
  }
  if (flow.dispatcher.isPartial) {
    console.log(`     问题: Dispatcher合并了但标记为部分结果（isPartial=true）`);
  }
  console.log(`     批次数量: ${flow.dispatcher.batchCount}`);
  console.log(`     缺失批次: ${flow.dispatcher.missingCount}`);
  console.log('');
}

// 问题3：Aggregation问题
const aggregationIssues = Array.from(jobFlows.values()).filter(f => 
  f.aggregation.hasProcessing && (f.aggregation.shouldDiscard || f.aggregation.deduped)
);

console.log(`\n3️⃣ UtteranceAggregator问题（文本被丢弃或去重）: ${aggregationIssues.length} 个`);
for (const flow of aggregationIssues) {
  console.log(`   Job: ${flow.jobId}`);
  if (flow.aggregation.shouldDiscard) {
    console.log(`     问题: 文本被丢弃（shouldDiscard=true）`);
  }
  if (flow.aggregation.deduped) {
    console.log(`     问题: 文本被去重（deduped=true）`);
  }
  if (flow.aggregation.aggregatedText) {
    console.log(`     聚合文本: "${flow.aggregation.aggregatedText}"`);
  }
  console.log('');
}

// ============================================================
// 关键发现
// ============================================================
console.log('\n📋 第二部分：关键发现\n');
console.log('-'.repeat(120));

// 检查MaxDuration finalize的剩余音频处理
const maxDurationJobs = [];
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('maxduration') && log.remainingAudioDurationMs) {
    maxDurationJobs.push({
      jobId: log.jobId || log.job_id,
      remainingAudioDurationMs: log.remainingAudioDurationMs,
      time: log.time ? new Date(log.time).toISOString() : 'N/A',
    });
  }
}

console.log(`\n🔍 MaxDuration finalize剩余音频:`);
console.log(`   找到 ${maxDurationJobs.length} 个MaxDuration finalize事件有剩余音频\n`);

for (const item of maxDurationJobs) {
  console.log(`   Job: ${item.jobId}`);
  console.log(`     剩余音频: ${item.remainingAudioDurationMs}ms`);
  console.log(`     时间: ${item.time}`);
  
  // 检查这个剩余音频是否在后续job中被合并
  const merged = relevantLogs.some(log => {
    const msg = (log.msg || '').toLowerCase();
    return msg.includes('merging pendingmaxdurationaudio') && 
           (log.jobId === item.jobId || log.job_id === item.jobId);
  });
  
  if (merged) {
    console.log(`     ✅ 已在后续job中合并`);
  } else {
    console.log(`     ❌ 未找到合并记录，可能丢失`);
  }
  console.log('');
}

// ============================================================
// 总结
// ============================================================
console.log('\n📋 第三部分：问题总结\n');
console.log('='.repeat(120));

const totalJobs = jobFlows.size;
const audioAggIssues = audioAggregatorIssues.length;
const dispatcherIssuesCount = dispatcherIssues.length;
const aggregationIssuesCount = aggregationIssues.length;

console.log(`\n统计:`);
console.log(`  总job数: ${totalJobs}`);
console.log(`  AudioAggregator问题: ${audioAggIssues}`);
console.log(`  Dispatcher问题: ${dispatcherIssuesCount}`);
console.log(`  UtteranceAggregator问题: ${aggregationIssuesCount}`);
console.log(`  MaxDuration剩余音频: ${maxDurationJobs.length}`);

console.log(`\n🎯 根本原因分析:`);
console.log(`\n1. AudioAggregator层面:`);
if (audioAggIssues > 0) {
  console.log(`   ❌ 有 ${audioAggIssues} 个job的音频被分配了，但ASR结果没有被Dispatcher合并`);
  console.log(`      可能原因:`);
  console.log(`      - originalJobIds分配错误`);
  console.log(`      - ASR处理失败，没有返回结果`);
  console.log(`      - 音频太短被丢弃`);
} else {
  console.log(`   ✅ AudioAggregator的originalJobIds分配正常`);
}

console.log(`\n2. Dispatcher层面:`);
if (dispatcherIssuesCount > 0) {
  console.log(`   ❌ 有 ${dispatcherIssuesCount} 个job的文本合并有问题`);
  console.log(`      可能原因:`);
  console.log(`      - ASR批次丢失（missingCount > 0）`);
  console.log(`      - 部分结果（isPartial=true）`);
} else {
  console.log(`   ✅ Dispatcher的文本合并正常`);
}

console.log(`\n3. UtteranceAggregator层面:`);
if (aggregationIssuesCount > 0) {
  console.log(`   ❌ 有 ${aggregationIssuesCount} 个job的文本被丢弃或去重`);
  console.log(`      可能原因:`);
  console.log(`      - 文本太短被过滤（shouldDiscard=true）`);
  console.log(`      - 文本被误判为重复（deduped=true）`);
} else {
  console.log(`   ✅ UtteranceAggregator的处理正常`);
}

console.log(`\n4. MaxDuration finalize:`);
if (maxDurationJobs.length > 0) {
  console.log(`   ⚠️  有 ${maxDurationJobs.length} 个MaxDuration finalize事件有剩余音频`);
  console.log(`      需要检查剩余音频是否在后续job中正确合并`);
} else {
  console.log(`   ✅ 没有MaxDuration finalize剩余音频问题`);
}

console.log('\n' + '='.repeat(120));
console.log('\n💡 建议:');
console.log('  1. 检查AudioAggregator的originalJobIds分配逻辑');
console.log('  2. 检查ASR失败处理，确保空结果也能正确分发');
console.log('  3. 检查MaxDuration finalize后的剩余音频合并逻辑');
console.log('  4. 检查UtteranceAggregator的去重和过滤逻辑');
