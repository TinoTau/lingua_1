/**
 * 日志系统
 * 将日志写入文件，支持不同级别的日志
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: any;
}

export interface LogConfig {
  autoSaveToFile?: boolean;
  autoSaveIntervalMs?: number;
  logFilePrefix?: string;
}

export class Logger {
  private static instance: Logger;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize: number = 1000; // 最大缓冲区大小
  private flushInterval: number = 5000; // 每5秒刷新一次
  private currentLogFile: string = '';
  private logLevel: LogLevel = LogLevel.INFO;
  private logConfig: LogConfig = {};
  private autoSaveIntervalId: number | null = null;
  private lastAutoSaveTime: number = 0;

  private constructor() {
    this.currentLogFile = `web-client-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    // 定期刷新日志到IndexedDB
    setInterval(() => this.flushLogs(), this.flushInterval);
    // 页面卸载时刷新日志
    window.addEventListener('beforeunload', () => {
      this.flushLogs();
      // 如果启用了自动保存，在页面卸载时也保存一次
      if (this.logConfig.autoSaveToFile) {
        this.exportLogs().catch(err => {
          console.error('Failed to auto-save logs on page unload:', err);
        });
      }
    });
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * 设置日志配置
   */
  public setLogConfig(config: LogConfig): void {
    this.logConfig = { ...this.logConfig, ...config };
    
    // 如果启用了自动保存，启动定时器
    if (this.logConfig.autoSaveToFile) {
      this.startAutoSave();
    } else {
      this.stopAutoSave();
    }
    
    // 更新日志文件前缀
    if (this.logConfig.logFilePrefix) {
      this.currentLogFile = `${this.logConfig.logFilePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    }
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    this.stopAutoSave(); // 先停止现有的定时器
    
    const intervalMs = this.logConfig.autoSaveIntervalMs || 30000;
    
    if (intervalMs > 0) {
      // 定期自动保存
      this.autoSaveIntervalId = window.setInterval(() => {
        this.exportLogs().catch(err => {
          console.error('Failed to auto-save logs:', err);
        });
      }, intervalMs);
    }
    
    this.lastAutoSaveTime = Date.now();
    console.log('[Logger] 自动保存已启用', {
      autoSaveIntervalMs: intervalMs,
      logFilePrefix: this.logConfig.logFilePrefix || 'web-client',
    });
  }

  /**
   * 停止自动保存
   */
  private stopAutoSave(): void {
    if (this.autoSaveIntervalId !== null) {
      clearInterval(this.autoSaveIntervalId);
      this.autoSaveIntervalId = null;
    }
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private addLog(level: LogLevel, levelName: string, module: string, message: string, data?: any): void {
    if (level < this.logLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level: levelName,
      module,
      message,
      data: data ? JSON.stringify(data, null, 2) : undefined,
    };

    this.logBuffer.push(entry);

    // 如果缓冲区满了，刷新日志
    if (this.logBuffer.length >= this.maxBufferSize) {
      this.flushLogs();
    }

    // 同时输出到控制台（用于开发调试）
    const consoleMethod = level === LogLevel.ERROR ? 'error' :
                         level === LogLevel.WARN ? 'warn' :
                         level === LogLevel.DEBUG ? 'debug' : 'log';
    const prefix = `[${entry.timestamp}] [${levelName}] [${module}]`;
    if (data) {
      console[consoleMethod](prefix, message, data);
    } else {
      console[consoleMethod](prefix, message);
    }
  }

  public debug(module: string, message: string, data?: any): void {
    this.addLog(LogLevel.DEBUG, 'DEBUG', module, message, data);
  }

  public info(module: string, message: string, data?: any): void {
    this.addLog(LogLevel.INFO, 'INFO', module, message, data);
  }

  public warn(module: string, message: string, data?: any): void {
    this.addLog(LogLevel.WARN, 'WARN', module, message, data);
  }

  public error(module: string, message: string, data?: any): void {
    this.addLog(LogLevel.ERROR, 'ERROR', module, message, data);
  }

  private formatLogEntry(entry: LogEntry): string {
    let line = `${entry.timestamp} [${entry.level}] [${entry.module}] ${entry.message}`;
    if (entry.data) {
      line += `\n${entry.data}`;
    }
    return line;
  }

  private flushLogs(): void {
    if (this.logBuffer.length === 0) {
      return;
    }

    const logsToFlush = this.logBuffer.splice(0);
    const logContent = logsToFlush.map(entry => this.formatLogEntry(entry)).join('\n') + '\n';

    // 使用 IndexedDB 存储日志
    this.saveToIndexedDB(logContent).catch(err => {
      console.error('Failed to save logs to IndexedDB:', err);
    });

    // 如果启用了自动保存且间隔为0（每次flush都保存），则立即保存
    if (this.logConfig.autoSaveToFile && this.logConfig.autoSaveIntervalMs === 0) {
      // 使用setTimeout避免阻塞flush操作
      setTimeout(() => {
        this.exportLogs().catch(err => {
          console.error('Failed to auto-save logs on flush:', err);
        });
      }, 0);
    }
  }

  private async saveToIndexedDB(content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lingua-logs', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['logs'], 'readwrite');
        const store = transaction.objectStore('logs');
        const addRequest = store.add({
          timestamp: new Date().toISOString(),
          content: content,
        });
        addRequest.onsuccess = () => resolve();
        addRequest.onerror = () => reject(addRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('logs')) {
          const objectStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * 导出所有日志到文件
   */
  public async exportLogs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lingua-logs', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['logs'], 'readonly');
        const store = transaction.objectStore('logs');
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          const allLogs = getAllRequest.result;
          const logContent = allLogs
            .map((entry: any) => entry.content)
            .join('\n');

          // 刷新当前缓冲区
          if (this.logBuffer.length > 0) {
            const currentLogs = this.logBuffer.map(entry => this.formatLogEntry(entry)).join('\n') + '\n';
            const fullContent = logContent + '\n' + currentLogs;

            // 下载日志文件
            this.downloadLogFile(fullContent);
            resolve();
          } else {
            this.downloadLogFile(logContent);
            resolve();
          }
        };

        getAllRequest.onerror = () => reject(getAllRequest.error);
      };
    });
  }

  private downloadLogFile(content: string): void {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.currentLogFile;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 清空所有日志
   */
  public async clearLogs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('lingua-logs', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['logs'], 'readwrite');
        const store = transaction.objectStore('logs');
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
          this.logBuffer = [];
          resolve();
        };
        clearRequest.onerror = () => reject(clearRequest.error);
      };
    });
  }
}

// 导出单例实例
export const logger = Logger.getInstance();
