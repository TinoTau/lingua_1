//! 音频编解码模块测试
//! 测试 PCM16 和 Opus 格式的解码功能

use lingua_node_inference::{AudioFormat, OpusDecoder, decode_audio};

#[test]
fn test_audio_format_from_str() {
    assert_eq!(AudioFormat::from_str("pcm16"), Some(AudioFormat::Pcm16));
    assert_eq!(AudioFormat::from_str("PCM16"), Some(AudioFormat::Pcm16));
    assert_eq!(AudioFormat::from_str("pcm"), Some(AudioFormat::Pcm16));
    assert_eq!(AudioFormat::from_str("opus"), Some(AudioFormat::Opus));
    assert_eq!(AudioFormat::from_str("OPUS"), Some(AudioFormat::Opus));
    assert_eq!(AudioFormat::from_str("invalid"), None);
    assert_eq!(AudioFormat::from_str(""), None);
}

#[test]
fn test_decode_pcm16() {
    // 创建测试 PCM16 数据（16-bit, little-endian）
    // 1 秒的静音数据：16kHz * 2 bytes = 32000 bytes
    let sample_count = 16000;
    let pcm16_data: Vec<u8> = (0..sample_count)
        .flat_map(|_| {
            let sample: i16 = 0; // 静音
            sample.to_le_bytes().to_vec()
        })
        .collect();
    
    let result = decode_audio(&pcm16_data, "pcm16", 16000);
    
    assert!(result.is_ok());
    let decoded = result.unwrap();
    
    // PCM16 不需要解码，应该直接返回原数据
    assert_eq!(decoded.len(), pcm16_data.len());
    assert_eq!(decoded, pcm16_data);
}

#[test]
fn test_decode_pcm16_different_sample_rate() {
    // 测试不同采样率的 PCM16
    let sample_count = 8000; // 0.5 秒 @ 16kHz
    let pcm16_data: Vec<u8> = (0..sample_count)
        .flat_map(|_| {
            let sample: i16 = 1000; // 小幅度信号
            sample.to_le_bytes().to_vec()
        })
        .collect();
    
    let result = decode_audio(&pcm16_data, "pcm16", 16000);
    
    assert!(result.is_ok());
    let decoded = result.unwrap();
    assert_eq!(decoded.len(), pcm16_data.len());
}

#[test]
fn test_decode_unsupported_format() {
    let test_data = vec![0u8; 100];
    
    let result = decode_audio(&test_data, "invalid_format", 16000);
    
    assert!(result.is_err());
    let error = result.unwrap_err();
    assert!(error.to_string().contains("Unsupported audio format"));
}

#[test]
fn test_opus_decoder_creation() {
    // 测试创建 Opus 解码器
    let decoder_result = OpusDecoder::new(16000);
    assert!(decoder_result.is_ok());
    
    let decoder_result_8k = OpusDecoder::new(8000);
    assert!(decoder_result_8k.is_ok());
    
    let decoder_result_48k = OpusDecoder::new(48000);
    assert!(decoder_result_48k.is_ok());
}

#[test]
fn test_decode_opus() {
    // 测试 Opus 解码器（使用实际的 Opus 编码数据）
    use opus::Encoder;
    
    let sample_rate = 16000;
    
    // 创建测试 PCM16 数据（20ms，320 样本 @ 16kHz）
    // Opus 支持的帧大小：2.5ms, 5ms, 10ms, 20ms, 40ms, 60ms
    // 使用标准帧大小：20ms = 320 样本 @ 16kHz
    let frame_size = 320u32; // 20ms @ 16kHz
    let pcm16_samples: Vec<i16> = (0..frame_size)
        .map(|i| {
            let sample = (i as f32 / sample_rate as f32 * 440.0 * 2.0 * std::f32::consts::PI).sin();
            (sample * 16384.0) as i16
        })
        .collect();
    
    // 编码为 Opus
    let mut encoder = Encoder::new(sample_rate, opus::Channels::Mono, opus::Application::Voip)
        .expect("Failed to create Opus encoder");
    
    let f32_samples: Vec<f32> = pcm16_samples
        .iter()
        .map(|&s| s as f32 / 32768.0)
        .collect();
    
    let mut opus_frame = vec![0u8; 4000];
    let encoded_len = encoder.encode_float(&f32_samples, &mut opus_frame)
        .expect("Failed to encode Opus frame");
    opus_frame.truncate(encoded_len);
    
    assert!(opus_frame.len() > 0, "Opus 编码数据不应为空");
    
    // 使用我们的解码器解码
    let mut decoder = OpusDecoder::new(sample_rate)
        .expect("Failed to create Opus decoder");
    
    let result = decoder.decode(&opus_frame);
    assert!(result.is_ok(), "Opus 解码应该成功");
    
    let pcm16 = result.unwrap();
    assert!(pcm16.len() > 0, "解码后的 PCM16 数据不应为空");
    // 解码后的数据应该是 320 样本 * 2 字节 = 640 字节
    assert!(pcm16.len() >= 600, "解码后的数据长度应该合理");
}

