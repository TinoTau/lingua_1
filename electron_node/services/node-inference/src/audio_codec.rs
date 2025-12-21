//! 音频编解码模块
//! 支持 PCM16 和 Opus 格式

use anyhow::{Context, Result};

/// 音频格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioFormat {
    Pcm16,
    Opus,
}

impl AudioFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "pcm16" | "pcm" => Some(AudioFormat::Pcm16),
            "opus" => Some(AudioFormat::Opus),
            _ => None,
        }
    }
}

/// Opus 解码器（使用 opus-rs）
pub struct OpusDecoder {
    decoder: opus::Decoder,
    sample_rate: u32,
}

impl OpusDecoder {
    pub fn new(sample_rate: u32) -> Result<Self> {
        let decoder = opus::Decoder::new(sample_rate, opus::Channels::Mono)
            .context("Failed to create Opus decoder")?;
        
        Ok(Self {
            decoder,
            sample_rate,
        })
    }

    /// 解码 Opus 数据为 PCM16
    /// 注意：opus_data 可能包含多个 Opus 帧，需要逐帧解码
    pub fn decode(&mut self, opus_data: &[u8]) -> Result<Vec<u8>> {
        // Opus 帧大小（通常为 20ms，在 16kHz 下为 320 样本）
        let frame_size = (self.sample_rate / 50) as usize; // 20ms frame
        let mut pcm_buffer = vec![0i16; frame_size];
        let mut pcm16_bytes = Vec::new();
        
        // 尝试解码整个数据块（如果数据是单个帧）
        // 如果失败，可能需要分帧处理，但为了简化，先尝试整体解码
        match self.decoder.decode(opus_data, &mut pcm_buffer, false) {
            Ok(decoded_samples) => {
                // 转换为 PCM16 字节（little-endian）
                for sample in &pcm_buffer[..decoded_samples] {
                    pcm16_bytes.extend_from_slice(&sample.to_le_bytes());
                }
            }
            Err(e) => {
                // 如果整体解码失败，尝试分帧解码（简化处理：假设每帧最大 400 字节）
                // 实际应用中可能需要更复杂的帧分割逻辑
                let mut offset = 0;
                while offset < opus_data.len() {
                    let chunk_size = std::cmp::min(400, opus_data.len() - offset);
                    let chunk = &opus_data[offset..offset + chunk_size];
                    
                    match self.decoder.decode(chunk, &mut pcm_buffer, false) {
                        Ok(decoded_samples) => {
                            for sample in &pcm_buffer[..decoded_samples] {
                                pcm16_bytes.extend_from_slice(&sample.to_le_bytes());
                            }
                            offset += chunk_size;
                        }
                        Err(_) => {
                            // 如果这帧解码失败，跳过
                            offset += chunk_size;
                        }
                    }
                }
                
                if pcm16_bytes.is_empty() {
                    return Err(anyhow::anyhow!("Failed to decode any Opus frames: {}", e));
                }
            }
        }
        
        Ok(pcm16_bytes)
    }
}

/// 解码音频数据（根据格式自动选择解码器）
pub fn decode_audio(audio_data: &[u8], audio_format: &str, sample_rate: u32) -> Result<Vec<u8>> {
    let format = AudioFormat::from_str(audio_format)
        .ok_or_else(|| anyhow::anyhow!("Unsupported audio format: {}", audio_format))?;
    
    match format {
        AudioFormat::Pcm16 => {
            // PCM16 不需要解码，直接返回
            Ok(audio_data.to_vec())
        }
        AudioFormat::Opus => {
            // 使用 Opus 解码器
            let mut decoder = OpusDecoder::new(sample_rate)?;
            decoder.decode(audio_data)
        }
    }
}

