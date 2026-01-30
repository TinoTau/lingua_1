/**
 * 文本丢失诊断工具
 * 专门分析为什么某些job的文本丢失
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

console.log(`📖 诊断文本丢失问题\n`);
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
// 问题1：检查MaxDuration finalize后的剩余音频处理
// ============================================================
console.log('\n🔍 问题1：MaxDuration finalize后的剩余音频处理\n');
console.log('-'.repeat(120));

const maxDurationEvents = [];
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('maxduration') || log.state === 'PENDING_MAXDUR') {
    maxDurationEvents.push({
      time: log.time ? new Date(log.time).toISOString() : 'N/A',
      jobId: log.jobId || log.job_id,
      msg: log.msg,
      state: log.state,
      remainingAudioDurationMs: log.remainingAudioDurationMs,
      processedBatchesCount: log.processedBatchesCount,
      reason: log.reason,
    });
  }
}

console.log(`找到 ${maxDurationEvents.length} 个MaxDuration相关事件\n`);

for (const event of maxDurationEvents) {
  console.log(`[${event.time}] ${event.msg}`);
  console.log(`  JobId: ${event.jobId}`);
  if (event.state) {
    console.log(`  状态: ${event.state}`);
  }
  if (event.remainingAudioDurationMs) {
    console.log(`  剩余音频时长: ${event.remainingAudioDurationMs}ms`);
  }
  if (event.processedBatchesCount) {
    console.log(`  已处理批次: ${event.processedBatchesCount}`);
  }
  console.log('');
}

// ============================================================
// 问题2：检查空文本的job
// ============================================================
console.log('\n🔍 问题2：空文本的job\n');
console.log('-'.repeat(120));

const emptyTextJobs = new Set();
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('textmerge') || msg.includes('merged asr batches')) {
    const mergedText = log.mergedTextPreview || '';
    if (!mergedText || mergedText.trim().length === 0) {
      const jobId = log.originalJobId;
      if (jobId) {
        emptyTextJobs.add(jobId);
      }
    }
  }
}

console.log(`找到 ${emptyTextJobs.size} 个空文本的job\n`);

for (const jobId of emptyTextJobs) {
  console.log(`Job: ${jobId}`);
  
  // 查找这个job的所有相关日志
  const jobLogs = relevantLogs.filter(log => {
    return (log.jobId === jobId || log.job_id === jobId || log.originalJobId === jobId) ||
           (log.originalJobIds && log.originalJobIds.includes(jobId));
  });
  
  // 查找ASR输入输出
  let asrInput = null;
  let asrOutput = null;
  let audioAggregator = null;
  
  for (const log of jobLogs) {
    const msg = (log.msg || '').toLowerCase();
    if (msg.includes('asr input')) {
      asrInput = log;
    }
    if (msg.includes('asr output') || msg.includes('asr service returned')) {
      asrOutput = log;
    }
    if (msg.includes('audioaggregator') && log.originalJobIds) {
      audioAggregator = log;
    }
  }
  
  if (audioAggregator) {
    console.log(`  AudioAggregator分配: ${JSON.stringify(audioAggregator.originalJobIds)}`);
  }
  
  if (asrInput) {
    console.log(`  ASR输入: 有`);
  } else {
    console.log(`  ASR输入: ❌ 无`);
  }
  
  if (asrOutput) {
    console.log(`  ASR输出: 有`);
    if (asrOutput.text || asrOutput.text_asr) {
      console.log(`   文本: "${(asrOutput.text || asrOutput.text_asr).substring(0, 50)}"`);
    } else {
      console.log(`   文本: ❌ 空`);
    }
  } else {
    console.log(`  ASR输出: ❌ 无`);
  }
  
  console.log('');
}

// ============================================================
// 问题3：检查被合并但未处理的job
// ============================================================
console.log('\n🔍 问题3：被合并但未处理的job\n');
console.log('-'.repeat(120));

// 收集所有被分配的originalJobIds
const assignedJobIds = new Set();
const assignedByJob = new Map();

for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('audioaggregator') && log.originalJobIds) {
    const currentJobId = log.jobId || log.job_id;
    if (currentJobId) {
      assignedByJob.set(currentJobId, log.originalJobIds);
      for (const id of log.originalJobIds) {
        assignedJobIds.add(id);
      }
    }
  }
}

// 检查哪些job被分配了但没有Dispatcher记录
const missingDispatcherJobs = [];
for (const jobId of assignedJobIds) {
  const hasDispatcher = relevantLogs.some(log => {
    const msg = (log.msg || '').toLowerCase();
    return (msg.includes('textmerge') || msg.includes('merged asr batches')) &&
           log.originalJobId === jobId;
  });
  
  if (!hasDispatcher) {
    // 查找是哪个job分配了这个originalJobId
    let assignedBy = null;
    for (const [currentJobId, originalJobIds] of assignedByJob.entries()) {
      if (originalJobIds.includes(jobId)) {
        assignedBy = currentJobId;
        break;
      }
    }
    
    missingDispatcherJobs.push({
      jobId,
      assignedBy,
    });
  }
}

console.log(`找到 ${missingDispatcherJobs.length} 个被分配但没有Dispatcher记录的job\n`);

for (const item of missingDispatcherJobs) {
  console.log(`Job: ${item.jobId}`);
  console.log(`  被分配到: ${item.assignedBy}`);
  console.log(`  问题: 有AudioAggregator分配，但没有Dispatcher文本合并记录`);
  console.log(`  可能原因:`);
  console.log(`    1. ASR处理失败，没有返回结果`);
  console.log(`    2. originalJobIds分配错误，ASR结果被发送到其他job`);
  console.log(`    3. 音频太短，被AudioAggregator丢弃`);
  console.log('');
}

// ============================================================
// 问题4：检查文本截断
// ============================================================
console.log('\n🔍 问题4：文本截断问题\n');
console.log('-'.repeat(120));

const truncatedJobs = [];
for (const log of relevantLogs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('textmerge') || msg.includes('merged asr batches')) {
    const mergedText = log.mergedTextPreview || '';
    // 检查文本是否以不完整的方式结束（没有标点符号，且长度较短）
    if (mergedText && mergedText.length > 0) {
      const trimmed = mergedText.trim();
      const endsWithPunctuation = /[。，！？、；：.!?,;:]$/.test(trimmed);
      const isShort = trimmed.length < 30;
      
      // 检查是否以常见的不完整模式结尾
      const incompletePatterns = [
        /我$/, /的$/, /了$/, /在$/, /是$/, /有$/, /会$/, /能$/, /要$/, /我们$/, /这个$/, /那个$/,
        /问题$/, /方法$/, /系统$/, /服务$/, /结果$/, /原因$/, /效果$/
      ];
      
      let matchesIncomplete = false;
      for (const pattern of incompletePatterns) {
        if (pattern.test(trimmed)) {
          matchesIncomplete = true;
          break;
        }
      }
      
      if ((!endsWithPunctuation && isShort) || matchesIncomplete) {
        truncatedJobs.push({
          jobId: log.originalJobId,
          text: mergedText,
          length: mergedText.length,
          reason: !endsWithPunctuation && isShort ? '短文本且无标点' : '不完整模式',
        });
      }
    }
  }
}

console.log(`找到 ${truncatedJobs.length} 个可能截断的文本\n`);

for (const item of truncatedJobs) {
  console.log(`Job: ${item.jobId}`);
  console.log(`  文本: "${item.text}"`);
  console.log(`  长度: ${item.length} 字符`);
  console.log(`  原因: ${item.reason}`);
  console.log(`  可能问题:`);
  console.log(`    1. MaxDuration finalize后剩余音频未处理`);
  console.log(`    2. 音频被切分，但后续片段丢失`);
  console.log(`    3. ASR识别不完整`);
  console.log('');
}

// ============================================================
// 总结
// ============================================================
console.log('\n📊 诊断总结\n');
console.log('='.repeat(120));

console.log(`统计:`);
console.log(`  MaxDuration事件: ${maxDurationEvents.length}`);
console.log(`  空文本job: ${emptyTextJobs.size}`);
console.log(`  缺失Dispatcher的job: ${missingDispatcherJobs.length}`);
console.log(`  文本截断的job: ${truncatedJobs.length}`);
console.log('');

console.log('💡 关键发现:');
if (maxDurationEvents.length > 0) {
  console.log(`  1. 有 ${maxDurationEvents.length} 个MaxDuration finalize事件，需要检查剩余音频是否被正确处理`);
}
if (emptyTextJobs.size > 0) {
  console.log(`  2. 有 ${emptyTextJobs.size} 个job的ASR结果为空，可能是音频质量问题或ASR失败`);
}
if (missingDispatcherJobs.length > 0) {
  console.log(`  3. 有 ${missingDispatcherJobs.length} 个job被AudioAggregator分配但没有Dispatcher记录，可能是originalJobIds分配问题`);
}
if (truncatedJobs.length > 0) {
  console.log(`  4. 有 ${truncatedJobs.length} 个job的文本可能被截断，需要检查MaxDuration finalize后的剩余音频处理`);
}

console.log('\n🔧 建议修复方向:');
console.log('  1. 检查MaxDuration finalize后，剩余音频是否在下一个job中正确合并');
console.log('  2. 检查originalJobIds分配逻辑，确保所有job都被正确分配');
console.log('  3. 检查ASR失败处理，确保空结果也能正确分发');
console.log('  4. 检查AudioAggregator的流式切分，确保所有音频段都被处理');
