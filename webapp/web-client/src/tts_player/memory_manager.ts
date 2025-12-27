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
   */
  enforceMaxBufferDuration(removeBuffer: () => void, isPlaying: boolean): void {
    // 如果正在播放，不清理缓存（避免播放时丢失音频）
    if (isPlaying) {
      return;
    }
    
    const currentDuration = this.getTotalDuration();
    if (currentDuration > this.maxBufferDuration) {
      // 保留至少30%的缓存，避免全部清空
      const keepDuration = this.maxBufferDuration * 0.3;
      let removedCount = 0;
      while (this.getTotalDuration() > keepDuration) {
        removeBuffer();
        removedCount++;
      }
      console.warn(`[MemoryManager] 缓存已满，丢弃最旧音频块: ${removedCount}个，保留缓存: ${this.getTotalDuration().toFixed(1)}秒 (限制: ${this.maxBufferDuration}秒)`);
    }
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

