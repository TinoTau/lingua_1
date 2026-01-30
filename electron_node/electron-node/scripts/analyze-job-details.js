/**
 * Job详细处理流程分析工具
 * 
 * 使用方法：
 *   node scripts/analyze-job-details.js [log-file-path] [session-id]
 * 
 * 功能：
 * 1. 显示每个job的完整处理流程
 * 2. 显示每个阶段的输入输出
 * 3. 标识文本丢失的原因
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

// 提取所有job
const jobs = new Set();
for (const log of relevantLogs) {
  if (log.jobId) jobs.add(log.jobId);
  if (log.job_id) jobs.add(log.job_id);
  if (log.originalJobIds) {
    for (const id of log.originalJobIds) {
      jobs.add(id);
    }
  }
}

console.log(`📊 找到 ${jobs.size} 个不同的job\n`);
console.log('='.repeat(100));

// 为每个job创建处理流程
const jobFlows = new Map();

for (const jobId of Array.from(jobs).sort()) {
  const jobLogs = relevantLogs.filter(log => {
    return (log.jobId === jobId || log.job_id === jobId) ||
           (log.originalJobIds && log.originalJobIds.includes(jobId));
  });
  
  if (jobLogs.length === 0) continue;
  
  const flow = {
    jobId,
    stages: {
      audioAggregator: [],
      asr: [],
      aggregation: [],
      nmt: [],
      errors: [],
    },
    inputs: {},
    outputs: {},
  };
  
  for (const log of jobLogs) {
    const msg = (log.msg || '').toLowerCase();
    const time = log.time ? new Date(log.time).toISOString() : 'N/A';
    
    // AudioAggregator阶段
    if (msg.includes('audioaggregator') || msg.includes('audio aggregator')) {
      flow.stages.audioAggregator.push({
        time,
        msg: log.msg,
        bufferKey: log.bufferKey,
        state: log.state,
        audioSegmentsCount: log.audioSegmentsCount,
        originalJobIds: log.originalJobIds,
        inputAudioDurationMs: log.inputAudioDurationMs,
        outputSegmentCount: log.outputSegmentCount,
        shouldReturnEmpty: log.shouldReturnEmpty,
        isTimeoutPending: log.isTimeoutPending,
        totalDurationMs: log.totalDurationMs,
        chunkCount: log.chunkCount,
        hasMergedPendingAudio: log.hasMergedPendingAudio,
        reason: log.reason,
      });
      
      if (log.originalJobIds) {
        flow.inputs.originalJobIds = log.originalJobIds;
      }
      if (log.audioSegmentsCount !== undefined) {
        flow.outputs.audioSegmentsCount = log.audioSegmentsCount;
      }
    }
    
    // ASR阶段
    if (msg.includes('asr') || msg.includes('inference') || msg.includes('faster-whisper')) {
      flow.stages.asr.push({
        time,
        msg: log.msg,
        text: log.text || log.text_asr,
        aggregatedText: log.aggregatedText,
        qualityScore: log.qualityScore || log.quality_score,
        segments: log.segments,
        originalJobIds: log.originalJobIds,
      });
      
      if (log.text || log.text_asr) {
        flow.outputs.asrText = log.text || log.text_asr;
      }
      if (log.aggregatedText) {
        flow.outputs.aggregatedText = log.aggregatedText;
      }
    }
    
    // Aggregation阶段
    if (msg.includes('aggregation') || msg.includes('aggregator')) {
      flow.stages.aggregation.push({
        time,
        msg: log.msg,
        action: log.action,
        aggregatedText: log.aggregatedText,
        originalText: log.originalText,
        shouldDiscard: log.shouldDiscard,
        shouldWaitForMerge: log.shouldWaitForMerge,
        isLastInMergedGroup: log.isLastInMergedGroup,
        deduped: log.deduped,
      });
      
      if (log.aggregatedText) {
        flow.outputs.finalAggregatedText = log.aggregatedText;
      }
    }
    
    // NMT阶段
    if (msg.includes('nmt') || msg.includes('translation')) {
      flow.stages.nmt.push({
        time,
        msg: log.msg,
        text: log.text,
        translatedText: log.translatedText || log.translated_text,
      });
      
      if (log.translatedText || log.translated_text) {
        flow.outputs.translatedText = log.translatedText || log.translated_text;
      }
    }
    
    // 错误
    if (log.level >= 40 || msg.includes('error') || msg.includes('bad segment')) {
      flow.stages.errors.push({
        time,
        msg: log.msg,
        error: log.error,
        reason: log.reason,
      });
    }
  }
  
  jobFlows.set(jobId, flow);
}

// 输出详细流程
for (const [jobId, flow] of Array.from(jobFlows.entries()).sort()) {
  console.log(`\n📦 Job: ${jobId}`);
  console.log('-'.repeat(100));
  
  // AudioAggregator阶段
  if (flow.stages.audioAggregator.length > 0) {
    console.log('\n🎵 AudioAggregator阶段:');
    for (const stage of flow.stages.audioAggregator) {
      console.log(`  [${stage.time}] ${stage.msg}`);
      if (stage.originalJobIds) {
        console.log(`    原始JobIds: ${JSON.stringify(stage.originalJobIds)}`);
      }
      if (stage.inputAudioDurationMs) {
        console.log(`    输入音频时长: ${stage.inputAudioDurationMs}ms`);
      }
      if (stage.outputSegmentCount !== undefined) {
        console.log(`    输出段数: ${stage.outputSegmentCount}`);
      }
      if (stage.shouldReturnEmpty) {
        console.log(`    ⚠️  返回空结果 (shouldReturnEmpty=true)`);
      }
      if (stage.isTimeoutPending) {
        console.log(`    ⚠️  超时等待中 (isTimeoutPending=true)`);
      }
      if (stage.state) {
        console.log(`    状态: ${stage.state}`);
      }
      if (stage.reason) {
        console.log(`    原因: ${stage.reason}`);
      }
    }
  }
  
  // ASR阶段
  if (flow.stages.asr.length > 0) {
    console.log('\n🎤 ASR阶段:');
    for (const stage of flow.stages.asr) {
      console.log(`  [${stage.time}] ${stage.msg}`);
      if (stage.text) {
        console.log(`    ASR文本: "${stage.text}"`);
      }
      if (stage.aggregatedText && stage.aggregatedText !== stage.text) {
        console.log(`    聚合后文本: "${stage.aggregatedText}"`);
      }
      if (stage.qualityScore !== undefined) {
        console.log(`    质量分数: ${stage.qualityScore}`);
      }
    }
  } else {
    console.log('\n🎤 ASR阶段: ❌ 没有ASR处理记录');
  }
  
  // Aggregation阶段
  if (flow.stages.aggregation.length > 0) {
    console.log('\n📝 Aggregation阶段:');
    for (const stage of flow.stages.aggregation) {
      console.log(`  [${stage.time}] ${stage.msg}`);
      if (stage.action) {
        console.log(`    动作: ${stage.action}`);
      }
      if (stage.aggregatedText) {
        console.log(`    聚合文本: "${stage.aggregatedText}"`);
      }
      if (stage.shouldDiscard) {
        console.log(`    ⚠️  文本被丢弃 (shouldDiscard=true)`);
      }
      if (stage.shouldWaitForMerge) {
        console.log(`    ⚠️  等待合并 (shouldWaitForMerge=true)`);
      }
      if (stage.isLastInMergedGroup !== undefined) {
        console.log(`    是否合并组最后: ${stage.isLastInMergedGroup}`);
      }
      if (stage.deduped) {
        console.log(`    ⚠️  文本被去重 (deduped=true)`);
      }
    }
  }
  
  // NMT阶段
  if (flow.stages.nmt.length > 0) {
    console.log('\n🌐 NMT阶段:');
    for (const stage of flow.stages.nmt) {
      console.log(`  [${stage.time}] ${stage.msg}`);
      if (stage.translatedText) {
        console.log(`    翻译文本: "${stage.translatedText}"`);
      }
    }
  }
  
  // 错误
  if (flow.stages.errors.length > 0) {
    console.log('\n❌ 错误/警告:');
    for (const error of flow.stages.errors) {
      console.log(`  [${error.time}] ${error.msg}`);
      if (error.reason) {
        console.log(`    原因: ${error.reason}`);
      }
    }
  }
  
  // 总结
  console.log('\n📊 总结:');
  if (flow.outputs.asrText) {
    console.log(`  ASR输出: "${flow.outputs.asrText}"`);
  } else {
    console.log(`  ASR输出: ❌ 无文本输出`);
  }
  if (flow.outputs.finalAggregatedText) {
    console.log(`  最终聚合文本: "${flow.outputs.finalAggregatedText}"`);
  }
  if (flow.outputs.translatedText) {
    console.log(`  翻译文本: "${flow.outputs.translatedText}"`);
  }
  
  // 检查是否丢失
  const hasAsrButNoOutput = flow.stages.asr.length > 0 && !flow.outputs.asrText;
  const wasDiscarded = flow.stages.aggregation.some(s => s.shouldDiscard);
  const wasDeduped = flow.stages.aggregation.some(s => s.deduped);
  const isEmpty = flow.stages.audioAggregator.some(s => s.shouldReturnEmpty);
  
  if (hasAsrButNoOutput || wasDiscarded || wasDeduped || isEmpty) {
    console.log(`\n  ⚠️  可能的问题:`);
    if (hasAsrButNoOutput) {
      console.log(`    - ASR处理了但没有文本输出`);
    }
    if (wasDiscarded) {
      console.log(`    - 文本被丢弃 (shouldDiscard=true)`);
    }
    if (wasDeduped) {
      console.log(`    - 文本被去重过滤`);
    }
    if (isEmpty) {
      console.log(`    - 音频聚合返回空结果`);
    }
  }
  
  console.log('\n' + '='.repeat(100));
}

console.log('\n💡 分析提示:');
console.log('  1. 如果某个job没有ASR阶段，可能是音频被聚合到其他job中');
console.log('  2. 如果ASR有输出但最终没有文本，检查Aggregation阶段的shouldDiscard或deduped');
console.log('  3. 如果shouldReturnEmpty=true，说明音频太短被丢弃');
console.log('  4. 检查originalJobIds，看多个job是否被合并到一个ASR批次');
