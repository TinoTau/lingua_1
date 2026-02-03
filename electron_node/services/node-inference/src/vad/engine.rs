//! Silero VAD 引擎：会话加载与帧级推理

use anyhow::{Result, anyhow};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use ort::{
    session::Session,
    value::Tensor,
    execution_providers::CUDAExecutionProvider,
    Error as OrtError,
};
use ndarray::{Array1, Array2, Array3, CowArray, Ix2, Ix3};
use tracing::info;

use super::config::{VADConfig, AdaptiveState};

/// Silero VAD 引擎
pub struct VADEngine {
    session: Arc<Mutex<Session>>,
    model_path: PathBuf,
    config: VADConfig,
    /// 隐藏状态（用于 VAD 模型的状态传递）
    hidden_state: Arc<Mutex<Option<Array2<f32>>>>,
    /// 连续静音帧数
    silence_frame_count: Arc<Mutex<usize>>,
    /// 上一个检测到语音的时间戳
    last_speech_timestamp: Arc<Mutex<Option<u64>>>,
    /// 自适应状态
    adaptive_state: Arc<Mutex<AdaptiveState>>,
    /// 上一次边界检测的时间戳（用于冷却期）
    last_boundary_timestamp: Arc<Mutex<Option<u64>>>,
    /// 帧缓冲区（用于累积小帧）
    frame_buffer: Arc<Mutex<Vec<f32>>>,
}

impl VADEngine {
    /// 从模型目录加载 Silero VAD 模型
    pub fn new(model_dir: PathBuf) -> Result<Self> {
        let possible_names = ["silero_vad_official.onnx", "silero_vad.onnx", "model.onnx"];
        let model_path = possible_names.iter()
            .find_map(|name| {
                let path = model_dir.join(name);
                if path.exists() {
                    Some(path)
                } else {
                    None
                }
            })
            .ok_or_else(|| anyhow!(
                "No Silero VAD model file found in directory: {}. Tried: {:?}",
                model_dir.display(),
                possible_names
            ))?;

        Self::new_from_model_path(&model_path, VADConfig::default())
    }

