import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import logger from '../logger';

/**
 * 查找项目根目录
 */
export function findProjectRoot(): string {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (!isDev) {
    return path.dirname(process.execPath);
  }

  // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
  // 在 Electron 中：
  // - process.cwd() 可能是 electron-node 目录或项目根目录
  // - __dirname 是编译后的 JS 文件位置（electron-node/main）
  // - 项目根目录需要包含 electron_node/services 目录

  // 从多个可能的路径查找项目根目录
  const cwd = process.cwd();
  const candidates: string[] = [];

  // 1. 从 cwd 向上查找（最多向上3级）
  let currentPath = cwd;
  for (let i = 0; i <= 3; i++) {
    candidates.push(currentPath);
    currentPath = path.resolve(currentPath, '..');
  }

  // 2. 从 __dirname 向上查找（最多向上3级）
  currentPath = __dirname;
  for (let i = 0; i <= 3; i++) {
    candidates.push(currentPath);
    currentPath = path.resolve(currentPath, '..');
  }

  // 去重并检查哪个路径包含 electron_node/services 目录
  const uniqueCandidates = Array.from(new Set(candidates));
  for (const candidate of uniqueCandidates) {
    const servicesPath = path.join(candidate, 'electron_node', 'services');
    if (fs.existsSync(servicesPath)) {
      logger.info(
        {
          __dirname,
          cwd: process.cwd(),
          projectRoot: candidate,
        },
        'Python 服务管理器：找到项目根目录'
      );
      return candidate;
    }
  }

  // 如果都没找到，抛出错误
  const error = `无法找到项目根目录。已检查的路径：${uniqueCandidates.join(', ')}`;
  logger.error(
    {
      __dirname,
      cwd: process.cwd(),
      candidates: uniqueCandidates,
    },
    error
  );
  throw new Error(error);
}

