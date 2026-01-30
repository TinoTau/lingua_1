// Mock logger for testing
import { jest } from '@jest/globals';

// 临时启用日志输出，用于排查T1-T3
// 始终输出包含T1/T2/T3或testCase: 'R0/R1'的日志
const logInfo = (contextOrMessage: any, message?: string) => {
  // logger.info 可能有两种调用方式：
  // 1. logger.info(context, message)
  // 2. logger.info(message)
  let context: any;
  let msg: string;
  
  if (typeof contextOrMessage === 'string') {
    // 只有 message，没有 context
    msg = contextOrMessage;
    context = {};
  } else {
    // 有 context 和 message
    context = contextOrMessage;
    msg = message || '';
  }
  
  // 检查是否包含排查标记
  const hasT1T2T3 = typeof msg === 'string' && (msg.includes('[T1]') || msg.includes('[T2]') || msg.includes('[T3]'));
  const hasTestCase = context?.testCase === 'R0/R1';
  
  if (hasT1T2T3 || hasTestCase) {
    // 输出到console.error，确保不会被Jest过滤
    console.error('[TEST_LOG]', JSON.stringify({ context, message: msg }, null, 2));
  }
};

export default {
  info: logInfo,
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => console.log('[DEBUG]', ...args),
  trace: (...args: any[]) => console.log('[TRACE]', ...args),
};