    /// 从模型文件路径加载 Silero VAD 模型
    pub fn new_from_model_path(model_path: &Path, config: VADConfig) -> Result<Self> {
        if !model_path.exists() {
            return Err(anyhow!("Model file not found: {}", model_path.display()));
        }

        info!("Loading Silero VAD model from: {}", model_path.display());

        // 初始化 ONNX Runtime 环境（ort crate 2.0）
        ort::init().commit()
            .map_err(|e: OrtError| anyhow!("Failed to initialize ONNX Runtime: {}", e))?;

        // 创建会话，优先使用 CUDA（如果可用）
        let model_data = std::fs::read(model_path)
            .map_err(|e| anyhow!("Failed to read model file: {}", e))?;

        let session = match Session::builder()
            .map_err(|e: OrtError| anyhow!("Failed to create session builder: {}", e))?
            .with_execution_providers([CUDAExecutionProvider::default().build()])
            .map_err(|e: OrtError| anyhow!("Failed to set CUDA execution provider: {}", e))?
            .commit_from_memory(&model_data) {
            Ok(sess) => {
                info!("Silero VAD: Using CUDA GPU acceleration");
                sess
            }
            Err(e) => {
                info!("Silero VAD: CUDA not available, falling back to CPU: {}", e);
                Session::builder()
                    .map_err(|e: OrtError| anyhow!("Failed to create session builder: {}", e))?
                    .commit_from_memory(&model_data)
                    .map_err(|e: OrtError| anyhow!("Failed to load model: {}", e))?
            }
        };

        info!("Silero VAD model loaded successfully");

        let base_threshold = (config.base_threshold_min_ms + config.base_threshold_max_ms) / 2;

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
            model_path: model_path.to_path_buf(),
            config,
            hidden_state: Arc::new(Mutex::new(None)),
            silence_frame_count: Arc::new(Mutex::new(0)),
            last_speech_timestamp: Arc::new(Mutex::new(None)),
            adaptive_state: Arc::new(Mutex::new(AdaptiveState::new(base_threshold))),
            last_boundary_timestamp: Arc::new(Mutex::new(None)),
            frame_buffer: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// 检测语音活动（用于拼接后的音频块）
    ///
    /// # Arguments
    /// * `audio_data` - 音频数据（f32，16kHz，单声道，范围 -1.0 到 1.0）
    ///
    /// # Returns
    /// 返回语音段的起止位置列表（样本索引）
    pub fn detect_speech(&self, audio_data: &[f32]) -> Result<Vec<(usize, usize)>> {
        let mut segments = Vec::new();
        let mut current_segment_start: Option<usize> = None;

        for (frame_idx, frame) in audio_data.chunks(self.config.frame_size).enumerate() {
            if frame.len() < self.config.frame_size {
                break;
            }

            let speech_prob = self.detect_voice_activity_frame(frame)?;

            if speech_prob > self.config.silence_threshold {
                let sample_start = frame_idx * self.config.frame_size;
                if current_segment_start.is_none() {
                    current_segment_start = Some(sample_start);
                }
            } else {
                if let Some(start) = current_segment_start {
                    let sample_end = frame_idx * self.config.frame_size;
                    segments.push((start, sample_end));
                    current_segment_start = None;
                }
            }
        }

        if let Some(start) = current_segment_start {
            segments.push((start, audio_data.len()));
        }

        Ok(segments)
    }

    /// 检测单帧的语音活动概率
    fn detect_voice_activity_frame(&self, audio_frame: &[f32]) -> Result<f32> {
        if audio_frame.len() != self.config.frame_size {
            return Err(anyhow!(
                "Audio frame length {} does not match frame size {}",
                audio_frame.len(),
                self.config.frame_size
            ));
        }

        let normalized: Vec<f32> = audio_frame.iter()
            .map(|&x| x.clamp(-1.0, 1.0))
            .collect();

        let input_array = Array2::from_shape_vec((1, normalized.len()), normalized)
            .map_err(|e| anyhow!("Failed to create input array: {}", e))?;

        let state_array = {
            let mut state_guard = self.hidden_state.lock()
                .map_err(|e| anyhow!("Failed to lock hidden state: {}", e))?;

            if let Some(ref state_2d) = *state_guard {
                state_2d.clone().into_shape((2, 1, 128))
                    .map_err(|e| anyhow!("Failed to reshape state: {}", e))?
            } else {
                let new_state = Array3::<f32>::zeros((2, 1, 128));
                *state_guard = Some(new_state.clone().into_shape((2, 128))
                    .map_err(|e| anyhow!("Failed to reshape new state: {}", e))?);
                new_state
            }
        };

        let arr_dyn = input_array.into_dyn();
        let arr_owned = arr_dyn.to_owned();
        let cow_arr = CowArray::from(arr_owned);

        let state_dyn = state_array.into_dyn();
        let state_owned = state_dyn.to_owned();
        let state_cow = CowArray::from(state_owned);

        let sr_array = Array1::from_vec(vec![self.config.sample_rate as i64]);
        let sr_dyn = sr_array.into_dyn();
        let sr_owned = sr_dyn.to_owned();
        let sr_cow = CowArray::from(sr_owned);

        let audio_owned = cow_arr.into_owned();
        let audio_shape = audio_owned.shape().to_vec();
        let audio_vec: Vec<f32> = audio_owned.into_iter().collect();
        let audio_tensor = Tensor::from_array((audio_shape, audio_vec))
            .map_err(|e| anyhow!("Failed to create audio input: {}", e))?;

        let state_owned = state_cow.into_owned();
        let state_shape = state_owned.shape().to_vec();
        let state_vec: Vec<f32> = state_owned.into_iter().collect();
        let state_tensor = Tensor::from_array((state_shape, state_vec))
            .map_err(|e| anyhow!("Failed to create state input: {}", e))?;

        let sr_owned = sr_cow.into_owned();
        let sr_shape = sr_owned.shape().to_vec();
        let sr_vec: Vec<i64> = sr_owned.into_iter().collect();
        let sr_tensor = Tensor::from_array((sr_shape, sr_vec))
            .map_err(|e| anyhow!("Failed to create sr input: {}", e))?;

        let mut session_guard = self.session.lock()
            .map_err(|e| anyhow!("Failed to lock session: {}", e))?;

        let outputs = session_guard
            .run(ort::inputs![audio_tensor, state_tensor, sr_tensor])
            .map_err(|e| anyhow!("ONNX inference failed: {}", e))?;

        let (output_shape, output_data): (&ort::tensor::Shape, &[f32]) = outputs[0]
            .try_extract_tensor()
            .map_err(|e| anyhow!("Failed to extract output: {}", e))?;

        let output_dims: Vec<usize> = output_shape.iter().map(|&d| d as usize).collect();
        let output_array = ndarray::ArrayViewD::from_shape(
            output_dims.as_slice(),
            output_data
        ).map_err(|e| anyhow!("Failed to create output array view: {}", e))?;

        if outputs.len() > 1 {
            let (state_shape, state_data): (&ort::tensor::Shape, &[f32]) = outputs[1]
                .try_extract_tensor()
                .map_err(|e| anyhow!("Failed to extract state: {}", e))?;

            let state_dims: Vec<usize> = state_shape.iter().map(|&d| d as usize).collect();
            let state_array = ndarray::ArrayViewD::from_shape(
                state_dims.as_slice(),
                state_data
            ).map_err(|e| anyhow!("Failed to create state array view: {}", e))?;

            let new_state_3d: Array3<f32> = state_array
                .to_owned()
                .into_dimensionality::<Ix3>()
                .map_err(|e| anyhow!("Failed to reshape state: {}", e))?;

            let new_state_2d = new_state_3d.into_shape((2, 128))
                .map_err(|e| anyhow!("Failed to reshape state for storage: {}", e))?;

            let mut state_guard = self.hidden_state.lock()
                .map_err(|e| anyhow!("Failed to lock hidden state: {}", e))?;
            *state_guard = Some(new_state_2d);
        }

        let view = output_array;
        let shape = view.shape();

        let raw_output = if shape.len() == 2 {
            let output_array: Array2<f32> = view
                .to_owned()
                .into_dimensionality::<Ix2>()
                .map_err(|e| anyhow!("Failed to reshape output: {}", e))?;

            if output_array.shape()[1] >= 2 {
                output_array[[0, 1]]
            } else {
                output_array[[0, 0]]
            }
        } else if shape.len() == 1 {
            let output_array: Array1<f32> = view
                .to_owned()
                .into_dimensionality::<ndarray::Ix1>()
                .map_err(|e| anyhow!("Failed to reshape output: {}", e))?;
            output_array[0]
        } else {
            let flat: Vec<f32> = view.iter().copied().collect();
            if flat.is_empty() {
                return Err(anyhow!("Output tensor is empty"));
            }
            flat[0]
        };

        let speech_prob = if raw_output < -10.0 || raw_output > 10.0 {
            1.0 / (1.0 + (-raw_output).exp())
        } else if raw_output < 0.2 && raw_output > -0.01 {
            let scaled_logit = raw_output * 10.0;
            1.0 / (1.0 + (-scaled_logit).exp())
        } else if raw_output < 0.5 {
            1.0 - raw_output
        } else {
            raw_output
        };

        Ok(speech_prob)
    }

    /// 更新语速（用于自适应调整）
    pub fn update_speech_rate(&self, text: &str, audio_duration_ms: u64) {
        if !self.config.adaptive_enabled || audio_duration_ms == 0 {
            return;
        }

        let text_length = text.chars().count() as f32;
        let audio_duration_sec = audio_duration_ms as f32 / 1000.0;
        let speech_rate = text_length / audio_duration_sec;

        const MIN_REASONABLE_RATE: f32 = 0.5;
        const MAX_REASONABLE_RATE: f32 = 50.0;

        if speech_rate < MIN_REASONABLE_RATE || speech_rate > MAX_REASONABLE_RATE {
            return;
        }

        let mut state = self.adaptive_state.lock().unwrap();
        state.update_speech_rate(speech_rate, &self.config);
    }

    /// 获取调整后的阈值
    pub fn get_adjusted_duration_ms(&self) -> u64 {
        if !self.config.adaptive_enabled {
            return self.config.min_silence_duration_ms;
        }

        let state = self.adaptive_state.lock().unwrap();
        state.get_adjusted_duration(&self.config)
    }

    /// 重置状态（用于新的音频流）
    pub fn reset_state(&self) -> Result<()> {
        let mut state_guard = self.hidden_state.lock()
            .map_err(|e| anyhow!("Failed to lock hidden state: {}", e))?;
        *state_guard = None;

        let mut silence_count = self.silence_frame_count.lock()
            .map_err(|e| anyhow!("Failed to lock silence_frame_count: {}", e))?;
        *silence_count = 0;

        let mut last_speech = self.last_speech_timestamp.lock()
            .map_err(|e| anyhow!("Failed to lock last_speech_timestamp: {}", e))?;
        *last_speech = None;

        let mut last_boundary = self.last_boundary_timestamp.lock()
            .map_err(|e| anyhow!("Failed to lock last_boundary_timestamp: {}", e))?;
        *last_boundary = None;

        let mut buffer = self.frame_buffer.lock()
            .map_err(|e| anyhow!("Failed to lock frame_buffer: {}", e))?;
        buffer.clear();

        let base_threshold = (self.config.base_threshold_min_ms + self.config.base_threshold_max_ms) / 2;
        let mut adaptive = self.adaptive_state.lock()
            .map_err(|e| anyhow!("Failed to lock adaptive_state: {}", e))?;
        *adaptive = AdaptiveState::new(base_threshold);

        Ok(())
    }

    /// 获取模型路径
    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// 设置静音阈值
    pub fn set_silence_threshold(&mut self, threshold: f32) {
        self.config.silence_threshold = threshold.clamp(0.0, 1.0);
    }

    /// 获取当前静音阈值
    pub fn silence_threshold(&self) -> f32 {
        self.config.silence_threshold
    }
}
