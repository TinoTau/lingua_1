// ===== 工具方法 =====

import * as os from 'os';
import * as fs from 'fs/promises';

/**
 * 检查文件是否存在
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 查找替代路径（非 C 盘）
 */
export function findAlternativePath(): string | null {
  if (os.platform() === 'win32') {
    const fs = require('fs');
    const drives = ['D', 'E', 'F', 'G', 'H'];
    for (const drive of drives) {
      const testPath = `${drive}:\\LinguaNode`;
      try {
        if (!fs.existsSync(testPath)) {
          fs.mkdirSync(testPath, { recursive: true });
        }
        return testPath;
      } catch {
        // 继续尝试下一个盘
      }
    }
  }
  return null;
}

/**
 * 延迟函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: any): boolean {
  return error.code === 'ECONNRESET' ||
         error.code === 'ETIMEDOUT' ||
         error.code === 'ENOTFOUND' ||
         error.response?.status >= 500;
}

/**
 * 获取错误阶段
 */
export function getErrorStage(error: any): 'network' | 'disk' | 'checksum' | 'unknown' {
  // 网络错误
  if (error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.response?.status >= 500) {
    return 'network';
  }
  
  // 磁盘错误
  if (error.code === 'ENOSPC' || 
      error.code === 'EACCES' ||
      error.code === 'EIO' ||
      error.code === 'EROFS') {
    return 'disk';
  }
  
  // 校验错误
  if (error.message?.includes('校验') || 
      error.message?.includes('checksum') ||
      error.message?.includes('SHA256') ||
      error.message?.includes('大小不匹配')) {
    return 'checksum';
  }
  
  return 'unknown';
}

