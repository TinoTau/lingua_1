/**
 * 日志辅助工具
 * 用于从浏览器控制台获取和导出日志
 */

import { logger } from '../logger';

/**
 * 获取所有控制台日志（通过重写console方法）
 */
export function captureConsoleLogs(): Array<{ timestamp: string; level: string; message: string; data?: any }> {
  const logs: Array<{ timestamp: string; level: string; message: string; data?: any }> = [];
  
  // 保存原始的console方法
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  
  // 重写console方法
  const captureLog = (level: string) => {
    return (...args: any[]) => {
      const timestamp = new Date().toISOString();
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
      
      logs.push({
        timestamp,
        level,
        message,
        data: args.length > 1 ? args.slice(1) : undefined,
      });
      
      // 调用原始方法
      switch (level) {
        case 'error':
          originalError(...args);
          break;
        case 'warn':
          originalWarn(...args);
          break;
        case 'info':
          originalInfo(...args);
          break;
        case 'debug':
          originalDebug(...args);
          break;
        default:
          originalLog(...args);
      }
    };
  };
  
  console.log = captureLog('log') as any;
  console.error = captureLog('error') as any;
  console.warn = captureLog('warn') as any;
  console.info = captureLog('info') as any;
  console.debug = captureLog('debug') as any;
  
  return logs;
}

/**
 * 导出所有日志到文件
 */
export async function exportAllLogs(): Promise<void> {
  try {
    // 导出IndexedDB中的日志
    await logger.exportLogs();
    
    // 提示用户
    console.log('[LogHelper] 日志已导出到文件');
  } catch (error) {
    console.error('[LogHelper] 导出日志失败:', error);
  }
}

/**
 * 在window对象上暴露日志工具
 */
export function exposeLogHelper(): void {
  (window as any).logHelper = {
    exportLogs: exportAllLogs,
    logger: logger,
  };
  
  console.log('[LogHelper] 日志工具已暴露到 window.logHelper');
  console.log('[LogHelper] 使用方法: window.logHelper.exportLogs()');
}
