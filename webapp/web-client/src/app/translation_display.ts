/**
 * 翻译结果显示模块
 * 负责管理翻译结果的显示和去重
 */

import { logger } from '../logger';

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
  private currentPlayingIndex: number = -1; // 当前播放的 utterance_index

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
    this.currentPlayingIndex = -1;
  }

  /**
   * 设置当前播放的 utterance_index（用于高亮显示）
   */
  setCurrentPlayingIndex(utteranceIndex: number): void {
    this.currentPlayingIndex = utteranceIndex;
    this.updateHighlight();
  }

  /**
   * 更新高亮显示
   */
  private updateHighlight(): void {
    const originalDiv = document.getElementById('translation-original');
    const translatedDiv = document.getElementById('translation-translated');

    if (!originalDiv || !translatedDiv) {
      return;
    }

    // 保存当前文本内容
    const originalText = originalDiv.textContent || '';
    const translatedText = translatedDiv.textContent || '';

    // 清空并重新构建（移除所有高亮）
    originalDiv.textContent = originalText;
    translatedDiv.textContent = translatedText;

    // 如果当前播放索引有效，高亮对应的文本段
    if (this.currentPlayingIndex >= 0) {
      const result = this.translationResults.get(this.currentPlayingIndex);
      if (result && result.originalText && result.translatedText) {
        this.highlightText(originalDiv, result.originalText.trim());
        this.highlightText(translatedDiv, result.translatedText.trim());
      }
    }
  }

  /**
   * 高亮文本中的指定内容
   */
  private highlightText(container: HTMLElement, textToHighlight: string): void {
    if (!textToHighlight || textToHighlight.trim() === '') {
      return;
    }

    const fullText = container.textContent || '';
    const searchText = textToHighlight.trim();
    
    // 尝试多种匹配方式：精确匹配、带索引前缀匹配
    let index = fullText.indexOf(searchText);
    
    // 如果精确匹配失败，尝试匹配带 [utteranceIndex] 前缀的文本
    if (index === -1 && this.currentPlayingIndex >= 0) {
      const prefixPattern = `[${this.currentPlayingIndex}] ${searchText}`;
      index = fullText.indexOf(prefixPattern);
      if (index !== -1) {
        // 找到带前缀的文本，高亮整个段落（包括前缀）
        const beforeText = fullText.substring(0, index);
        const highlightText = fullText.substring(index, index + prefixPattern.length);
        const afterText = fullText.substring(index + prefixPattern.length);

        // 创建高亮元素
        const highlightSpan = document.createElement('span');
        highlightSpan.className = 'highlight-segment';
        highlightSpan.style.cssText = `
          background: linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%);
          padding: 2px 4px;
          border-radius: 4px;
          font-weight: 500;
          transition: all 0.3s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;
        highlightSpan.textContent = highlightText;

        // 重新构建内容
        container.innerHTML = '';
        if (beforeText) {
          container.appendChild(document.createTextNode(beforeText));
        }
        container.appendChild(highlightSpan);
        if (afterText) {
          container.appendChild(document.createTextNode(afterText));
        }

        // 滚动到高亮位置
        setTimeout(() => {
          highlightSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
        return;
      }
    }

    if (index === -1) {
      return; // 文本不存在，无法高亮
    }

    // 创建新的内容，包含高亮
    const beforeText = fullText.substring(0, index);
    const highlightText = fullText.substring(index, index + searchText.length);
    const afterText = fullText.substring(index + searchText.length);

    // 创建高亮元素
    const highlightSpan = document.createElement('span');
    highlightSpan.className = 'highlight-segment';
    highlightSpan.style.cssText = `
      background: linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%);
      padding: 2px 4px;
      border-radius: 4px;
      font-weight: 500;
      transition: all 0.3s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;
    highlightSpan.textContent = highlightText;

    // 重新构建内容
    container.innerHTML = '';
    if (beforeText) {
      container.appendChild(document.createTextNode(beforeText));
    }
    container.appendChild(highlightSpan);
    if (afterText) {
      container.appendChild(document.createTextNode(afterText));
    }

    // 滚动到高亮位置
    setTimeout(() => {
      highlightSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  /**
   * 显示翻译结果到 UI（追加方式，不替换已有内容，支持按 utterance_index 分段显示）
   */
  displayTranslationResult(
    originalText: string,
    translatedText: string,
    utteranceIndex?: number,
    _serviceTimings?: { asr_ms?: number; nmt_ms?: number; tts_ms?: number; total_ms?: number },
    _networkTimings?: { web_to_scheduler_ms?: number; scheduler_to_node_ms?: number; node_to_scheduler_ms?: number; scheduler_to_web_ms?: number },
    _schedulerSentAtMs?: number
  ): boolean {
    // 如果原文和译文都为空，不显示
    // 修复：确保originalText和translatedText是字符串类型
    const originalTextStr = typeof originalText === 'string' ? originalText : (originalText || '');
    const translatedTextStr = typeof translatedText === 'string' ? translatedText : (translatedText || '');
    if ((!originalTextStr || originalTextStr.trim() === '') && (!translatedTextStr || translatedTextStr.trim() === '')) {
      logger.info('TranslationDisplay', '文本为空，跳过显示', { utterance_index: utteranceIndex });
      return false;
    }

    // 使用修复后的字符串变量
    const origText = originalTextStr;
    const transText = translatedTextStr;
    
    // 查找或创建翻译结果显示容器
    let resultContainer = document.getElementById('translation-result-container');
    if (!resultContainer) {
      logger.info('TranslationDisplay', '创建翻译结果容器（DOM 中不存在）');
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
      logger.error('TranslationDisplay', '无法找到翻译结果文本框（translation-original/translation-translated）', { utterance_index: utteranceIndex });
      return false;
    }

    // 获取当前文本内容
    const currentOriginal = originalDiv.textContent || '';
    const currentTranslated = translatedDiv.textContent || '';

    // 检查是否重复（避免重复追加相同的文本）
    // 使用更严格的检查：检查文本是否作为完整段落存在（以换行分隔或开头/结尾）
    const originalTrimmed = origText?.trim() || '';
    const translatedTrimmed = transText?.trim() || '';

    // 检查原文是否已经作为完整段落存在于当前文本中
    // 检查方式：文本在开头、结尾，或者被 \n\n 包围
    const originalPattern = originalTrimmed ? new RegExp(`(^|\\n\\n)${originalTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n\\n|$)`, 'm') : null;
    const translatedPattern = translatedTrimmed ? new RegExp(`(^|\\n\\n)${translatedTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n\\n|$)`, 'm') : null;

    const originalAlreadyExists = originalPattern ? originalPattern.test(currentOriginal) : false;
    const translatedAlreadyExists = translatedPattern ? translatedPattern.test(currentTranslated) : false;

    // 如果原文和译文都已存在，跳过追加（避免重复）
    if (originalAlreadyExists && translatedAlreadyExists) {
      logger.info('TranslationDisplay', '文本已存在（完整段落匹配），跳过重复追加', {
        utterance_index: utteranceIndex,
        original_preview: origText?.substring(0, 50),
        translated_preview: transText?.substring(0, 50),
      });
      return false;
    }

    // 追加新文本（如果当前有内容，先添加换行和分隔符）
    // 如果提供了 utteranceIndex，添加索引标识
    let newOriginal = currentOriginal;
    let newTranslated = currentTranslated;

    if (origText && origText.trim() !== '' && !originalAlreadyExists) {
      if (newOriginal) {
        const separator = utteranceIndex !== undefined ? `\n\n[${utteranceIndex}] ` : '\n\n';
        newOriginal += separator + origText;
      } else {
        const prefix = utteranceIndex !== undefined ? `[${utteranceIndex}] ` : '';
        newOriginal = prefix + origText;
      }
    }

    if (transText && transText.trim() !== '' && !translatedAlreadyExists) {
      if (newTranslated) {
        const separator = utteranceIndex !== undefined ? `\n\n[${utteranceIndex}] ` : '\n\n';
        newTranslated += separator + transText;
      } else {
        const prefix = utteranceIndex !== undefined ? `[${utteranceIndex}] ` : '';
        newTranslated = prefix + transText;
      }
    }

    // 更新文本框内容
    originalDiv.textContent = newOriginal;
    translatedDiv.textContent = newTranslated;
    
    // 更新高亮（如果当前播放的索引匹配）
    if (utteranceIndex !== undefined && utteranceIndex === this.currentPlayingIndex) {
      this.updateHighlight();
    }

    originalDiv.scrollTop = originalDiv.scrollHeight;
    translatedDiv.scrollTop = translatedDiv.scrollHeight;

    logger.info('TranslationDisplay', '翻译结果已追加到 UI', { utterance_index: utteranceIndex, original_len: newOriginal.length, translated_len: newTranslated.length });
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

    logger.info('TranslationDisplay', '已清空显示的翻译结果');
  }

  /**
   * 显示待显示的翻译结果（在开始播放时调用）
   */
  displayPendingTranslationResults(): void {
    // 显示所有待显示的翻译结果（从 pendingTranslationResults 数组）
    // 注意：pendingTranslationResults 不包含 utteranceIndex，使用 undefined
    for (const result of this.pendingTranslationResults) {
      this.displayTranslationResult(
        result.originalText,
        result.translatedText,
        undefined, // pendingTranslationResults 没有 utteranceIndex
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
          utteranceIndex, // 传递 utterance_index
          result.serviceTimings,
          result.networkTimings,
          result.schedulerSentAtMs
        );
        this.displayedUtteranceIndices.add(utteranceIndex);
        displayedCount++;
      }
    }

    logger.info('TranslationDisplay', '已显示所有待显示的翻译结果', { total_displayed: this.displayedTranslationCount, displayed_this_time: displayedCount });
  }
}

