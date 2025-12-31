/**
 * TTS 播放器内存管理模块
 * 负责内存监控、压力检测和缓存限制
 */

export type MemoryPressureCallback = (pressure: 'normal' | 'warning' | 'critical') => void;

/**
 * 获取最大缓存时长（根据设备类型自适应）
 */
export function getMaxBufferDuration(): number {
  // 统一设置为25秒，保证能直接触发自动播放（80%阈值 = 20秒）
  return 25;
}

/**
 * 获取设备类型描述
 */
export function getDeviceType(): string {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (!isMobile) {
    return '桌面';
  }
  const deviceMemory = (navigator as any).deviceMemory || 0;
  if (deviceMemory >= 6) return '高端手机';
  if (deviceMemory >= 4) return '中端手机';
  if (deviceMemory >= 2) return '低端手机';
  return '老旧手机';
}

/**
 * 内存管理器
 */
export class MemoryManager {
  private memoryPressureCallback: MemoryPressureCallback | null = null;
  private memoryCheckInterval: number | null = null;
  private lastMemoryPressure: 'normal' | 'warning' | 'critical' = 'normal';
  private maxBufferDuration: number;
  private getTotalDuration: () => number;
  private clearBuffers: () => void;
  private removeBuffer: () => void;

  constructor(
    maxBufferDuration: number,
    getTotalDuration: () => number,
    removeBuffer: () => void
  ) {
    this.maxBufferDuration = maxBufferDuration;
    this.getTotalDuration = getTotalDuration;
    this.removeBuffer = removeBuffer;
    this.clearBuffers = () => {
      // 清空所有缓冲区
      const currentDuration = this.getTotalDuration();
      while (this.getTotalDuration() > 0) {
        this.removeBuffer();
      }
    };
  }

  /**
   * 设置内存压力回调
   */
  setMemoryPressureCallback(callback: MemoryPressureCallback): void {
    this.memoryPressureCallback = callback;
  }

  /**
   * 开始内存监控
   */
  startMemoryMonitoring(): void {
    // 停止之前的监控
    this.stopMemoryMonitoring();
    
    // 每2秒检查一次内存
    this.memoryCheckInterval = window.setInterval(() => {
      this.checkMemoryPressure();
    }, 2000);
  }

  /**
   * 停止内存监控
   */
  stopMemoryMonitoring(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  /**
   * 检查内存压力
   */
  private checkMemoryPressure(): void {
    let pressure: 'normal' | 'warning' | 'critical' = 'normal';
    
    // 方法1：使用 Performance API（如果支持）
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const usedMB = memory.usedJSHeapSize / 1048576;
      const limitMB = memory.jsHeapSizeLimit / 1048576;
      const usagePercent = (usedMB / limitMB) * 100;
      
      if (usagePercent >= 80) {
        pressure = 'critical';
      } else if (usagePercent >= 50) {
        pressure = 'warning';
      }
      
      // 调试日志（每10次记录一次，避免日志过多）
      if (Math.random() < 0.1) {
        console.log(`[MemoryManager] 内存使用: ${usagePercent.toFixed(1)}% (${usedMB.toFixed(1)}MB / ${limitMB.toFixed(1)}MB), 压力: ${pressure}`);
      }
    }
    
    // 方法2：根据缓存时长估算内存压力
    const bufferDuration = this.getTotalDuration();
    const bufferDurationPercent = (bufferDuration / this.maxBufferDuration) * 100;
    
    if (bufferDurationPercent >= 80) {
      pressure = 'critical';
    } else if (bufferDurationPercent >= 50 && pressure === 'normal') {
      pressure = 'warning';
    }
    
    // 如果压力状态变化，触发回调
    if (pressure !== this.lastMemoryPressure) {
      this.lastMemoryPressure = pressure;
      if (this.memoryPressureCallback) {
        this.memoryPressureCallback(pressure);
      }
      
      // 如果压力过高，自动清理缓存
      if (pressure === 'critical') {
        this.handleCriticalMemoryPressure();
      }
    }
  }

  /**
   * 处理严重内存压力
   */
  private handleCriticalMemoryPressure(): void {
    const currentDuration = this.getTotalDuration();
    if (currentDuration > 0) {
      // 清理50%的缓存
      const targetDuration = currentDuration * 0.5;
      let removedCount = 0;
      while (this.getTotalDuration() > targetDuration) {
        this.removeBuffer();
        removedCount++;
      }
      console.warn(`[MemoryManager] 严重内存压力，自动清理缓存: ${removedCount}个音频块，保留: ${this.getTotalDuration().toFixed(1)}秒`);
    }
  }

  /**
   * 获取当前内存压力状态
   */
  getMemoryPressure(): 'normal' | 'warning' | 'critical' {
    return this.lastMemoryPressure;
  }