#[test]
fn test_decode_audio_opus_format() {
    // 测试 decode_audio 函数对 Opus 格式的处理（使用实际的 Opus 编码数据）
    use opus::Encoder;
    
    let sample_rate = 16000;
    
    // 创建测试 PCM16 数据并编码为 Opus（20ms，320 样本 @ 16kHz）
    // Opus 标准帧大小：20ms = 320 样本 @ 16kHz
    let frame_size = 320u32; // 20ms @ 16kHz
    let pcm16_samples: Vec<i16> = (0..frame_size)
        .map(|i| {
            let sample = (i as f32 / sample_rate as f32 * 440.0 * 2.0 * std::f32::consts::PI).sin();
            (sample * 16384.0) as i16
        })
        .collect();
    
    // 编码为 Opus
    let mut encoder = Encoder::new(sample_rate, opus::Channels::Mono, opus::Application::Voip)
        .expect("Failed to create Opus encoder");
    
    let f32_samples: Vec<f32> = pcm16_samples
        .iter()
        .map(|&s| s as f32 / 32768.0)
        .collect();
    
    let mut opus_frame = vec![0u8; 4000];
    let encoded_len = encoder.encode_float(&f32_samples, &mut opus_frame)
        .expect("Failed to encode Opus frame");
    opus_frame.truncate(encoded_len);
    
    // 使用 decode_audio 函数解码
    let result = decode_audio(&opus_frame, "opus", sample_rate);
    
    assert!(result.is_ok(), "decode_audio 应该能成功解码 Opus 数据");
    let decoded = result.unwrap();
    assert!(decoded.len() > 0, "解码后的数据不应为空");
    // 解码后的数据应该是 320 样本 * 2 字节 = 640 字节
    assert!(decoded.len() >= 600, "解码后的数据长度应该合理");
}

#[test]
fn test_decode_audio_edge_cases() {
    // 测试边界情况
    
    // 空数据
    let result = decode_audio(&[], "pcm16", 16000);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0);
    
    // 单个样本
    let single_sample = vec![0u8, 0u8]; // 一个 16-bit 样本
    let result = decode_audio(&single_sample, "pcm16", 16000);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 2);
    
    // 奇数长度的 PCM16 数据（应该仍然可以处理）
    let odd_data = vec![0u8, 0u8, 0u8]; // 1.5 个样本
    let result = decode_audio(&odd_data, "pcm16", 16000);
    assert!(result.is_ok());
    // 应该返回原数据（不做验证）
    assert_eq!(result.unwrap().len(), 3);
}

#[test]
fn test_decode_audio_sample_rate_handling() {
    // 测试不同采样率的处理
    
    let test_data = vec![0u8; 32000]; // 1 秒 @ 16kHz
    
    // 16kHz
    let result = decode_audio(&test_data, "pcm16", 16000);
    assert!(result.is_ok());
    
    // 8kHz
    let result = decode_audio(&test_data, "pcm16", 8000);
    assert!(result.is_ok());
    
    // 48kHz
    let result = decode_audio(&test_data, "pcm16", 48000);
    assert!(result.is_ok());
}

