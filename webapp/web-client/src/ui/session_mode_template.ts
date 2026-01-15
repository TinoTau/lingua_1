/**
 * 会话模式 UI 模板
 * 仅包含静态 HTML 和样式字符串，不包含任何业务逻辑
 */

export function getSessionModeTemplate(): string {
  return `
    <div style="max-width: 1200px; margin: 0 auto; padding: 20px;">
      <h1 style="text-align: center; color: #333; margin-bottom: 30px;">Lingua 实时语音翻译</h1>
      
      <!-- 状态栏 -->
      <div id="status" style="margin: 20px 0; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="font-size: 16px; font-weight: bold;">状态: <span id="status-text">准备就绪</span></div>
      </div>


      <!-- 语言配置 -->
      <div id="language-config" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #333;">语言配置：</div>
        <div id="two-way-config" style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
          <div>
            <label style="font-weight: 500; margin-right: 8px;">语言 A:</label>
            <select id="lang-a" style="padding: 8px 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">
              <option value="zh">中文</option>
              <option value="en">英文</option>
              <option value="ja">日文</option>
              <option value="ko">韩文</option>
            </select>
          </div>
          <div>
            <label style="font-weight: 500; margin-right: 8px;">语言 B:</label>
            <select id="lang-b" style="padding: 8px 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; cursor: pointer;">
              <option value="en">英文</option>
              <option value="zh">中文</option>
              <option value="ja">日文</option>
              <option value="ko">韩文</option>
            </select>
          </div>
          <div style="width: 100%; margin-top: 10px; padding: 10px; background: #e7f3ff; border-radius: 6px; font-size: 13px; color: #0066cc;">
            💡 双向互译：系统会自动识别语音语言，并翻译到另一种语言
          </div>
        </div>
      </div>

      <!-- 文本输入区域（仅文本翻译模式显示） -->
      <div id="text-input-section" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #333;">文本翻译：</div>
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
          <textarea id="text-input" placeholder="请输入要翻译的文本..." style="flex: 1; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 14px; min-height: 100px; resize: vertical; font-family: inherit;"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end;">
          <button id="text-submit-btn" style="padding: 12px 30px; background: #dc3545; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s;">
            提交翻译
          </button>
        </div>
        <div id="text-translation-result" style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; display: none;">
          <div style="font-weight: bold; margin-bottom: 10px; color: #333;">翻译结果：</div>
          <div id="text-translated-content" style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; min-height: 60px;"></div>
        </div>
      </div>

      <!-- 字幕显示区域 -->
      <div id="subtitle-container" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #333;">实时字幕：</div>
        <div id="asr-subtitle" style="padding: 15px; background: #f8f9fa; border-radius: 8px; min-height: 60px; font-size: 16px; line-height: 1.6; color: #333;"></div>
        <div id="bilingual-subtitle" style="margin-top: 15px; padding: 15px; background: #e7f3ff; border-radius: 8px; min-height: 60px; font-size: 16px; line-height: 1.6; color: #0066cc; display: none;"></div>
      </div>

      <!-- 翻译结果显示区域 -->
      <div id="translation-result-container" style="margin: 20px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: none;">
        <div style="font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #0066cc;">翻译结果：</div>
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 8px; font-size: 14px;">原文 (ASR):</div>
          <div id="translation-original" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #ddd; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 8px; font-size: 14px;">译文 (NMT):</div>
          <div id="translation-translated" style="padding: 15px; background: #e7f3ff; border-radius: 8px; border: 1px solid #b0d4f1; color: #0066cc; font-size: 14px; line-height: 1.6; min-height: 60px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word;"></div>
        </div>
      </div>

      <!-- 控制按钮 -->
      <div style="margin: 30px 0; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: center; gap: 15px; flex-wrap: wrap; margin-bottom: 15px;">
          <button id="start-btn" style="padding: 12px 24px; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            开始
          </button>
          <button id="end-btn" style="padding: 12px 24px; background: #dc3545; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            结束
          </button>
        </div>
        <div style="display: flex; justify-content: center; gap: 15px; flex-wrap: wrap;">
          <button id="send-btn" style="padding: 15px 40px; background: #007bff; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            发送
          </button>
          <button id="play-pause-btn" style="padding: 15px 40px; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            <span id="play-pause-text">播放</span>
          </button>
          <button id="playback-rate-btn" style="padding: 12px 24px; background: #6c757d; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" disabled>
            <span id="playback-rate-text">1x</span>
          </button>
        </div>
      </div>
      
      <div id="tts-audio-info" style="margin: 20px 0; padding: 15px; background: #e7f3ff; border-radius: 8px; display: none;">
        <div style="font-size: 14px; color: #0066cc;">
          可播放音频时长: <span id="tts-duration">0.0</span> 秒
        </div>
      </div>

      <!-- 可选功能（折叠） -->
      <div style="margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <details>
          <summary style="font-weight: bold; font-size: 16px; color: #333; cursor: pointer; padding: 10px;">可选功能（点击展开）</summary>
          <div style="margin-top: 15px;">
            <!-- 服务模式选择 -->
            <div style="margin-bottom: 20px;">
              <div style="font-weight: bold; font-size: 16px; margin-bottom: 15px; color: #333;">选择服务模式：</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                <button id="mode-personal-voice" class="mode-btn" data-mode="personal_voice" style="padding: 15px; background: white; border: 3px solid #667eea; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">🎤</div>
                  <div style="font-weight: bold; font-size: 14px; color: #667eea; margin-bottom: 4px;">个人音色语音转译</div>
                  <div style="font-size: 11px; color: #666;">ASR → NMT → YourTTS</div>
                </button>
                <button id="mode-voice-translation" class="mode-btn" data-mode="voice_translation" style="padding: 15px; background: white; border: 3px solid #28a745; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">🔊</div>
                  <div style="font-weight: bold; font-size: 14px; color: #28a745; margin-bottom: 4px;">语音转译</div>
                  <div style="font-size: 11px; color: #666;">ASR → NMT → TTS</div>
                </button>
                <button id="mode-original-subtitle" class="mode-btn" data-mode="original_subtitle" style="padding: 15px; background: white; border: 3px solid #ffc107; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">📝</div>
                  <div style="font-weight: bold; font-size: 14px; color: #ffc107; margin-bottom: 4px;">原文字幕</div>
                  <div style="font-size: 11px; color: #666;">ASR 仅</div>
                </button>
                <button id="mode-bilingual-subtitle" class="mode-btn" data-mode="bilingual_subtitle" style="padding: 15px; background: white; border: 3px solid #17a2b8; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">🌐</div>
                  <div style="font-weight: bold; font-size: 14px; color: #17a2b8; margin-bottom: 4px;">双语字幕</div>
                  <div style="font-size: 11px; color: #666;">ASR → NMT</div>
                </button>
                <button id="mode-text-translation" class="mode-btn" data-mode="text_translation" style="padding: 15px; background: white; border: 3px solid #dc3545; border-radius: 10px; cursor: pointer; transition: all 0.3s; text-align: center;">
                  <div style="font-size: 20px; margin-bottom: 6px;">✍️</div>
                  <div style="font-weight: bold; font-size: 14px; color: #dc3545; margin-bottom: 4px;">文本翻译</div>
                  <div style="font-size: 11px; color: #666;">NMT 仅</div>
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <style>
      .mode-btn:hover {
        transform: translateY(-5px);
        box-shadow: 0 6px 12px rgba(0,0,0,0.15) !important;
      }
      .mode-btn.selected {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
        border-color: transparent !important;
      }
      .mode-btn.selected div {
        color: white !important;
      }
      button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2) !important;
      }
      button:active:not(:disabled) {
        transform: translateY(0);
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>
  `;
}

