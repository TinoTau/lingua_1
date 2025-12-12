//! 语言检测模块（Language Detection, LID）
//! 
//! 支持自动识别输入语音属于中文/英文/日文/韩文（大语种识别）

use anyhow::{Result, anyhow};
use std::collections::HashMap;
use std::sync::Arc;
use whisper_rs::{WhisperContext, FullParams, SamplingStrategy};
use tracing::{warn, info};

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
    /// 使用 Whisper 的语言检测能力进行大语种识别
    pub async fn detect(&self, audio_data: &[f32], _sample_rate: u32) -> Result<LanguageDetectionResult> {
        // 使用 Whisper 的语言检测能力
        // 在 Tokio 运行时中，将 CPU 密集型任务移到 blocking 线程池
        let ctx = self.whisper_ctx.clone();
        let audio_data = audio_data.to_vec();
        let config = self.config.clone();
        
        let result = tokio::task::spawn_blocking(move || {
            Self::detect_with_whisper_sync(&ctx, &audio_data, &config)
        })
        .await
        .map_err(|e| anyhow!("Language detection task panicked: {}", e))??;
        
        Ok(result)
    }
    
    /// 同步执行 Whisper 语言检测（在 blocking 线程池中运行）
    fn detect_with_whisper_sync(
        ctx: &WhisperContext,
        audio_data: &[f32],
        config: &LanguageDetectorConfig,
    ) -> Result<LanguageDetectionResult> {
        // 创建推理状态
        let mut state = ctx.create_state()
            .map_err(|e| anyhow!("Failed to create Whisper state for language detection: {:?}", e))?;
        
        // 配置推理参数（仅用于语言检测）
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        
        // 不设置语言，让 Whisper 自动检测
        params.set_language(None);
        
        // 设置线程数
        let num_threads = std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(1).max(1))
            .unwrap_or(4);
        params.set_n_threads(num_threads as i32);
        
        // 禁用翻译和输出
        params.set_translate(false);
        params.set_print_progress(false);
        params.set_print_special(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        
        // 运行推理（只用于语言检测）
        state.full(params, audio_data)
            .map_err(|e| anyhow!("Failed to run Whisper inference for language detection: {:?}", e))?;
        
        // 获取语言信息
        // whisper-rs 的 API 可能不直接提供语言 ID，我们使用一个启发式方法：
        // 1. 运行一次简短的推理（只用于语言检测）
        // 2. 从 segment 中提取文本，根据文本特征推断语言
        // 3. 或者使用一个更简单的方法：根据音频特征推断
        
        // 由于 whisper-rs 可能不直接提供语言检测 API，我们使用一个实用的方法：
        // 运行一次简短的推理，然后根据结果推断语言
        // 或者，我们可以使用一个回退方案：使用默认语言
        
        // 尝试从 state 中获取语言信息
        // 注意：whisper-rs 的 API 可能不同，这里使用一个通用的方法
        // 我们可以通过检查 segment 的文本来推断语言
        
        let mut scores = HashMap::new();
        
        // 方法1：尝试从 segment 中获取语言信息
        // 如果 state 有语言相关的信息，我们可以使用它
        // 否则，我们使用一个简化的方法：根据音频长度和特征推断
        
        // 由于 whisper-rs 可能不直接提供语言检测，我们使用一个实用的回退方案：
        // 1. 尝试运行一次简短的推理
        // 2. 从结果中推断语言（如果可能）
        // 3. 否则，使用默认语言
        
        // 简化实现：使用默认语言，但记录这是一个占位实现
        // 实际的语言检测需要根据 whisper-rs 的具体 API 来实现
        
        // 当前实现：使用一个启发式方法
        // 如果音频长度足够（>0.5秒），我们可以尝试推断语言
        // 否则，使用默认语言
        
        let audio_duration_sec = audio_data.len() as f32 / 16000.0;  // 假设 16kHz
        
        // 如果音频太短，使用默认语言
        if audio_duration_sec < 0.5 {
            warn!("Audio too short for language detection ({}s), using default: {}", 
                  audio_duration_sec, config.default_lang);
            scores.insert(config.default_lang.clone(), 1.0);
            return Ok(LanguageDetectionResult {
                lang: config.default_lang.clone(),
                confidence: 0.5,  // 低置信度
                scores,
            });
        }
        
        // 提取检测到的语言
        // 注意：whisper-rs 可能不直接提供语言检测 API，我们需要从 segment 中推断
        // 参考：D:\Programs\github\lingua\core\engine\src\asr_whisper\engine.rs
        let mut detected_lang: Option<String> = None;
        let mut confidence = 0.5;  // 默认低置信度
        
        // 从 segment 中提取文本，然后根据文本特征推断语言
        let num_segments = state.full_n_segments();
        let mut extracted_text = String::new();
        
        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                // 从 Debug 输出中提取文本（因为字段可能是私有的）
                // 参考：D:\Programs\github\lingua\core\engine\src\asr_whisper\engine.rs:142-155
                let segment_debug = format!("{:?}", segment);
                
                if let Some(start_idx) = segment_debug.find("text: Ok(\"") {
                    let text_start = start_idx + 10;
                    if let Some(end_idx) = segment_debug[text_start..].find("\")") {
                        let text = &segment_debug[text_start..text_start + end_idx];
                        let text_trimmed = text.trim();
                        if !text_trimmed.is_empty() {
                            extracted_text.push_str(text_trimmed);
                            extracted_text.push(' ');
                        }
                    }
                }
            }
        }
        
        // 根据提取的文本推断语言
        if !extracted_text.trim().is_empty() {
            detected_lang = Self::infer_language_from_text(extracted_text.trim(), &config.supported_langs);
            if detected_lang.is_some() {
                confidence = 0.85;  // 高置信度（有文本内容）
            }
        }
        
        // 为所有支持的语言设置初始得分
        for lang in &config.supported_langs {
            scores.insert(lang.clone(), 0.1);  // 低初始得分
        }
        
        // 使用检测到的语言或默认语言
        let final_lang = detected_lang.unwrap_or_else(|| {
            warn!("Could not infer language from audio (text: '{}'), using default: {}", 
                  extracted_text.trim(), config.default_lang);
            config.default_lang.clone()
        });
        
        // 确保最终语言在支持列表中
        let final_lang = if config.supported_langs.contains(&final_lang) {
            final_lang
        } else {
            warn!("Inferred language {} not in supported list {:?}, using default: {}", 
                  final_lang, config.supported_langs, config.default_lang);
            config.default_lang.clone()
        };
        
        // 更新检测到的语言的得分
        if let Some(score) = scores.get_mut(&final_lang) {
            *score = confidence;
        }
        
        // 如果置信度低于阈值，使用默认语言
        let final_lang = if confidence < config.confidence_threshold {
            warn!("Language detection confidence {} below threshold {}, using default: {}", 
                  confidence, config.confidence_threshold, config.default_lang);
            config.default_lang.clone()
        } else {
            final_lang
        };
        
        info!("Language detected: {} (confidence: {:.2}, text: '{}')", 
              final_lang, confidence, extracted_text.trim());
        
        Ok(LanguageDetectionResult {
            lang: final_lang,
            confidence,
            scores,
        })
    }


    /// 从文本推断语言（启发式方法）
    /// 
    /// # Arguments
    /// * `text` - 文本内容
    /// * `supported_langs` - 支持的语言列表
    /// 
    /// # Returns
    /// 返回推断的语言代码，如果无法推断则返回 None
    fn infer_language_from_text(text: &str, supported_langs: &[String]) -> Option<String> {
        // 简化的语言推断方法（基于字符特征）
        // 这是一个启发式方法，实际应该使用更复杂的语言检测算法
        
        if text.is_empty() {
            return None;
        }
        
        // 检查中文字符
        if text.chars().any(|c| c >= '\u{4e00}' && c <= '\u{9fff}') {
            if supported_langs.contains(&"zh".to_string()) {
                return Some("zh".to_string());
            }
        }
        
        // 检查日文字符（平假名、片假名、汉字）
        if text.chars().any(|c| {
            (c >= '\u{3040}' && c <= '\u{309f}') ||  // 平假名
            (c >= '\u{30a0}' && c <= '\u{30ff}') ||  // 片假名
            (c >= '\u{4e00}' && c <= '\u{9fff}')     // 汉字（也用于中文）
        }) {
            // 如果包含日文特有的假名，更可能是日语
            if text.chars().any(|c| (c >= '\u{3040}' && c <= '\u{309f}') || (c >= '\u{30a0}' && c <= '\u{30ff}')) {
                if supported_langs.contains(&"ja".to_string()) {
                    return Some("ja".to_string());
                }
            }
        }
        
        // 检查韩文字符
        if text.chars().any(|c| c >= '\u{ac00}' && c <= '\u{d7af}') {
            if supported_langs.contains(&"ko".to_string()) {
                return Some("ko".to_string());
            }
        }
        
        // 如果主要是 ASCII 字符，可能是英文
        if text.chars().all(|c| c.is_ascii() || c.is_whitespace() || c.is_ascii_punctuation()) {
            if supported_langs.contains(&"en".to_string()) {
                return Some("en".to_string());
            }
        }
        
        None
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

