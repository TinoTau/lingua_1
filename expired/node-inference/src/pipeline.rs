//! PipelineContext 统一上下文结构
//! 
//! 所有模块必须使用 PipelineContext 作为输入输出，确保数据流的一致性。

use serde::{Deserialize, Serialize};

/// 流水线统一上下文
/// 
/// 这是所有模块的输入输出标准结构，确保数据在模块间正确传递。
/// 
/// 字段说明：
/// - `audio`: 原始音频数据（输入）
/// - `transcript`: ASR 识别的文本（输出）
/// - `translation`: NMT 翻译的文本（输出）
/// - `speaker_id`: 音色识别结果（可选输出）
/// - `speech_rate`: 语速识别结果（可选输出）
/// - `emotion`: 情感分析结果（可选输出）
/// - `persona_style`: 个性化适配结果（可选输出）
/// - `tts_audio`: TTS 合成的音频（输出）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PipelineContext {
    /// 原始音频数据（输入）
    pub audio: Option<Vec<u8>>,
    
    /// ASR 识别的文本（输出）
    pub transcript: Option<String>,
    
    /// NMT 翻译的文本（输出）
    pub translation: Option<String>,
    
    /// 音色识别结果（可选输出）
    pub speaker_id: Option<String>,
    
    /// 语速识别结果（可选输出，单位：字/秒或词/秒）
    pub speech_rate: Option<f32>,
    
    /// 情感分析结果（可选输出）
    pub emotion: Option<String>,
    
    /// 个性化适配结果（可选输出）
    pub persona_style: Option<String>,
    
    /// TTS 合成的音频（输出）
    pub tts_audio: Option<Vec<u8>>,
}

impl PipelineContext {
    /// 创建新的 PipelineContext
    pub fn new() -> Self {
        Self::default()
    }

    /// 从音频数据创建 PipelineContext
    pub fn from_audio(audio: Vec<u8>) -> Self {
        Self {
            audio: Some(audio),
            ..Default::default()
        }
    }

    /// 设置音频数据
    pub fn set_audio(&mut self, audio: Vec<u8>) {
        self.audio = Some(audio);
    }

    /// 设置识别文本
    pub fn set_transcript(&mut self, transcript: String) {
        self.transcript = Some(transcript);
    }

    /// 设置翻译文本
    pub fn set_translation(&mut self, translation: String) {
        self.translation = Some(translation);
    }

    /// 设置音色识别结果
    pub fn set_speaker_id(&mut self, speaker_id: String) {
        self.speaker_id = Some(speaker_id);
    }

    /// 设置语速识别结果
    pub fn set_speech_rate(&mut self, speech_rate: f32) {
        self.speech_rate = Some(speech_rate);
    }

    /// 设置情感分析结果
    pub fn set_emotion(&mut self, emotion: String) {
        self.emotion = Some(emotion);
    }

    /// 设置个性化适配结果
    pub fn set_persona_style(&mut self, persona_style: String) {
        self.persona_style = Some(persona_style);
    }

    /// 设置 TTS 音频
    pub fn set_tts_audio(&mut self, tts_audio: Vec<u8>) {
        self.tts_audio = Some(tts_audio);
    }

    /// 获取音频数据（如果存在）
    pub fn get_audio(&self) -> Option<&Vec<u8>> {
        self.audio.as_ref()
    }

    /// 获取识别文本（如果存在）
    pub fn get_transcript(&self) -> Option<&String> {
        self.transcript.as_ref()
    }

    /// 获取翻译文本（如果存在）
    pub fn get_translation(&self) -> Option<&String> {
        self.translation.as_ref()
    }
}

