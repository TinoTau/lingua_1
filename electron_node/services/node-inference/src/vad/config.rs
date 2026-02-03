//! Silero VAD 配置与自适应状态

use std::collections::VecDeque;

/// Silero VAD 配置
#[derive(Debug, Clone)]
pub struct VADConfig {
    /// 采样率（Silero VAD 要求 16kHz）
    pub sample_rate: u32,
    /// 帧大小（512 samples @ 16kHz = 32ms）
    pub frame_size: usize,
    /// 静音阈值（0.0-1.0），低于此值认为是静音
    pub silence_threshold: f32,
    /// 最小静音时长（毫秒），超过此时长才判定为自然停顿
    pub min_silence_duration_ms: u64,
    /// 是否启用自适应调整
    pub adaptive_enabled: bool,
    /// 基础阈值范围（毫秒）
    pub base_threshold_min_ms: u64,
    pub base_threshold_max_ms: u64,
    /// 最终阈值范围（毫秒）
    pub final_threshold_min_ms: u64,
    pub final_threshold_max_ms: u64,
    /// 最小话语时长（防止半句话被切掉，毫秒）
    pub min_utterance_ms: u64,
}

impl Default for VADConfig {
    fn default() -> Self {
        Self {
            sample_rate: 16000,
            frame_size: 512,  // 32ms @ 16kHz
            silence_threshold: 0.2,  // 降低阈值，提高语音检测灵敏度
            min_silence_duration_ms: 300,  // 基础阈值
            adaptive_enabled: true,
            base_threshold_min_ms: 200,
            base_threshold_max_ms: 600,
            final_threshold_min_ms: 200,
            final_threshold_max_ms: 800,
            min_utterance_ms: 1000,
        }
    }
}

/// 自适应状态（根据语速动态调整阈值）
pub(crate) struct AdaptiveState {
    /// 语速历史（字符/秒）
    speech_rate_history: VecDeque<f32>,
    /// 基础阈值（由语速自适应生成，毫秒）
    base_threshold_ms: u64,
    /// 样本数量
    sample_count: usize,
}

impl AdaptiveState {
    pub(crate) fn new(base_duration_ms: u64) -> Self {
        Self {
            speech_rate_history: VecDeque::with_capacity(20),
            base_threshold_ms: base_duration_ms,
            sample_count: 0,
        }
    }

    /// 更新语速并调整阈值
    pub(crate) fn update_speech_rate(&mut self, speech_rate: f32, config: &VADConfig) {
        self.speech_rate_history.push_back(speech_rate);
        if self.speech_rate_history.len() > 20 {
            self.speech_rate_history.pop_front();
        }
        self.sample_count += 1;

        // 计算平均语速（使用指数加权移动平均）
        let avg_speech_rate = if !self.speech_rate_history.is_empty() {
            let alpha = 0.5;
            let mut weighted_sum = 0.0;
            let mut weight_sum = 0.0;
            let history_len = self.speech_rate_history.len();
            for (i, &rate) in self.speech_rate_history.iter().enumerate() {
                let weight = (1.0_f32 - alpha).powi((history_len - i - 1) as i32);
                weighted_sum += rate * weight;
                weight_sum += weight;
            }
            weighted_sum / weight_sum
        } else {
            speech_rate
        };

        // 根据语速动态计算阈值倍数（使用 sigmoid 函数）
        let sigmoid = |x: f32| -> f32 {
            1.0 / (1.0 + (-x).exp())
        };

        let normalized_rate = (avg_speech_rate - 6.0) / 2.0;
        let sigmoid_value = sigmoid(normalized_rate);
        let multiplier = 1.0 + (0.5 - sigmoid_value) * 0.4;
        let multiplier = multiplier.clamp(0.5, 1.5);

        // 应用调整
        let base_threshold_center = (config.base_threshold_min_ms + config.base_threshold_max_ms) / 2;
        let target_base = (base_threshold_center as f32 * multiplier) as u64;
        let adjustment = (target_base as f32 - self.base_threshold_ms as f32) * 0.4;
        self.base_threshold_ms = ((self.base_threshold_ms as f32 + adjustment) as u64)
            .clamp(config.base_threshold_min_ms, config.base_threshold_max_ms);
    }

    /// 获取有效阈值
    pub(crate) fn get_effective_threshold(&self, config: &VADConfig) -> u64 {
        self.base_threshold_ms.clamp(config.final_threshold_min_ms, config.final_threshold_max_ms)
    }

    /// 获取调整后的阈值
    pub(crate) fn get_adjusted_duration(&self, config: &VADConfig) -> u64 {
        if self.sample_count == 0 {
            config.min_silence_duration_ms
        } else {
            self.get_effective_threshold(config)
        }
    }
}
