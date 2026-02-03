//! 推理服务核心类型和实现

mod process;
mod service;
mod types;

pub use service::InferenceService;
pub use types::{InferenceRequest, InferenceResult, PartialResultCallback};
