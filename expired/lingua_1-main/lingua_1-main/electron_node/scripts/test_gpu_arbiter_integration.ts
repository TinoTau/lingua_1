/**
 * GPU仲裁器集成测试
 * 用于在实际运行环境中测试GPU仲裁器功能
 */

import { getGpuArbiter } from '../electron-node/main/src/gpu-arbiter/gpu-arbiter-factory';
import { withGpuLease, tryAcquireGpuLease } from '../electron-node/main/src/gpu-arbiter/gpu-lease-helper';
import { loadNodeConfig } from '../electron-node/main/src/node-config';

async function testGpuArbiterIntegration() {
  console.log('=== GPU仲裁器集成测试 ===\n');

  // 1. 检查配置
  console.log('1. 检查配置...');
  const config = loadNodeConfig();
  console.log(`   GPU仲裁器启用状态: ${config.gpuArbiter?.enabled ?? false}`);
  console.log(`   GPU Keys: ${config.gpuArbiter?.gpuKeys?.join(', ') ?? 'N/A'}`);
  console.log(`   默认队列限制: ${config.gpuArbiter?.defaultQueueLimit ?? 'N/A'}`);
  console.log(`   默认最大持有时间: ${config.gpuArbiter?.defaultHoldMaxMs ?? 'N/A'}ms\n`);

  // 2. 获取GPU仲裁器实例
  console.log('2. 获取GPU仲裁器实例...');
  const arbiter = getGpuArbiter();
  if (!arbiter) {
    console.log('   ⚠ GPU仲裁器未启用或未初始化');
    console.log('   请在配置文件中设置 gpuArbiter.enabled = true\n');
    return;
  }
  console.log('   ✓ GPU仲裁器实例已获取\n');

  // 3. 测试基本功能
  console.log('3. 测试基本功能...');
  
  // 3.1 测试withGpuLease
  console.log('   3.1 测试 withGpuLease...');
  try {
    const result = await withGpuLease(
      'ASR',
      async (lease) => {
        console.log(`      ✓ 获取租约: ${lease.leaseId}`);
        console.log(`      ✓ GPU Key: ${lease.gpuKey}`);
        console.log(`      ✓ 任务类型: ${lease.taskType}`);
        // 模拟处理时间
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'test-result';
      },
      {
        jobId: 'test-job-1',
        sessionId: 'test-session',
        utteranceIndex: 0,
        stage: 'ASR',
      }
    );
    console.log(`      ✓ 任务完成，结果: ${result}\n`);
  } catch (error: any) {
    console.log(`      ✗ 错误: ${error.message}\n`);
  }

  // 3.2 测试tryAcquireGpuLease
  console.log('   3.2 测试 tryAcquireGpuLease...');
  try {
    const lease = await tryAcquireGpuLease('NMT', {
      jobId: 'test-job-2',
      sessionId: 'test-session',
      utteranceIndex: 1,
      stage: 'NMT',
    });
    if (lease) {
      console.log(`      ✓ 获取租约: ${lease.leaseId}`);
      // 模拟使用
      await new Promise(resolve => setTimeout(resolve, 50));
      lease.release();
      console.log(`      ✓ 租约已释放\n`);
    } else {
      console.log(`      ⚠ 未能获取租约（GPU可能忙碌）\n`);
    }
  } catch (error: any) {
    console.log(`      ✗ 错误: ${error.message}\n`);
  }

  // 4. 测试并发场景
  console.log('4. 测试并发场景...');
  const concurrentTasks = 5;
  console.log(`   启动 ${concurrentTasks} 个并发任务...`);
  
  const tasks = Array.from({ length: concurrentTasks }, (_, i) =>
    withGpuLease(
      'ASR',
      async (lease) => {
        const taskId = `task-${i + 1}`;
        console.log(`     ${taskId}: 获取租约 ${lease.leaseId}`);
        await new Promise(resolve => setTimeout(resolve, 200));
        console.log(`     ${taskId}: 完成`);
        return taskId;
      },
      {
        jobId: `test-job-${i + 1}`,
        sessionId: 'test-session',
        utteranceIndex: i,
        stage: 'ASR',
      }
    ).catch((error: any) => {
      console.log(`     task-${i + 1}: 失败 - ${error.message}`);
      return null;
    })
  );

  const results = await Promise.all(tasks);
  const successCount = results.filter(r => r !== null).length;
  console.log(`   ✓ 完成: ${successCount}/${concurrentTasks} 个任务成功\n`);

  // 5. 获取快照
  console.log('5. 获取GPU仲裁器快照...');
  const snapshot = arbiter.snapshot('gpu:0');
  if (snapshot) {
    console.log(`   当前租约: ${snapshot.currentLease ? snapshot.currentLease.leaseId : '无'}`);
    console.log(`   队列长度: ${snapshot.queueLength}`);
    console.log(`   指标:`);
    console.log(`     - ACQUIRED: ${snapshot.metrics.acquireTotal.ACQUIRED}`);
    console.log(`     - SKIPPED: ${snapshot.metrics.acquireTotal.SKIPPED}`);
    console.log(`     - FALLBACK_CPU: ${snapshot.metrics.acquireTotal.FALLBACK_CPU}`);
    console.log(`     - 超时次数: ${snapshot.metrics.timeoutsTotal}`);
    console.log(`     - 队列满次数: ${snapshot.metrics.queueFullTotal}`);
  } else {
    console.log('   ⚠ 无法获取快照（无效的GPU key）');
  }

  console.log('\n=== 测试完成 ===');
}

// 运行测试
if (require.main === module) {
  testGpuArbiterIntegration().catch(console.error);
}

export { testGpuArbiterIntegration };
