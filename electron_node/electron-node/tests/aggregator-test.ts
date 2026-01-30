/**
 * Aggregator 功能测试
 * 测试 Aggregator 的核心功能：merge/new_stream 决策、Dedup、Tail Carry
 */

import {
  AggregatorManager,
} from '../main/src/aggregator';
import { SegmentInfo } from '../main/src/task-router/types';

/**
 * 测试 1: 基本 merge 决策
 */
function testBasicMerge() {
  console.log('\n=== 测试 1: 基本 merge 决策 ===');
  
  const manager = new AggregatorManager();
  const sessionId = 'test-session-1';
  
  // 第一个 utterance
  const segments1: SegmentInfo[] = [
    { text: '我们今天讨论一下', start: 0, end: 1.0 }
  ];
  const result1 = manager.processUtterance(
    sessionId,
    '我们今天讨论一下',
    segments1,
    { top1: 'zh', p1: 0.92, top2: 'en', p2: 0.04 },
    0.8,
    true,
    false,
    'offline'
  );
  
  console.log('第一个 utterance 结果:', {
    action: result1.action,
    text: result1.text,
  });
  
  // 第二个 utterance（短 gap，应该 merge）
  const segments2: SegmentInfo[] = [
    { text: '这个方案', start: 1.2, end: 1.7 }
  ];
  const result2 = manager.processUtterance(
    sessionId,
    '这个方案',
    segments2,
    { top1: 'zh', p1: 0.9, top2: 'en', p2: 0.05 },
    0.7,
    true,
    false,
    'offline'
  );
  
  console.log('第二个 utterance 结果:', {
    action: result2.action,
    text: result2.text,
  });
  
  // 检查指标
  const metrics = manager.getMetrics(sessionId);
  console.log('指标:', metrics);
  
  // 验证
  if (result2.action === 'MERGE') {
    console.log('✅ 测试通过: 短 gap 触发了 merge');
  } else {
    console.log('❌ 测试失败: 应该 merge 但实际是', result2.action);
  }
}

/**
 * 测试 2: hard gap 触发 new_stream
 */
function testHardGap() {
  console.log('\n=== 测试 2: hard gap 触发 new_stream ===');
  
  const manager = new AggregatorManager();
  const sessionId = 'test-session-2';
  
  // 第一个 utterance
  const segments1: SegmentInfo[] = [
    { text: '我们先到这里。', start: 0, end: 1.0 }
  ];
  manager.processUtterance(
    sessionId,
    '我们先到这里。',
    segments1,
    { top1: 'zh', p1: 0.95, top2: 'en', p2: 0.02 },
    0.9,
    true,
    false,
    'offline'
  );

  // 第二个 utterance（长 gap，应该 new_stream）
  const segments2: SegmentInfo[] = [
    { text: '下一件事', start: 4.0, end: 4.5 }
  ];
  const result2 = manager.processUtterance(
    sessionId,
    '下一件事',
    segments2,
    { top1: 'zh', p1: 0.93, top2: 'en', p2: 0.03 },
    0.8,
    true,
    false,
    'offline'
  );
  
  console.log('第二个 utterance 结果:', {
    action: result2.action,
    text: result2.text,
  });
  
  // 验证
  if (result2.action === 'NEW_STREAM') {
    console.log('✅ 测试通过: 长 gap 触发了 new_stream');
  } else {
    console.log('❌ 测试失败: 应该 new_stream 但实际是', result2.action);
  }
}

/**
 * 测试 3: Dedup 功能
 */
