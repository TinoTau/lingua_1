/**
 * ASR 字幕模块
 * 实时显示识别内容
 */
export class AsrSubtitle {
  private element: HTMLElement | null = null;
  private currentText: string = '';

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container element not found: ${containerId}`);
      return;
    }

    // 创建字幕元素
    this.element = document.createElement('div');
    this.element.id = 'asr-subtitle';
    this.element.style.cssText = `
      padding: 20px;
      font-size: 18px;
      line-height: 1.6;
      color: #333;
      min-height: 60px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: #f9f9f9;
    `;
    container.appendChild(this.element);
    // 初始化时渲染默认文本
    this.render();
  }

  /**
   * 更新字幕（partial）
   */
  updatePartial(text: string): void {
    this.currentText = text;
    this.render();
  }

  /**
   * 更新字幕（final）
   */
  updateFinal(text: string): void {
    this.currentText = text;
    this.render();
  }

  /**
   * 清空字幕
   */
  clear(): void {
    this.currentText = '';
    this.render();
  }

  /**
   * 渲染字幕
   */
  private render(): void {
    if (this.element) {
      this.element.textContent = this.currentText || '等待语音输入...';
    }
  }

  /**
   * 获取当前文本
   */
  getCurrentText(): string {
    return this.currentText;
  }
}