  /**
   * 检查并限制缓存大小
   * @param removeBuffer 移除最旧音频块的函数
   * @param isPlaying 是否正在播放
   * @param getBufferCount 获取音频块数量的函数（可选）
   * @param newChunkDuration 新添加的音频块时长（秒，可选）
   * @returns 如果应该丢弃新音频块，返回 { shouldDiscard: true, reason: string }，否则返回 { shouldDiscard: false }
   */
  enforceMaxBufferDuration(
    removeBuffer: () => void, 
    isPlaying: boolean, 
    getBufferCount?: () => number,
    newChunkDuration?: number
  ): { shouldDiscard: boolean; reason?: string } {
    // 如果正在播放，不清理缓存（避免播放时丢失音频）
    if (isPlaying) {
      return { shouldDiscard: false };
    }
    
    const currentDuration = this.getTotalDuration();
    const newChunkDurationValue = newChunkDuration || 0;
    const totalDurationAfterAdd = currentDuration + newChunkDurationValue;
    
    // 检查内存限制（80%阈值）
    const memoryLimitPercent = 80;
    const memoryLimitDuration = this.maxBufferDuration * (memoryLimitPercent / 100);
    
    // 检查是否需要丢弃新音频块
    // 规则：
    // 1. 如果单个新音频块超过maxBufferDuration（25秒），应该丢弃并标记
    // 2. 如果多个音频累加超过25秒，应该自动播放，而不是丢弃
    if (newChunkDurationValue > 0) {
      // 规则1：单个音频块超过25秒，应该丢弃
      if (newChunkDurationValue > this.maxBufferDuration) {
        const reason = `单个音频块时长(${newChunkDurationValue.toFixed(1)}秒)超过限制(${this.maxBufferDuration}秒)`;
        console.warn(`[MemoryManager] ${reason}`);
        return { shouldDiscard: true, reason };
      }
      // 规则2：多个音频累加超过25秒，不丢弃，应该自动播放（由上层处理）
      // 这里不返回shouldDiscard，让上层处理自动播放
    }
    
    // 如果当前总时长超过限制，清理旧音频块（但保留至少一个）
    if (currentDuration > this.maxBufferDuration) {
      const initialBufferCount = getBufferCount ? getBufferCount() : undefined;
      
      // 如果只有一个音频块，且它的长度超过限制，允许它保留（这是ASR拼接导致的长音频，应该允许）
      if (initialBufferCount === 1 && currentDuration > this.maxBufferDuration) {
        console.log(`[MemoryManager] 单个音频块长度(${currentDuration.toFixed(1)}秒)超过限制(${this.maxBufferDuration}秒)，但保留该音频块（可能是ASR拼接导致的长音频）`);
        return { shouldDiscard: false };
      }
      
      // 多个音频块时，清理超出限制的部分
      // 保留至少30%的缓存，避免全部清空
      const keepDuration = this.maxBufferDuration * 0.3;
      let removedCount = 0;
      
      while (this.getTotalDuration() > keepDuration) {
        const bufferCountBefore = getBufferCount ? getBufferCount() : undefined;
        removeBuffer();
        const bufferCountAfter = getBufferCount ? getBufferCount() : undefined;
        
        // 如果删除后没有音频块了，停止清理（至少保留一个）
        if (bufferCountAfter !== undefined && bufferCountAfter === 0) {
          console.warn(`[MemoryManager] 清理后音频块数量为0，停止清理以保留至少一个音频块`);
          break;
        }
        
        removedCount++;
        
        // 防止无限循环（防御性检查）
        if (removedCount > 1000) {
          console.error(`[MemoryManager] 清理循环超过1000次，强制停止`);
          break;
        }
      }
      
      if (removedCount > 0) {
        console.warn(`[MemoryManager] 缓存已满，丢弃最旧音频块: ${removedCount}个，保留缓存: ${this.getTotalDuration().toFixed(1)}秒 (限制: ${this.maxBufferDuration}秒)`);
      }
    }
    
    return { shouldDiscard: false };
  }

  /**
   * 处理页面进入后台（手机端优化）
   */
  handlePageHidden(removeBuffer: () => void): void {
    const currentDuration = this.getTotalDuration();
    if (currentDuration > 0) {
      // 只保留30%的缓存
      const keepDuration = this.maxBufferDuration * 0.3;
      let removedCount = 0;
      while (this.getTotalDuration() > keepDuration) {
        removeBuffer();
        removedCount++;
      }
      if (removedCount > 0) {
        console.log(`[MemoryManager] 页面进入后台，清理缓存: ${removedCount}个音频块，保留: ${this.getTotalDuration().toFixed(1)}秒`);
      }
    }
  }
}

