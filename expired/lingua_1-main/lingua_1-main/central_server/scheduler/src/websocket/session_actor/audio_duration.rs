//! 音频时长计算工具
//! 用于 EDGE-5: Short-merge 功能

/// 计算音频时长（毫秒）
/// 
/// 注意：
/// - 对于 PCM16，可以精确计算
/// - 对于 Opus，使用估算值（基于帧大小和比特率）
/// 
/// Args:
/// - audio_data: 音频数据（字节）
/// - audio_format: 音频格式（"pcm16" | "opus"）
/// - sample_rate: 采样率（Hz，默认 16000）
/// 
/// Returns:
/// - 音频时长（毫秒）
pub fn calculate_audio_duration_ms(
    audio_data: &[u8],
    audio_format: &str,
    sample_rate: u32,
) -> u64 {
    match audio_format {
        "pcm16" => {
            // PCM16: 2 bytes per sample (16-bit)
            // 假设单声道
            let samples = audio_data.len() / 2;
            (samples as u64 * 1000) / sample_rate as u64
        }
        "opus" => {
            // Opus: 估算时长
            // Opus 帧大小通常是 20ms（在 16kHz 下）
            // 每个 Opus 帧的大小约为 20-400 字节（取决于比特率）
            // 使用平均比特率估算：假设 32kbps（中等质量）
            // 
            // 估算公式：
            // duration_ms = (bytes * 8 * 1000) / (bitrate_bps)
            // 
            // 对于 32kbps：
            // duration_ms = (bytes * 8 * 1000) / 32000
            // duration_ms = bytes * 0.25
            //
            // 更保守的估算：使用 24kbps（低比特率）
            // duration_ms = (bytes * 8 * 1000) / 24000
            // duration_ms = bytes * 0.333...
            //
            // 或者使用帧数估算：
            // 假设平均帧大小 60 字节（20ms @ 24kbps）
            // frames = bytes / 60
            // duration_ms = frames * 20
            //
            // 使用更简单的方法：假设平均帧大小 60 字节
            let estimated_frames = audio_data.len() / 60;
            estimated_frames as u64 * 20 // 每帧 20ms
        }
        _ => {
            // 未知格式，返回 0（不进行 Short-merge）
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pcm16_duration() {
        // 16kHz, 1 秒音频 = 16000 samples * 2 bytes = 32000 bytes
        let audio_data = vec![0u8; 32000];
        let duration = calculate_audio_duration_ms(&audio_data, "pcm16", 16000);
        assert_eq!(duration, 1000);
        
        // 16kHz, 0.5 秒音频 = 8000 samples * 2 bytes = 16000 bytes
        let audio_data = vec![0u8; 16000];
        let duration = calculate_audio_duration_ms(&audio_data, "pcm16", 16000);
        assert_eq!(duration, 500);
        
        // 16kHz, 0.4 秒音频 = 6400 samples * 2 bytes = 12800 bytes
        let audio_data = vec![0u8; 12800];
        let duration = calculate_audio_duration_ms(&audio_data, "pcm16", 16000);
        assert_eq!(duration, 400);
    }

    #[test]
    fn test_opus_duration_estimation() {
        // Opus: 估算值（不精确）
        // 假设 1 秒音频 ≈ 3000 字节（24kbps）
        // 估算：3000 / 60 * 20 = 1000ms
        let audio_data = vec![0u8; 3000];
        let duration = calculate_audio_duration_ms(&audio_data, "opus", 16000);
        // 允许误差（估算值）
        assert!(duration >= 800 && duration <= 1200);
    }
}

