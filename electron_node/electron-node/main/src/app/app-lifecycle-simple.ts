/**
 * 应用生命周期管理模块（简化版）
 * 确保在任何情况下都能正确停止所有进程并保存配置
 */

import { app } from 'electron';
import { loadNodeConfig, saveNodeConfig } from '../node-config';
import { getServiceRunner } from '../service-layer';
import { cleanupEsbuild } from '../utils/esbuild-cleanup';
import logger from '../logger';
import type { RustServiceManager } from '../rust-service-manager';
import type { PythonServiceManager } from '../python-service-manager';

// 全局清理标志，防止重复清理
let isCleaningUp = false;
let cleanupCompleted = false;

/**
 * 保存当前服务状态到配置
 * 在清理开始时立即执行，确保不会丢失
 */
function saveCurrentServiceState(
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): void {
  try {
    const config = loadNodeConfig();
    
    // 保存 Rust 服务状态
    const rustStatus = rustServiceManager?.getStatus();
    config.servicePreferences.rustEnabled = !!rustStatus?.running;
    
    // 保存 Python 服务状态
    const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
    config.servicePreferences.nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
    config.servicePreferences.ttsEnabled = !!pythonStatuses.find(s => s.name === 'tts')?.running;
    config.servicePreferences.yourttsEnabled = !!pythonStatuses.find(s => s.name === 'yourtts')?.running;
    config.servicePreferences.fasterWhisperVadEnabled = !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running;
    config.servicePreferences.speakerEmbeddingEnabled = !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running;
    
    // 保存语义修复服务状态
    const runner = getServiceRunner();
    if (runner) {
      const semanticServices = runner.getAllStatuses().filter((s: any) => s.type === 'semantic');
      
      for (const service of semanticServices) {
        const isRunning = service.status === 'running';
        
        switch (service.serviceId) {
          case 'semantic-repair-zh':
            config.servicePreferences.semanticRepairZhEnabled = isRunning;
            break;
          case 'semantic-repair-en':
            config.servicePreferences.semanticRepairEnEnabled = isRunning;
            break;
          case 'en-normalize':
            config.servicePreferences.enNormalizeEnabled = isRunning;
            break;
          case 'semantic-repair-en-zh':
            config.servicePreferences.semanticRepairEnZhEnabled = isRunning;
            break;
        }
      }
    }
    
    saveNodeConfig(config);
    console.log('✅ Service preferences saved');
  } catch (error) {
    console.error('❌ Failed to save service preferences:', error);
  }
}

/**
 * 停止所有服务
 * 按顺序停止：语义修复 -> Python -> Rust -> NodeAgent
 */
async function stopAllServices(
  nodeAgent: any | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): Promise<void> {
  const stopPromises: Promise<void>[] = [];
  
  // 1. 停止语义修复等其他服务（通过 ServiceProcessRunner）
  const runner = getServiceRunner();
  if (runner) {
    const runningServices = runner.getAllStatuses().filter(
      (s: any) => s.status === 'running' || s.status === 'starting'
    );
    
    if (runningServices.length > 0) {
      console.log('Stopping services via runner...');
      stopPromises.push(
        runner.stopAll().catch((error: any) => {
          console.error('Failed to stop services via runner:', error);
        })
      );
    }
  }
  
  // 2. 停止 Python 服务
  if (pythonServiceManager) {
    const pythonStatuses = pythonServiceManager.getAllServiceStatuses() || [];
    const runningPython = pythonStatuses.filter(s => s.running);
    
    if (runningPython.length > 0) {
      console.log('Stopping Python services...');
      stopPromises.push(
        pythonServiceManager.stopAllServices().catch(error => {
          console.error('Failed to stop Python services:', error);
        })
      );
    }
  }
  
  // 3. 停止 Rust 服务
  if (rustServiceManager) {
    const rustStatus = rustServiceManager.getStatus();
    if (rustStatus?.running) {
      console.log('Stopping Rust service...');
      stopPromises.push(
        rustServiceManager.stop().catch(error => {
          console.error('Failed to stop Rust service:', error);
        })
      );
    }
  }
  
  // 等待所有服务停止（最多10秒）
  if (stopPromises.length > 0) {
    await Promise.race([
      Promise.all(stopPromises),
      new Promise(resolve => setTimeout(resolve, 10000))  // 10秒超时
    ]);
  }
  
  // 4. 停止 NodeAgent
  if (nodeAgent) {
    try {
      console.log('Stopping NodeAgent...');
      nodeAgent.stop();
    } catch (error) {
      console.error('Failed to stop NodeAgent:', error);
    }
  }
}

/**
 * 清理应用资源
 * 1. 立即保存配置
 * 2. 停止所有服务
 * 3. 清理其他资源
 */
async function cleanupAppResources(
  nodeAgent: any | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): Promise<void> {
  // 防止重复清理
  if (isCleaningUp) {
    console.warn('Cleanup already in progress, skipping...');
    return;
  }
  
  if (cleanupCompleted) {
    console.warn('Cleanup already completed, skipping...');
    return;
  }
  
  isCleaningUp = true;
  
  console.log('========================================');
  console.log('🛑 Starting application cleanup...');
  console.log('========================================');
  
  try {
    // 1. 立即保存配置（最重要，先做）
    saveCurrentServiceState(rustServiceManager, pythonServiceManager);
    
    // 2. 停止所有服务
    await stopAllServices(nodeAgent, rustServiceManager, pythonServiceManager);
    
    // 3. 清理其他资源
    cleanupEsbuild();
    
    cleanupCompleted = true;
    
    console.log('========================================');
    console.log('✅ Application cleanup completed');
    console.log('========================================');
  } catch (error) {
    console.error('❌ Cleanup failed with error:', error);
  } finally {
    isCleaningUp = false;
  }
}

/**
 * Day 5: registerWindowCloseHandler 已删除
 * 窗口关闭逻辑统一由 registerWindowAllClosedHandler 处理
 */

/**
 * 注册 window-all-closed 事件处理
 * 这是主要的清理入口点
 */
export function registerWindowAllClosedHandler(
  nodeAgent: any | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): void {
  app.on('window-all-closed', async () => {
    console.warn('⚠️  All windows closed - this should not happen in normal operation!');
    console.warn('⚠️  If this happens immediately after startup, check window loading errors');
    
    // 临时：不自动退出，方便调试
    console.log('✋ Auto-quit disabled for debugging. Press Ctrl+C to exit.');
    
    // await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager);
    
    // macOS 之外的平台直接退出（暂时禁用）
    // if (process.platform !== 'darwin') {
    //   app.quit();
    // }
  });
}

/**
 * 注册 before-quit 事件处理
 * 作为备用清理点
 */
export function registerBeforeQuitHandler(
  nodeAgent: any | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): void {
  app.on('before-quit', async () => {
    console.log('Application before-quit event');
    
    // 如果还没清理过，执行清理
    if (!cleanupCompleted) {
      await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager);
    }
  });
}

/**
 * 注册进程信号处理器
 * 处理 SIGTERM 和 SIGINT
 */
export function registerProcessSignalHandlers(
  nodeAgent: any | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): void {
  const handleSignal = async (signal: string) => {
    console.log('Received signal:', signal);
    
    await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager);
    process.exit(0);
  };
  
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}

/**
 * 注册异常处理器
 * 处理 uncaughtException 和 unhandledRejection
 */
export function registerExceptionHandlers(
  nodeAgent: any | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): void {
  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught exception:', error);
    
    await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled rejection (non-fatal):', reason);
    // 不退出应用，只记录错误
  });
}
