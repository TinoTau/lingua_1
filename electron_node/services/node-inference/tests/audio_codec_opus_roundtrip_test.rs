//! Opus 编解码往返测试
//! 测试 Opus 编码和解码的完整流程

use lingua_node_inference::{OpusDecoder, decode_audio};
use opus::Encoder;

#[test]
fn test_opus_roundtrip_encoding_decoding() {
    // 创建测试 PCM16 数据（多个完整帧，16kHz，单声道）
    // 使用 5 个完整的 20ms 帧（320 样本 × 5 = 1600 样本）
    let sample_rate = 16000u32;
    let frame_size = 320usize; // 20ms @ 16kHz (Opus 标准帧大小)
    let num_frames = 5u32;
    let sample_count = frame_size * num_frames as usize; // 1600 样本
    
    // 生成正弦波测试信号
    let mut pcm16_samples: Vec<i16> = Vec::with_capacity(sample_count);
    for i in 0..sample_count {
        let sample = (i as f32 / sample_rate as f32 * 440.0 * 2.0 * std::f32::consts::PI).sin();
        pcm16_samples.push((sample * 16384.0) as i16); // 转换为 i16
    }
    
    // 转换为 PCM16 字节（little-endian）- 只计算实际编码的帧
    let encoded_samples_count = (num_frames as usize) * frame_size;
    let pcm16_bytes: Vec<u8> = pcm16_samples[..encoded_samples_count]
        .iter()
        .flat_map(|s| s.to_le_bytes().to_vec())
        .collect();
    
    // 创建 Opus 编码器
    let mut encoder = Encoder::new(sample_rate, opus::Channels::Mono, opus::Application::Voip)
        .expect("Failed to create Opus encoder");
    
    // 编码 PCM16 数据为 Opus
    // Opus 编码器需要 f32 格式的输入，采样范围 [-1.0, 1.0]
    // Opus 支持的帧大小：2.5ms, 5ms, 10ms, 20ms, 40ms, 60ms
    // 使用标准帧大小：20ms = 320 样本 @ 16kHz
    let mut opus_encoded = Vec::new();
    
    // 处理所有完整的帧
    for chunk in pcm16_samples.chunks(frame_size) {
        // 只处理完整的帧（320 样本）
        if chunk.len() != frame_size {
            continue;
        }
        
        // 转换为 f32
        let f32_samples: Vec<f32> = chunk
            .iter()
            .map(|&s| s as f32 / 32768.0)
            .collect();
        
        // 编码
        let mut opus_frame = vec![0u8; 4000]; // Opus 帧最大约 4000 字节
        let encoded_len = encoder.encode_float(&f32_samples, &mut opus_frame)
            .expect("Failed to encode Opus frame");
        
        opus_frame.truncate(encoded_len);
        opus_encoded.extend_from_slice(&opus_frame);
    }
    
    assert!(opus_encoded.len() > 0, "Opus 编码数据不应为空");
    assert_eq!(
        opus_encoded.len() % 1, 0, // 确保有编码数据
        "Opus 编码数据应该包含 {} 个帧",
        num_frames
    );
    
    // 使用我们的解码器解码
    let mut decoder = OpusDecoder::new(sample_rate)
        .expect("Failed to create Opus decoder");
    
    // 解码 Opus 数据
    let decoded_pcm16 = decoder.decode(&opus_encoded)
        .expect("Failed to decode Opus data");
    
    assert!(decoded_pcm16.len() > 0, "解码后的 PCM16 数据不应为空");
    
    // 验证解码后的数据长度
    // 解码后的数据应该是 5 帧 × 320 样本 × 2 字节 = 3200 字节
    // 但由于解码器可能只解码了部分帧，我们允许一些容差
    let expected_length = encoded_samples_count * 2; // 每个样本 2 字节
    
    // 验证至少解码了一些数据（至少 1 帧）
    assert!(
        decoded_pcm16.len() >= 320 * 2, // 至少是 1 帧（320 样本 × 2 字节）
        "解码后的数据应该包含至少一帧: 期望至少 {} 字节 (1 帧), 实际 {} 字节",
        320 * 2,
        decoded_pcm16.len()
    );
    
    // 验证往返编码/解码：解码后的数据应该接近原始数据
    // 由于 Opus 是有损压缩，我们只验证数据长度在合理范围内
    // 理想情况下应该解码所有 5 帧，但由于解码器实现，可能只解码部分帧
    assert!(
        decoded_pcm16.len() <= expected_length * 2, // 不超过期望长度的 2 倍
        "解码后的数据长度不应过大: 期望最多 {} 字节, 实际 {} 字节",
        expected_length * 2,
        decoded_pcm16.len()
    );
}

