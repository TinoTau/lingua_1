//! Lingua 节点推理服务库
//! 
//! 提供 ASR、NMT、TTS、VAD 等核心推理功能

pub mod asr;
pub mod nmt;
pub mod tts;
pub mod yourtts;
pub mod vad;
pub mod modules;
pub mod pipeline;
pub mod speaker;
pub mod speech_rate;
pub mod language_detector;
pub mod text_filter;
mod inference;
pub mod http_server;

// 重新导出主要类型
pub use asr::{ASREngine, ASRPartialResult};
pub use nmt::NMTEngine;
pub use tts::{TTSEngine, PiperHttpConfig};
pub use yourtts::{YourTTSEngine, YourTTSHttpConfig};
pub use vad::VADEngine;
pub use inference::{InferenceRequest, InferenceResult, InferenceService, PartialResultCallback};
pub use pipeline::PipelineContext;
pub use modules::{ModuleManager, ModuleMetadata, ModelRequirement, MODULE_TABLE};

