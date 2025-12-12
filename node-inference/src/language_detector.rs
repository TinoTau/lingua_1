//! 语言检测模块（Language Detection, LID）
//! 
//! 支持自动识别输入语音属于中文/英文/日文/韩文（大语种识别）

use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::sync::Arc;
use whisper_rs::WhisperContext;
use tracing::warn;

/// 语言检测结果
#[derive(Debug, Clone)]
pub struct LanguageDetectionResult {
    /// 检测到的语言代码（"zh" | "en" | "ja" | "ko"）
    pub lang: String,
    /// 置信度（0.0 - 1.0）
    pub confidence: f32,
    /// 各语言的得分（用于调试）
    pub scores: HashMap<String, f32>,
}

/// 语言检测器配置
#[derive(Debug, Clone)]
pub struct LanguageDetectorConfig {
    /// 置信度阈值（低于此值将使用默认语言）
    pub confidence_threshold: f32,
    /// 默认语言（当检测失败或置信度不足时使用）
    pub default_lang: String,
    /// 支持的语言列表（限制识别范围）
    pub supported_langs: Vec<String>,
}

impl Default for LanguageDetectorConfig {
    fn default() -> Self {
        Self {
            confidence_threshold: 0.75,
            default_lang: "zh".to_string(),
            supported_langs: vec!["zh".to_string(), "en".to_string(), "ja".to_string(), "ko".to_string()],
        }
    }
}

/// 语言检测器
/// 
/// 使用 Whisper 的语言检测能力进行大语种识别
pub struct LanguageDetector {
    /// Whisper 上下文（复用 ASR 引擎的上下文）
    whisper_ctx: Arc<WhisperContext>,
    /// 配置
    config: LanguageDetectorConfig,
}

impl LanguageDetector {
    /// 创建新的语言检测器
    /// 
    /// # Arguments
    /// * `whisper_ctx` - Whisper 上下文（通常从 ASR 引擎共享）
    /// * `config` - 配置（可选，使用默认配置）
    /// 
    /// # Returns
    /// 返回 `LanguageDetector` 实例
    pub fn new(whisper_ctx: Arc<WhisperContext>, config: Option<LanguageDetectorConfig>) -> Self {
        Self {
            whisper_ctx,
            config: config.unwrap_or_default(),
        }
    }

    /// 检测音频的语言
    /// 
    /// # Arguments
    /// * `audio_data` - 音频数据（f32 格式，16kHz 单声道）
    /// * `sample_rate` - 采样率（通常为 16000）
    /// 
    /// # Returns
    /// 返回语言检测结果
    /// 
    /// # 注意
    /// 当前实现为框架，实际语言检测逻辑待完善
    /// 可以使用 Whisper 的 `detect_language` 方法或独立的 LID 模型
    pub async fn detect(&self, audio_data: &[f32], sample_rate: u32) -> Result<LanguageDetectionResult> {
        // TODO: 实现实际的语言检测逻辑
        // 方案1: 使用 Whisper 的语言检测能力
        // 方案2: 使用独立的 LID 模型（如 fairseq LID）
        
        // 当前实现：返回默认语言（框架占位）
        // 实际实现时，应该：
        // 1. 使用 Whisper 的 detect_language 方法
        // 2. 或调用独立的 LID 模型
        // 3. 返回检测结果和置信度
        
        warn!("LanguageDetector::detect() called but not yet implemented. Using default language: {}", self.config.default_lang);
        
        // 模拟检测结果（待实现）
        let mut scores = HashMap::new();
        scores.insert(self.config.default_lang.clone(), 1.0);
        
        Ok(LanguageDetectionResult {
            lang: self.config.default_lang.clone(),
            confidence: 1.0,
            scores,
        })
    }

    /// 检测音频的语言（使用 Whisper 的语言检测）
    /// 
    /// # Arguments
    /// * `audio_data` - 音频数据（f32 格式，16kHz 单声道）
    /// 
    /// # Returns
    /// 返回语言检测结果
    /// 
    /// # 注意
    /// 此方法使用 Whisper 的语言检测能力
    /// 需要 Whisper 模型支持语言检测
    #[allow(dead_code)]
    fn detect_with_whisper(&self, audio_data: &[f32]) -> Result<LanguageDetectionResult> {
        // TODO: 实现 Whisper 语言检测
        // 1. 创建 Whisper 状态
        // 2. 运行语言检测（使用 detect_language 或类似方法）
        // 3. 解析结果并返回
        
        // 当前为占位实现
        Err(anyhow!("Whisper language detection not yet implemented"))
    }

    /// 更新配置
    pub fn update_config(&mut self, config: LanguageDetectorConfig) {
        self.config = config;
    }

    /// 获取当前配置
    pub fn get_config(&self) -> &LanguageDetectorConfig {
        &self.config
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use whisper_rs::{WhisperContext, WhisperContextParameters};
    use std::path::PathBuf;

    #[tokio::test]
    #[ignore] // 需要模型文件
    async fn test_language_detector_new() {
        // 测试创建语言检测器
        let model_path = PathBuf::from("models/asr/whisper-base/ggml-base.bin");
        if !model_path.exists() {
            println!("⚠️  跳过测试: 模型文件不存在");
            return;
        }

        let ctx = WhisperContext::new_with_params(
            model_path.to_str().unwrap(),
            WhisperContextParameters::default(),
        ).unwrap();
        
        let detector = LanguageDetector::new(Arc::new(ctx), None);
        assert_eq!(detector.get_config().default_lang, "zh");
        println!("✓ LanguageDetector 创建成功");
    }

    #[tokio::test]
    #[ignore] // 需要模型文件
    async fn test_language_detector_detect() {
        // 测试语言检测（当前返回默认语言）
        let model_path = PathBuf::from("models/asr/whisper-base/ggml-base.bin");
        if !model_path.exists() {
            println!("⚠️  跳过测试: 模型文件不存在");
            return;
        }

        let ctx = WhisperContext::new_with_params(
            model_path.to_str().unwrap(),
            WhisperContextParameters::default(),
        ).unwrap();
        
        let detector = LanguageDetector::new(Arc::new(ctx), None);
        
        // 创建测试音频数据（1秒的静音，16kHz, f32）
        let audio_data = vec![0.0f32; 16000];
        
        let result = detector.detect(&audio_data, 16000).await.unwrap();
        assert_eq!(result.lang, "zh");
        assert!(result.confidence > 0.0);
        println!("✓ 语言检测测试通过（当前返回默认语言）");
    }
}

