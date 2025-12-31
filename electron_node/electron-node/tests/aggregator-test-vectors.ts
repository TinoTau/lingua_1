/**
 * Aggregator 测试向量自动化测试
 * 使用 test_vectors.json 进行自动化测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { AggregatorManager } from '../main/src/aggregator';
import { SegmentInfo } from '../main/src/task-router/types';

interface TestVector {
  id: string;
  mode: 'offline' | 'room';
  prev: {
    text: string;
    start_ms: number;
    end_ms: number;
    lang: {
      top1: string;
      p1: number;
      top2?: string;
      p2?: number;
    };
    quality_score: number;
    is_final: boolean;
    is_manual_cut: boolean;
  };
  curr: {
    text: string;
    start_ms: number;
    end_ms: number;
    lang: {
      top1: string;
      p1: number;
      top2?: string;
      p2?: number;
    };
    quality_score: number;
    is_final: boolean;
    is_manual_cut: boolean;
  };
  expected_action: 'MERGE' | 'NEW_STREAM';
}

function loadTestVectors(): TestVector[] {
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(__dirname, '../../docs/AGGREGATOR/test_vectors.json'),  // 从 tests/ 目录
    path.join(__dirname, '../../../docs/AGGREGATOR/test_vectors.json'),  // 从 main/electron-node/tests/ 目录（编译后）
    path.join(process.cwd(), 'docs/AGGREGATOR/test_vectors.json'),  // 从项目根目录
    path.join(process.cwd(), '../docs/AGGREGATOR/test_vectors.json'),  // 从 electron-node 目录
  ];
  
  for (const vectorsPath of possiblePaths) {
    if (fs.existsSync(vectorsPath)) {
      const content = fs.readFileSync(vectorsPath, 'utf-8');
      return JSON.parse(content);
    }
  }
  
  throw new Error(`无法找到 test_vectors.json 文件。尝试的路径: ${possiblePaths.join(', ')}`);
}

function runTestVector(vector: TestVector): { passed: boolean; actual: string; error?: string } {
  try {
    const manager = new AggregatorManager();
    const sessionId = `test-${vector.id}`;

    // 处理第一个 utterance
    const prevSegments: SegmentInfo[] = [
      {
        text: vector.prev.text,
        start: vector.prev.start_ms / 1000,
        end: vector.prev.end_ms / 1000,
      },
    ];

    manager.processUtterance(
      sessionId,
      vector.prev.text,
      prevSegments,
      vector.prev.lang,
      vector.prev.quality_score,
      vector.prev.is_final,
      vector.prev.is_manual_cut,
      vector.mode
    );

    // 处理第二个 utterance
    const currSegments: SegmentInfo[] = [
      {
        text: vector.curr.text,
        start: vector.curr.start_ms / 1000,
        end: vector.curr.end_ms / 1000,
      },
    ];

    const result = manager.processUtterance(
      sessionId,
      vector.curr.text,
      currSegments,
      vector.curr.lang,
      vector.curr.quality_score,
      vector.curr.is_final,
      vector.curr.is_manual_cut,
      vector.mode
    );

    const passed = result.action === vector.expected_action;
    return {
      passed,
      actual: result.action,
    };
  } catch (error: any) {
    return {
      passed: false,
      actual: 'ERROR',
      error: error.message,
    };
  }
}

function runAllTestVectors() {
  console.log('开始运行 Aggregator 测试向量...\n');

  const vectors = loadTestVectors();
  let passedCount = 0;
  let failedCount = 0;

  for (const vector of vectors) {
    const result = runTestVector(vector);
    const status = result.passed ? '✅' : '❌';
    console.log(`${status} ${vector.id}:`);
    console.log(`  预期: ${vector.expected_action}`);
    console.log(`  实际: ${result.actual}`);
    if (result.error) {
      console.log(`  错误: ${result.error}`);
    }
    console.log('');

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  console.log('=== 测试结果汇总 ===');
  console.log(`总计: ${vectors.length}`);
  console.log(`通过: ${passedCount}`);
  console.log(`失败: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  runAllTestVectors();
}

export { runAllTestVectors };