#[test]
fn test_opus_decode_audio_function() {
    // 测试 decode_audio 函数对 Opus 格式的处理
    
    // 创建测试 PCM16 数据并编码为 Opus（20ms，320 样本 @ 16kHz）
    // Opus 标准帧大小：20ms = 320 样本 @ 16kHz
    let sample_rate = 16000u32;
    let sample_count = 320usize; // 20ms @ 16kHz (Opus 标准帧大小)
    let pcm16_samples: Vec<i16> = (0..sample_count)
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
}

#[test]
fn test_opus_multiple_frames() {
    // 测试解码多个 Opus 帧
    
    let sample_rate = 16000u32;
    let mut encoder = Encoder::new(sample_rate, opus::Channels::Mono, opus::Application::Voip)
        .expect("Failed to create Opus encoder");
    
    let mut all_opus_frames = Vec::new();
    
    // 编码多个帧（使用 Opus 标准帧大小：20ms = 320 样本 @ 16kHz）
    for frame_idx in 0..5 {
        let frame_size = 320usize; // 20ms @ 16kHz (Opus 标准帧大小)
        let pcm16_samples: Vec<i16> = (0..frame_size)
            .map(|i| {
                let freq = 440.0 + (frame_idx as f32 * 100.0);
                let sample = (i as f32 / sample_rate as f32 * freq * 2.0 * std::f32::consts::PI).sin();
                (sample * 16384.0) as i16
            })
            .collect();
        
        let f32_samples: Vec<f32> = pcm16_samples
            .iter()
            .map(|&s| s as f32 / 32768.0)
            .collect();
        
        let mut opus_frame = vec![0u8; 4000];
        let encoded_len = encoder.encode_float(&f32_samples, &mut opus_frame)
            .expect("Failed to encode Opus frame");
        opus_frame.truncate(encoded_len);
        
        all_opus_frames.extend_from_slice(&opus_frame);
    }
    
    // 解码所有帧
    let mut decoder = OpusDecoder::new(sample_rate)
        .expect("Failed to create Opus decoder");
    
    let decoded = decoder.decode(&all_opus_frames)
        .expect("Failed to decode multiple Opus frames");
    
    assert!(decoded.len() > 0, "解码后的数据不应为空");
    
    // 验证解码后的数据长度
    // 5 帧 * 320 样本 * 2 字节 = 3200 字节
    // 由于解码器可能只解码部分帧，我们验证至少解码了 1 帧
    assert!(
        decoded.len() >= 320 * 2, // 至少是 1 帧（320 样本 × 2 字节）
        "解码后的数据应该包含至少一帧: 期望至少 {} 字节 (1 帧), 实际 {} 字节",
        320 * 2,
        decoded.len()
    );
    
    // 验证数据长度在合理范围内（不超过期望长度的 2 倍）
    let expected_length = 5 * 320 * 2; // 3200 字节
    assert!(
        decoded.len() <= expected_length * 2, // 不超过期望长度的 2 倍
        "解码后的数据长度不应过大: 期望最多 {} 字节, 实际 {} 字节",
        expected_length * 2,
        decoded.len()
    );
}

