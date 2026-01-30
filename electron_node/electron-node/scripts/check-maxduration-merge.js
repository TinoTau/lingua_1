/**
 * 检查MaxDuration finalize后的剩余音频合并情况
 */

const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, '../logs/electron-main.log');
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

// 查找MaxDuration finalize和合并记录
const maxDurationFinalize = [];
const maxDurationMerge = [];

for (const log of logs) {
  const msg = (log.msg || '').toLowerCase();
  if (msg.includes('maxduration finalize processed first 5+ seconds') && log.remainingAudioDurationMs) {
    maxDurationFinalize.push({
      time: log.time,
      jobId: log.jobId || log.job_id,
      remainingAudioDurationMs: log.remainingAudioDurationMs,
    });
  }
  if (msg.includes('merging pendingmaxdurationaudio')) {
    maxDurationMerge.push({
      time: log.time,
      jobId: log.jobId || log.job_id,
      pendingAudioDurationMs: log.pendingAudioDurationMs,
      currentAudioDurationMs: log.currentAudioDurationMs,
      mergedAudioDurationMs: log.mergedAudioDurationMs,
    });
  }
}

console.log('='.repeat(120));
console.log('MaxDuration Finalize 剩余音频合并检查');
console.log('='.repeat(120));

console.log(`\n找到 ${maxDurationFinalize.length} 个MaxDuration finalize事件（有剩余音频）`);
console.log(`找到 ${maxDurationMerge.length} 个MaxDuration音频合并记录\n`);

// 匹配finalize和merge
for (const finalize of maxDurationFinalize) {
  console.log(`\nMaxDuration Finalize:`);
  console.log(`  Job: ${finalize.jobId}`);
  console.log(`  剩余音频: ${finalize.remainingAudioDurationMs}ms`);
  console.log(`  时间: ${new Date(finalize.time).toISOString()}`);
  
  // 查找后续的合并记录
  const merge = maxDurationMerge.find(m => {
    // 查找在finalize之后，且可能是同一个session的合并
    return m.time > finalize.time;
  });
  
  if (merge) {
    console.log(`  ✅ 找到合并记录:`);
    console.log(`     合并Job: ${merge.jobId}`);
    console.log(`     Pending音频: ${merge.pendingAudioDurationMs}ms`);
    console.log(`     当前音频: ${merge.currentAudioDurationMs}ms`);
    console.log(`     合并后音频: ${merge.mergedAudioDurationMs}ms`);
    
    // 检查合并后的音频是否被处理
    const afterMerge = logs.filter(l => {
      const time = l.time || 0;
      const msg = (l.msg || '').toLowerCase();
      return time > merge.time && 
             (l.jobId === merge.jobId || l.job_id === merge.jobId) &&
             (msg.includes('asr') || msg.includes('textmerge') || msg.includes('merged asr'));
    });
    
    if (afterMerge.length > 0) {
      console.log(`     ✅ 合并后的音频已被处理（找到 ${afterMerge.length} 条后续记录）`);
      for (const log of afterMerge.slice(0, 3)) {
        const msg = (log.msg || '').toLowerCase();
        if (msg.includes('textmerge')) {
          console.log(`        合并文本: "${log.mergedTextPreview || ''}"`);
        }
      }
    } else {
      console.log(`     ❌ 合并后的音频未被处理（没有找到后续ASR记录）`);
    }
  } else {
    console.log(`  ❌ 未找到合并记录，剩余音频可能丢失`);
  }
}

console.log('\n' + '='.repeat(120));
