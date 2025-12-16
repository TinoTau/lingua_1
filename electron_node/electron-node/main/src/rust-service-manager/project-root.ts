import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import logger from '../logger';

export interface ProjectPaths {
  projectRoot: string;
  servicePath: string;
  logDir: string;
}

/**
 * 查找项目根目录和相关路径
 */
export function findProjectPaths(): ProjectPaths {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (!isDev) {
    // 生产环境：以应用安装路径为根目录
    // electron-builder 已将 inference-service.exe 放在安装路径根目录
    const projectRoot = path.dirname(process.execPath);
    return {
      projectRoot,
      servicePath: path.join(projectRoot, 'inference-service.exe'),
      logDir: path.join(projectRoot, 'electron_node', 'services', 'node-inference', 'logs'),
    };
  }

  // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
  // 在 Electron 中：
  // - process.cwd() 可能是 electron-node 目录或项目根目录
  // - __dirname 是编译后的 JS 文件位置（electron-node/main）
  // - 项目根目录需要包含 electron_node/services/node-inference 目录

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

  // 去重并检查哪个路径包含 electron_node/services/node-inference 目录
  const uniqueCandidates = Array.from(new Set(candidates));
  for (const candidate of uniqueCandidates) {
    const nodeInferencePath = path.join(candidate, 'electron_node', 'services', 'node-inference');
    if (fs.existsSync(nodeInferencePath)) {
      const projectRoot = candidate;
      const servicePath = path.join(
        projectRoot,
        'electron_node',
        'services',
        'node-inference',
        'target',
        'release',
        'inference-service.exe'
      );
      logger.info(
        {
          __dirname,
          cwd: process.cwd(),
          projectRoot,
          servicePath,
        },
        'Rust 服务管理器：找到项目根目录'
      );
      return {
        projectRoot,
        servicePath,
        logDir: path.join(projectRoot, 'electron_node', 'services', 'node-inference', 'logs'),
      };
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

