//! Silero VAD 语音活动检测引擎
//!
//! 使用 ONNX Runtime 加载和运行 Silero VAD 模型，支持 GPU 加速。
//! 实现节点端 Level 2 VAD，用于拼接音频块后的断句。

mod config;
mod engine;

pub use config::VADConfig;
pub use engine::VADEngine;
