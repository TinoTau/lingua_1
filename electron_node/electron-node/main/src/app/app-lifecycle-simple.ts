/**
 * 应用生命周期管理（简化版）
 * 仅依赖 ServiceProcessRunner + NodeAgent，无废弃的 Python/Rust 独立 manager。
 */

import { app } from 'electron';
import { loadNodeConfig, saveNodeConfig, type ServicePreferences } from '../node-config';
import { getServiceRunner } from '../service-layer';
import { cleanupEsbuild } from '../utils/esbuild-cleanup';

let isCleaningUp = false;
let cleanupCompleted = false;

const SERVICE_ID_TO_PREF: Record<string, keyof ServicePreferences> = {
  'nmt-m2m100': 'nmtEnabled',
  'piper-tts': 'ttsEnabled',
  'your-tts': 'yourttsEnabled',
  'faster-whisper-vad': 'fasterWhisperVadEnabled',
  'speaker-embedding': 'speakerEmbeddingEnabled',
  'semantic-repair-en-zh': 'semanticRepairEnZhEnabled',
  'phonetic-correction-zh': 'phoneticCorrectionEnabled',
  'punctuation-restore': 'punctuationRestoreEnabled',
};

function saveCurrentServiceState(): void {
  const config = loadNodeConfig();
  const runner = getServiceRunner();
  if (runner) {
    for (const s of runner.getAllStatuses()) {
      const key = SERVICE_ID_TO_PREF[s.serviceId];
      if (key) (config.servicePreferences as unknown as Record<string, boolean>)[key] = s.status === 'running';
    }
  }
  saveNodeConfig(config);
}

async function stopAllServices(nodeAgent: any | null): Promise<void> {
  const runner = getServiceRunner();
  if (runner) await runner.stopAll();
  if (nodeAgent) nodeAgent.stop();
}

async function cleanupAppResources(getNodeAgent: () => any): Promise<void> {
  if (isCleaningUp || cleanupCompleted) return;
  isCleaningUp = true;
  try {
    saveCurrentServiceState();
    await stopAllServices(getNodeAgent());
    cleanupEsbuild();
    cleanupCompleted = true;
  } finally {
    isCleaningUp = false;
  }
}

export function registerWindowAllClosedHandler(getNodeAgent: () => any): void {
  app.on('window-all-closed', () => {
    // 关闭最后一个窗口时退出应用，触发 before-quit 以执行 stopAllServices 等清理
    app.quit();
  });
}

export function registerBeforeQuitHandler(getNodeAgent: () => any): void {
  app.on('before-quit', async (event) => {
    if (cleanupCompleted) return;
    event.preventDefault();
    try {
      await cleanupAppResources(getNodeAgent);
    } catch (err) {
      console.error('Cleanup failed:', err);
      process.exit(1);
    }
    app.quit();
  });
}

export function registerProcessSignalHandlers(getNodeAgent: () => any): void {
  const handle = async (signal: string) => {
    console.log('Received signal:', signal);
    try {
      await cleanupAppResources(getNodeAgent);
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => handle('SIGTERM'));
  process.on('SIGINT', () => handle('SIGINT'));
}

export function registerExceptionHandlers(getNodeAgent: () => any): void {
  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught exception:', error);
    try {
      await cleanupAppResources(getNodeAgent);
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
    process.exit(1);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled rejection (non-fatal):', reason);
  });
}
