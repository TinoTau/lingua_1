/**
 * 翻译结果显示模块
 * 负责管理翻译结果的显示和去重
 */

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  serviceTimings?: { asr_ms?: number; nmt_ms?: number; tts_ms?: number; total_ms?: number };
  networkTimings?: { web_to_scheduler_ms?: number; scheduler_to_node_ms?: number; node_to_scheduler_ms?: number; scheduler_to_web_ms?: number };
  schedulerSentAtMs?: number;
}

/**
 * 翻译结果显示管理器
 */
export class TranslationDisplayManager {
  private translationResults: Map<number, TranslationResult> = new Map();
  private displayedUtteranceIndices: Set<number> = new Set();
  private pendingTranslationResults: TranslationResult[] = [];
  private displayedTranslationCount: number = 0;

  /**
   * 保存翻译结果
   */
  saveTranslationResult(utteranceIndex: number, result: TranslationResult): void {
    this.translationResults.set(utteranceIndex, result);
  }

  /**
   * 获取翻译结果
   */
  getTranslationResult(utteranceIndex: number): TranslationResult | undefined {
    return this.translationResults.get(utteranceIndex);
  }

  /**
   * 检查是否已显示
   */
  isDisplayed(utteranceIndex: number): boolean {
    return this.displayedUtteranceIndices.has(utteranceIndex);
  }

  /**
   * 标记为已显示
   */
  markAsDisplayed(utteranceIndex: number): void {
    this.displayedUtteranceIndices.add(utteranceIndex);
  }

  /**
   * 清空所有翻译结果
   */
  clear(): void {
    this.translationResults.clear();
    this.displayedUtteranceIndices.clear();
    this.pendingTranslationResults = [];
    this.displayedTranslationCount = 0;
  }

