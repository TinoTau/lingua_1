/**
 * 从节点端 electron-main.log 中检查各服务是否使用了 GPU
 *
 * 用法: node scripts/check-gpu-usage-in-log.js [log-file-path]
 *
 * 示例:
 *   node scripts/check-gpu-usage-in-log.js logs/electron-main.log
 */

const fs = require('fs');
const path = require('path');

const logFilePath = process.argv[2] || path.join(__dirname, '../logs/electron-main.log');

if (!fs.existsSync(logFilePath)) {
  console.error('日志文件不存在:', logFilePath);
  console.error('用法: node scripts/check-gpu-usage-in-log.js [log-file-path]');
  process.exit(1);
}

const content = fs.readFileSync(logFilePath, 'utf-8');
const lines = content.split('\n').filter((l) => l.trim());

const gpuArbiterInit = [];
const gpuLeaseAcquired = [];
const gpuLeaseSkipped = [];
const gpuLeaseTimeout = [];
const gpuLeaseFallbackCpu = [];

for (const line of lines) {
  try {
    const log = JSON.parse(line);
    const msg = log.msg || '';
    if (msg.includes('GpuArbiter initialized')) {
      gpuArbiterInit.push(log);
    } else if (msg.includes('GPU lease acquired (task will run on GPU)')) {
      gpuLeaseAcquired.push(log);
    } else if (msg.includes('GPU lease skipped')) {
      gpuLeaseSkipped.push(log);
    } else if (msg.includes('GPU lease timeout')) {
      gpuLeaseTimeout.push(log);
    } else if (msg.includes('GPU lease fallback to CPU')) {
      gpuLeaseFallbackCpu.push(log);
    }
  } catch (_) {}
}

console.log('='.repeat(80));
console.log('节点端日志 GPU 使用检查');
console.log('日志文件:', logFilePath);
console.log('='.repeat(80));

if (gpuArbiterInit.length === 0) {
  console.log('\n[!] 未找到 "GpuArbiter initialized" —— 可能 GPU 仲裁器未启用或日志来自旧版本');
} else {
  const last = gpuArbiterInit[gpuArbiterInit.length - 1];
  const enabled = last.enabled === true;
  const gpuKeys = last.gpuKeys || [];
  console.log('\n[GPU 仲裁器]');
  console.log('  enabled:', enabled);
  console.log('  gpuKeys:', gpuKeys.join(', ') || '—');
  if (enabled && gpuKeys.length > 0) {
    console.log('  => 节点端已启用 GPU 仲裁，ASR/NMT/TTS 会通过租约使用 GPU');
  } else {
    console.log('  => 仲裁器未启用或未配置 GPU，不会打 "GPU lease acquired" 日志');
  }
}

console.log('\n[GPU 租约获取]');
console.log('  GPU lease acquired (task will run on GPU):', gpuLeaseAcquired.length, '次');
if (gpuLeaseAcquired.length > 0) {
  const byType = {};
  for (const log of gpuLeaseAcquired) {
    const t = log.taskType || '?';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log('  按 taskType 统计:', byType);
  console.log('  示例（最近 5 条）:');
  gpuLeaseAcquired.slice(-5).forEach((entry, i) => {
    console.log(
      '   ',
      i + 1,
      '|',
      entry.taskType,
      '|',
      entry.jobId || entry.job_id || '—',
      '|',
      'utt:',
      entry.utteranceIndex ?? entry.utterance_index ?? '—',
      '|',
      'queueWaitMs:',
      entry.queueWaitMs ?? '—'
    );
  });
}

if (gpuLeaseSkipped.length > 0) {
  console.log('\n  [!] GPU lease skipped:', gpuLeaseSkipped.length, '次');
  gpuLeaseSkipped.slice(-3).forEach((log) => console.log('      ', log.taskType, log.reason, log.jobId || log.job_id));
}
if (gpuLeaseTimeout.length > 0) {
  console.log('\n  [!] GPU lease timeout:', gpuLeaseTimeout.length, '次');
}
if (gpuLeaseFallbackCpu.length > 0) {
  console.log('\n  [!] GPU lease fallback to CPU:', gpuLeaseFallbackCpu.length, '次');
}

console.log('\n' + '='.repeat(80));
console.log('说明:');
console.log('  - 语义修复由独立 Python 服务内部使用 GPU，节点只发 HTTP，不会出现 "GPU lease acquired"');
console.log('  - 同音纠错为 CPU 服务，不使用 GPU');
console.log('  - 各服务端 GPU 确认请查看 docs/GPU_USAGE_VERIFICATION.md');
console.log('='.repeat(80));
