/**
 * Console Logger Bridge
 * 将console.log/warn/error的输出也保存到logger系统
 */

import { logger } from '../logger';

// 保存原始的console方法
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

// 是否已经初始化
let isInitialized = false;
// 标记是否正在记录日志（防止递归）
let isLogging = false;

/**
 * 初始化console日志桥接
 * 将所有console输出也保存到logger系统
 */
export function initConsoleLoggerBridge(): void {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  // 重写console.log
  console.log = (...args: any[]) => {
    originalConsoleLog(...args);
    
    // 防止递归调用
    if (isLogging) {
      return;
    }
    // 将console.log也保存到logger
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    // 检查是否是关键日志（包含特定标记）
    const isKeyLog = message.includes('[App]') || 
                     message.includes('[StateMachine]') || 
                     message.includes('[TtsPlayer]') ||
                     message.includes('[SessionManager]') ||
                     message.includes('[AudioSender]') ||
                     message.includes('播放完成') ||
                     message.includes('State transition') ||
                     message.includes('TTS_PLAY_ENDED') ||
                     message.includes('恢复录音') ||
                     message.includes('静音检测') ||
                     message.includes('发送 finalize') ||
                     message.includes('首次发送音频chunk') ||
                     message.includes('playbackFinished') ||
                     message.includes('RestartTimer');
    
    // 跳过来自 logger 本身的日志，防止无限递归
    if (message.includes('[Logger]') || message.includes('[ConsoleLoggerBridge]') || message.includes('[Console]')) {
      return;
    }
    
    // 所有关键日志都保存到logger系统
    try {
      isLogging = true;
      if (isKeyLog) {
        logger.info('Console', message, args.length > 1 ? args.slice(1) : undefined);
      } else {
        // 非关键日志也保存，但使用debug级别
        logger.debug('Console', message, args.length > 1 ? args.slice(1) : undefined);
      }
    } catch (error) {
      // 忽略logger错误，避免阻塞console输出
    } finally {
      isLogging = false;
    }
  };

  // 重写console.warn - 但禁用桥接，因为会导致无限递归
  console.warn = (...args: any[]) => {
    originalConsoleWarn(...args);
    // 暂时禁用 console.warn 的桥接，因为会导致无限递归
    // logger.warn 会调用 console.warn，导致循环调用
    // TODO: 需要重构 logger 使其不直接调用 console.warn
  };

  // 重写console.error - 但禁用桥接，因为会导致无限递归
  console.error = (...args: any[]) => {
    originalConsoleError(...args);
    // 暂时禁用 console.error 的桥接，因为会导致无限递归
    // logger.error 会调用 console.error，导致循环调用
    // TODO: 需要重构 logger 使其不直接调用 console.error
  };

  // 重写console.info
  console.info = (...args: any[]) => {
    originalConsoleInfo(...args);
    
    // 防止递归调用
    if (isLogging) {
      return;
    }
    
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    // 跳过来自 logger 本身的日志
    if (message.includes('[Logger]') || message.includes('[ConsoleLoggerBridge]') || message.includes('[Console]')) {
      return;
    }
    
    try {
      isLogging = true;
      logger.info('Console', message, args.length > 1 ? args.slice(1) : undefined);
    } catch (error) {
      // 忽略logger错误
    } finally {
      isLogging = false;
    }
  };

  // 重写console.debug
  console.debug = (...args: any[]) => {
    originalConsoleDebug(...args);
    
    // 防止递归调用
    if (isLogging) {
      return;
    }
    
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    // 跳过来自 logger 本身的日志
    if (message.includes('[Logger]') || message.includes('[ConsoleLoggerBridge]') || message.includes('[Console]')) {
      return;
    }
    
    try {
      isLogging = true;
      logger.debug('Console', message, args.length > 1 ? args.slice(1) : undefined);
    } catch (error) {
      // 忽略logger错误
    } finally {
      isLogging = false;
    }
  };
}