  /**
   * 显示翻译结果到 UI（追加方式，不替换已有内容）
   */
  displayTranslationResult(
    originalText: string,
    translatedText: string,
    _serviceTimings?: { asr_ms?: number; nmt_ms?: number; tts_ms?: number; total_ms?: number },
    _networkTimings?: { web_to_scheduler_ms?: number; scheduler_to_node_ms?: number; node_to_scheduler_ms?: number; scheduler_to_web_ms?: number },
    _schedulerSentAtMs?: number
  ): boolean {
    // 如果原文和译文都为空，不显示
    if ((!originalText || originalText.trim() === '') && (!translatedText || translatedText.trim() === '')) {
      console.log('[TranslationDisplay] 文本为空，跳过显示');
      return false;
    }

    // 查找或创建翻译结果显示容器
    let resultContainer = document.getElementById('translation-result-container');
    if (!resultContainer) {
      resultContainer = document.createElement('div');
      resultContainer.id = 'translation-result-container';
      resultContainer.style.cssText = `
        margin: 20px 0;
        padding: 15px;
        background: #f0f8ff;
        border-radius: 8px;
        border: 1px solid #b0d4f1;
      `;

      // 插入到 ASR 字幕容器之后
      const asrContainer = document.getElementById('asr-subtitle-container');
      if (asrContainer && asrContainer.parentElement) {
        asrContainer.parentElement.insertBefore(resultContainer, asrContainer.nextSibling);
      } else {
        // 如果找不到 ASR 容器，添加到 app 容器
        const appContainer = document.getElementById('app');
        if (appContainer) {
          appContainer.appendChild(resultContainer);
        }
      }

      // 创建标题和文本框结构
      resultContainer.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 12px; color: #0066cc; font-size: 16px;">翻译结果：</div>
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 6px; font-size: 14px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 6px; font-size: 14px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 12px; background: #f0f8ff; border-radius: 6px; border: 1px solid #b0d4f1; color: #0066cc; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
      `;
    }

    // 显示容器
    resultContainer.style.display = 'block';

    // 获取原文和译文文本框
    const originalDiv = document.getElementById('translation-original');
    const translatedDiv = document.getElementById('translation-translated');

    if (!originalDiv || !translatedDiv) {
      console.error('无法找到翻译结果文本框');
      return false;
    }

    // 获取当前文本内容
    const currentOriginal = originalDiv.textContent || '';
    const currentTranslated = translatedDiv.textContent || '';

    // 检查是否重复（避免重复追加相同的文本）
    // 使用更严格的检查：检查文本是否作为完整段落存在（以换行分隔或开头/结尾）
    const originalTrimmed = originalText?.trim() || '';
    const translatedTrimmed = translatedText?.trim() || '';

    // 检查原文是否已经作为完整段落存在于当前文本中
    // 检查方式：文本在开头、结尾，或者被 \n\n 包围
    const originalPattern = originalTrimmed ? new RegExp(`(^|\\n\\n)${originalTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n\\n|$)`, 'm') : null;
    const translatedPattern = translatedTrimmed ? new RegExp(`(^|\\n\\n)${translatedTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n\\n|$)`, 'm') : null;

    const originalAlreadyExists = originalPattern ? originalPattern.test(currentOriginal) : false;
    const translatedAlreadyExists = translatedPattern ? translatedPattern.test(currentTranslated) : false;

    // 如果原文和译文都已存在，跳过追加（避免重复）
    if (originalAlreadyExists && translatedAlreadyExists) {
      console.log('[TranslationDisplay] 文本已存在（完整段落匹配），跳过重复追加:', {
        utterance_index: 'N/A',
        originalText: originalText?.substring(0, 50),
        translatedText: translatedText?.substring(0, 50),
        currentOriginalLength: currentOriginal.length,
        currentTranslatedLength: currentTranslated.length
      });
      return false; // 返回 false 表示未成功显示
    }

    // 追加新文本（如果当前有内容，先添加换行和分隔符）
    let newOriginal = currentOriginal;
    let newTranslated = currentTranslated;

    if (originalText && originalText.trim() !== '' && !originalAlreadyExists) {
      if (newOriginal) {
        newOriginal += '\n\n' + originalText;
      } else {
        newOriginal = originalText;
      }
    }

    if (translatedText && translatedText.trim() !== '' && !translatedAlreadyExists) {
      if (newTranslated) {
        newTranslated += '\n\n' + translatedText;
      } else {
        newTranslated = translatedText;
      }
    }

    // 更新文本框内容
    originalDiv.textContent = newOriginal;
    translatedDiv.textContent = newTranslated;

    // 自动滚动到底部，显示最新内容
    originalDiv.scrollTop = originalDiv.scrollHeight;
    translatedDiv.scrollTop = translatedDiv.scrollHeight;

    // 返回 true 表示成功显示
    return true;
  }

  /**
   * 清空已显示的翻译结果文本
   */
  clearDisplayedTranslationResults(): void {
    const originalDiv = document.getElementById('translation-original');
    const translatedDiv = document.getElementById('translation-translated');

    if (originalDiv) {
      originalDiv.textContent = '';
    }
    if (translatedDiv) {
      translatedDiv.textContent = '';
    }

    // 隐藏翻译结果容器
    const resultContainer = document.getElementById('translation-result-container');
    if (resultContainer) {
      resultContainer.style.display = 'none';
    }

    console.log('[TranslationDisplay] 已清空显示的翻译结果');
  }

  /**
   * 显示待显示的翻译结果（在开始播放时调用）
   */
  displayPendingTranslationResults(): void {
    // 显示所有待显示的翻译结果（从 pendingTranslationResults 数组）
    for (const result of this.pendingTranslationResults) {
      this.displayTranslationResult(
        result.originalText,
        result.translatedText,
        result.serviceTimings,
        result.networkTimings,
        result.schedulerSentAtMs
      );
    }
    // 更新已显示的数量
    this.displayedTranslationCount += this.pendingTranslationResults.length;
    // 清空待显示队列（已显示的结果不再需要保留）
    this.pendingTranslationResults = [];

    // 同时显示所有已保存但未显示的翻译结果（从 translationResults Map）
    // 按 utterance_index 排序，确保按顺序显示
    const sortedIndices = Array.from(this.translationResults.keys()).sort((a, b) => a - b);
    let displayedCount = 0;
    for (const utteranceIndex of sortedIndices) {
      // 如果已经显示过，跳过
      if (this.displayedUtteranceIndices.has(utteranceIndex)) {
        continue;
      }
      const result = this.translationResults.get(utteranceIndex);
      if (result) {
        this.displayTranslationResult(
          result.originalText,
          result.translatedText,
          result.serviceTimings,
          result.networkTimings,
          result.schedulerSentAtMs
        );
        this.displayedUtteranceIndices.add(utteranceIndex);
        displayedCount++;
      }
    }

    console.log('[TranslationDisplay] 已显示所有待显示的翻译结果，已显示总数:', this.displayedTranslationCount, '本次新增:', displayedCount);
  }
}