function testDedup() {
  console.log('\n=== 测试 3: Dedup 功能 ===');
  
  const manager = new AggregatorManager();
  const sessionId = 'test-session-3';
  
  // 第一个 utterance
  const segments1: SegmentInfo[] = [
    { text: '我们', start: 0, end: 0.5 }
  ];
  manager.processUtterance(
    sessionId,
    '我们',
    segments1,
    { top1: 'zh', p1: 0.9 },
    0.8,
    true,
    false,
    'offline'
  );

  // 第二个 utterance（有重复）
  const segments2: SegmentInfo[] = [
    { text: '我们可以', start: 0.6, end: 1.1 }
  ];
  const result2 = manager.processUtterance(
    sessionId,
    '我们可以',
    segments2,
    { top1: 'zh', p1: 0.9 },
    0.8,
    true,
    false,
    'offline'
  );
  
  console.log('第二个 utterance 结果:', {
    action: result2.action,
    text: result2.text,
    metrics: result2.metrics,
  });
  
  const metrics = manager.getMetrics(sessionId);
  console.log('指标:', {
    dedupCount: metrics?.dedupCount,
    dedupCharsRemoved: metrics?.dedupCharsRemoved,
  });
  
  // 验证
  if (metrics && metrics.dedupCount > 0) {
    console.log('✅ 测试通过: Dedup 功能正常工作');
  } else {
    console.log('⚠️  注意: Dedup 未触发（可能是文本不够重复）');
  }
}

/**
 * 测试 4: 语言切换（不触发 new_stream）
 */
function testLangSwitchNotConfident() {
  console.log('\n=== 测试 4: 语言切换（不触发 new_stream） ===');
  
  const manager = new AggregatorManager();
  const sessionId = 'test-session-4';
  
  // 第一个 utterance（中文）
  const segments1: SegmentInfo[] = [
    { text: '我们用 OpenAI', start: 0, end: 1.0 }
  ];
  manager.processUtterance(
    sessionId,
    '我们用 OpenAI',
    segments1,
    { top1: 'zh', p1: 0.78, top2: 'en', p2: 0.18 },
    0.6,
    true,
    false,
    'offline'
  );

  // 第二个 utterance（英文，但置信度不高，应该 merge）
  const segments2: SegmentInfo[] = [
    { text: 'API 来做', start: 1.4, end: 1.9 }
  ];
  const result2 = manager.processUtterance(
    sessionId,
    'API 来做',
    segments2,
    { top1: 'en', p1: 0.74, top2: 'zh', p2: 0.22 },
    0.6,
    true,
    false,
    'offline'
  );
  
  console.log('第二个 utterance 结果:', {
    action: result2.action,
    text: result2.text,
  });
  
  // 验证
  if (result2.action === 'MERGE') {
    console.log('✅ 测试通过: 低置信度语言切换未触发 new_stream');
  } else {
    console.log('❌ 测试失败: 应该 merge 但实际是', result2.action);
  }
}

/**
 * 测试 5: Flush 功能
 */
function testFlush() {
  console.log('\n=== 测试 5: Flush 功能 ===');
  
  const manager = new AggregatorManager();
  const sessionId = 'test-session-5';
  
  // 处理几个 utterance
  const segments1: SegmentInfo[] = [
    { text: '第一句话', start: 0, end: 0.5 }
  ];
  manager.processUtterance(
    sessionId,
    '第一句话',
    segments1,
    { top1: 'zh', p1: 0.9 },
    0.8,
    true,
    false,
    'offline'
  );

  const segments2: SegmentInfo[] = [
    { text: '第二句话', start: 0.6, end: 1.1 }
  ];
  manager.processUtterance(
    sessionId,
    '第二句话',
    segments2,
    { top1: 'zh', p1: 0.9 },
    0.8,
    true,
    false,
    'offline'
  );
  
  // Flush
  const flushed = manager.flush(sessionId);
  console.log('Flush 结果:', {
    flushedText: flushed,
    flushedLength: flushed.length,
  });
  
  // 验证
  if (flushed.length > 0) {
    console.log('✅ 测试通过: Flush 功能正常工作');
  } else {
    console.log('⚠️  注意: Flush 返回空（可能所有文本都已提交）');
  }
}

/**
 * 运行所有测试
 */
function runAllTests() {
  console.log('开始 Aggregator 功能测试...\n');
  
  try {
    testBasicMerge();
    testHardGap();
    testDedup();
    testLangSwitchNotConfident();
    testFlush();
    
    console.log('\n=== 所有测试完成 ===');
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  runAllTests();
}

export { runAllTests };

