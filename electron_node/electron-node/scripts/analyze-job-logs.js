/**
 * Job处理日志分析工具
 * 
 * 使用方法：
 *   node scripts/analyze-job-logs.js [log-file-path] [session-id] [job-id-pattern]
 * 
 * 示例：
 *   node scripts/analyze-job-logs.js logs/electron-main.log "session-123" "job"
 * 
 * 功能：
 * 1. 解析日志文件，提取所有与指定session/job相关的日志
 * 2. 按时间顺序组织日志
 * 3. 标识每个job在各个服务中的处理流程
 * 4. 显示输入输出信息
 */

const fs = require('fs');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
const logFilePath = args[0] || path.join(__dirname, '../logs/electron-main.log');
const sessionIdFilter = args[1]; // 可选的session_id过滤
const jobIdPattern = args[2] || 'job'; // job_id模式

if (!fs.existsSync(logFilePath)) {
  console.error(`❌ 日志文件不存在: ${logFilePath}`);
  console.log('\n提示：请提供日志文件路径，例如：');
  console.log('  node scripts/analyze-job-logs.js logs/electron-main.log "session-123"');
  process.exit(1);
}

console.log(`📖 读取日志文件: ${logFilePath}`);
console.log(`🔍 过滤条件: sessionId=${sessionIdFilter || '全部'}, jobId模式=${jobIdPattern}\n`);

// 读取日志文件
const logContent = fs.readFileSync(logFilePath, 'utf-8');
const lines = logContent.split('\n').filter(line => line.trim());

// 解析JSON日志行
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
  // 检查是否包含job相关信息
  const hasJobInfo = log.jobId || log.job_id || 
                     (log.msg && log.msg.includes('job')) ||
                     (log.msg && log.msg.includes('Job')) ||
                     (log.msg && log.msg.includes('utterance'));
  
  if (!hasJobInfo) return false;
  
  // 检查session_id过滤
  if (sessionIdFilter) {
    const sessionId = log.sessionId || log.session_id || log.session;
    if (sessionId && !sessionId.includes(sessionIdFilter)) {
      return false;
    }
  }
  
  // 检查job_id模式
  const jobId = log.jobId || log.job_id;
  if (jobId && !jobId.includes(jobIdPattern)) {
    return false;
  }
  
  return true;
});

// 按时间排序
relevantLogs.sort((a, b) => {
  const timeA = a.time || a.timestamp || 0;
  const timeB = b.time || b.timestamp || 0;
  return timeA - timeB;
});

// 按job分组
const jobsMap = new Map();

for (const log of relevantLogs) {
  const jobId = log.jobId || log.job_id || 'unknown';
  const utteranceIndex = log.utteranceIndex || log.utterance_index || log.utterance || -1;
  const key = `${jobId}-${utteranceIndex}`;
  
  if (!jobsMap.has(key)) {
    jobsMap.set(key, {
      jobId,
      utteranceIndex,
      logs: [],
      services: new Set(),
    });
  }
  
  const jobInfo = jobsMap.get(key);
  jobInfo.logs.push(log);
  
  // 识别服务类型
  const msg = log.msg || '';
  if (msg.includes('AudioAggregator')) {
    jobInfo.services.add('AudioAggregator');
  }
  if (msg.includes('ASR') || msg.includes('InferenceService') || msg.includes('inference')) {
    jobInfo.services.add('ASR');
  }
  if (msg.includes('AggregationStage') || msg.includes('aggregation')) {
    jobInfo.services.add('Aggregation');
  }
  if (msg.includes('NMT') || msg.includes('translation')) {
    jobInfo.services.add('NMT');
  }
  if (msg.includes('SemanticRepair') || msg.includes('semantic')) {
    jobInfo.services.add('SemanticRepair');
  }
}

// 输出分析结果
console.log('='.repeat(80));
console.log(`📊 找到 ${jobsMap.size} 个job的处理记录\n`);

// 按utteranceIndex排序
const sortedJobs = Array.from(jobsMap.values()).sort((a, b) => {
  if (a.utteranceIndex !== b.utteranceIndex) {
    return a.utteranceIndex - b.utteranceIndex;
  }
  return a.jobId.localeCompare(b.jobId);
});

for (const jobInfo of sortedJobs) {
  console.log('='.repeat(80));
  console.log(`📦 Job: ${jobInfo.jobId} | UtteranceIndex: ${jobInfo.utteranceIndex}`);
  console.log(`🔧 涉及服务: ${Array.from(jobInfo.services).join(', ') || '未知'}`);
  console.log(`📝 日志数量: ${jobInfo.logs.length}\n`);
  
  // 按时间顺序显示关键日志
  const keyLogs = jobInfo.logs.filter(log => {
    const msg = (log.msg || '').toLowerCase();
    return msg.includes('processing') ||
           msg.includes('result') ||
           msg.includes('output') ||
           msg.includes('input') ||
           msg.includes('audio') ||
           msg.includes('text') ||
           msg.includes('error') ||
           msg.includes('finalize') ||
           msg.includes('aggregated') ||
           log.level >= 40; // warn/error级别
  });
  
  for (const log of keyLogs) {
    const time = log.time ? new Date(log.time).toISOString() : 'N/A';
    const level = log.level === 10 ? 'DEBUG' : 
                  log.level === 20 ? 'INFO' : 
                  log.level === 30 ? 'WARN' : 
                  log.level === 40 ? 'ERROR' : 'UNKNOWN';
    const msg = log.msg || '';
    
    console.log(`  [${level}] ${time}`);
    console.log(`    ${msg}`);
    
    // 显示关键字段
    const importantFields = [
      'audioSegments', 'audioSegmentsCount', 'text', 'text_asr', 'aggregatedText',
      'originalJobIds', 'shouldReturnEmpty', 'isTimeoutPending',
      'totalDurationMs', 'chunkCount', 'bufferKey', 'state',
      'action', 'shouldDiscard', 'shouldWaitForMerge',
      'hasMergedPendingAudio', 'inputAudioDurationMs', 'outputSegmentCount',
      'error', 'reason'
    ];
    
    for (const field of importantFields) {
      if (log[field] !== undefined) {
        const value = typeof log[field] === 'object' ? JSON.stringify(log[field]) : log[field];
        if (value && value.toString().length < 200) {
          console.log(`    ${field}: ${value}`);
        }
      }
    }
    
    console.log('');
  }
  
  // 检查是否有错误
  const errors = jobInfo.logs.filter(log => log.level >= 40);
  if (errors.length > 0) {
    console.log(`  ⚠️  发现 ${errors.length} 个错误/警告:`);
    for (const err of errors) {
      console.log(`    - ${err.msg || JSON.stringify(err)}`);
    }
    console.log('');
  }
}

console.log('='.repeat(80));
console.log('\n💡 提示：');
console.log('  - 如果某些job没有日志，可能是：');
console.log('    1. 音频被聚合到其他job中（检查originalJobIds）');
console.log('    2. 文本被去重过滤（检查shouldDiscard=true）');
console.log('    3. 音频太短被丢弃（检查shouldReturnEmpty=true）');
console.log('    4. 处理失败但没有记录错误日志');
console.log('\n  - 检查缺失的job（如[2], [6], [8]）：');
console.log('    1. 查看相邻job的originalJobIds，看是否被合并');
console.log('    2. 查看AudioAggregator的finalize日志，看是否有pending音频');
console.log('    3. 查看AggregationStage的去重日志，看是否被过滤');
