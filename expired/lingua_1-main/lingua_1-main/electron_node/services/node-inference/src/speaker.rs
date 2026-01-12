//! 说话者识别和音色克隆模块
//! 
//! 支持基于 Speaker Embedding 的说话者识别

use anyhow::Result;
use async_trait::async_trait;
use crate::modules::InferenceModule;
use crate::yourtts::{YourTTSEngine, YourTTSHttpConfig};
use crate::speaker_embedding_client::{SpeakerEmbeddingClient, ExtractEmbeddingResult};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

/// 说话者识别结果
#[derive(Debug, Clone)]
pub struct SpeakerIdentificationResult {
    /// 说话者 ID
    pub speaker_id: String,
    /// 是否为新的说话者
    pub is_new_speaker: bool,
    /// 识别置信度（0.0-1.0）
    pub confidence: f32,
    /// 说话者的音色特征向量（用于 Voice Cloning）
    pub voice_embedding: Option<Vec<f32>>,
    /// 估计的性别（用于选择默认音色）
    pub estimated_gender: Option<String>,
}

/// 音色识别模块
pub struct SpeakerIdentifier {
    enabled: bool,
    model_loaded: bool,
    /// Speaker Embedding HTTP 客户端
    embedding_client: Option<Arc<SpeakerEmbeddingClient>>,
    /// 相似度阈值（0.0-1.0），超过此值认为是同一说话者
    similarity_threshold: f32,
    /// 已有说话者的 embedding 库
    /// Key: speaker_id, Value: embedding vector
    speaker_embeddings: Arc<tokio::sync::RwLock<HashMap<String, Vec<f32>>>>,
    /// 下一个说话者 ID 的计数器
    next_speaker_id: Arc<tokio::sync::RwLock<u32>>,
    /// 单人模式下的固定 speaker_id
    single_user_speaker_id: Arc<tokio::sync::RwLock<Option<String>>>,
    /// 识别模式：单人模式或多人模式
    mode: Arc<tokio::sync::RwLock<SpeakerIdentificationMode>>,
}

/// 说话者识别模式
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpeakerIdentificationMode {
    /// 单人模式：所有语音视为同一用户
    SingleUser,
    /// 多人模式：区分不同说话者
    MultiUser,
}

#[async_trait]
impl InferenceModule for SpeakerIdentifier {
    fn name(&self) -> &str {
        "speaker_identification"
    }

    fn is_enabled(&self) -> bool {
        self.enabled && self.model_loaded
    }

    async fn enable(&mut self) -> Result<()> {
        if !self.model_loaded {
            // 初始化 Speaker Embedding 客户端
            let client = SpeakerEmbeddingClient::new_with_url(None)?;
            self.embedding_client = Some(Arc::new(client));
            self.model_loaded = true;
        }
        self.enabled = true;
        Ok(())
    }

    async fn disable(&mut self) -> Result<()> {
        self.enabled = false;
        // 不卸载客户端，保留在内存中以便快速重新启用
        Ok(())
    }
}

impl SpeakerIdentifier {
    pub fn new() -> Self {
        Self {
            enabled: false,
            model_loaded: false,
            embedding_client: None,
            similarity_threshold: 0.7,
            speaker_embeddings: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            next_speaker_id: Arc::new(tokio::sync::RwLock::new(1)),
            single_user_speaker_id: Arc::new(tokio::sync::RwLock::new(None)),
            mode: Arc::new(tokio::sync::RwLock::new(SpeakerIdentificationMode::SingleUser)),
        }
    }

    /// 识别说话者
    /// 
    /// # Arguments
    /// * `audio_data` - 音频数据（f32 格式，16kHz 单声道）
    /// 
    /// # Returns
    /// 返回说话者识别结果
    pub async fn identify(&self, audio_data: &[f32]) -> Result<SpeakerIdentificationResult> {
        if !self.is_enabled() {
            return Err(anyhow::anyhow!("Speaker identification module is not enabled"));
        }

        let client = self.embedding_client.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Embedding client not initialized"))?;

        let mode = *self.mode.read().await;

        match mode {
            SpeakerIdentificationMode::SingleUser => {
                self.identify_single_user_mode(client, audio_data).await
            }
            SpeakerIdentificationMode::MultiUser => {
                self.identify_multi_user_mode(client, audio_data).await
            }
        }
    }

    /// 单人模式：所有语音视为同一用户
    async fn identify_single_user_mode(
        &self,
        client: &SpeakerEmbeddingClient,
        audio_data: &[f32],
    ) -> Result<SpeakerIdentificationResult> {
        // 1. 获取或创建固定的 speaker_id
        let speaker_id = {
            let mut single_id = self.single_user_speaker_id.write().await;
            if single_id.is_none() {
                *single_id = Some("single_user".to_string());
            }
            single_id.clone().unwrap()
        };

        // 2. 提取 embedding
        let extract_result = client.extract_embedding(audio_data).await?;

        // 3. 更新或保存 embedding
        if let Some(embedding) = extract_result.embedding {
            let mut embeddings = self.speaker_embeddings.write().await;
            if let Some(existing_emb) = embeddings.get_mut(&speaker_id) {
                // 使用加权平均更新 embedding（持续优化音色）
                for (i, new_val) in embedding.iter().enumerate() {
                    if i < existing_emb.len() {
                        existing_emb[i] = existing_emb[i] * 0.7 + new_val * 0.3;
                    }
                }
            } else {
                // 首次保存 embedding
                embeddings.insert(speaker_id.clone(), embedding.clone());
            }
        }

        Ok(SpeakerIdentificationResult {
            speaker_id,
            is_new_speaker: false,
            confidence: 1.0,
            voice_embedding: extract_result.embedding,
            estimated_gender: extract_result.estimated_gender,
        })
    }

    /// 多人模式：区分不同说话者
    async fn identify_multi_user_mode(
        &self,
        client: &SpeakerEmbeddingClient,
        audio_data: &[f32],
    ) -> Result<SpeakerIdentificationResult> {
        // 1. 提取 embedding
        let extract_result = client.extract_embedding(audio_data).await?;

        // 2. 如果音频太短，根据性别返回默认 speaker_id
        if extract_result.use_default {
            let estimated_gender = extract_result.estimated_gender.as_deref().unwrap_or("unknown");
            let speaker_id = match estimated_gender.to_lowercase().as_str() {
                "male" | "m" => "default_male".to_string(),
                "female" | "f" => "default_female".to_string(),
                _ => "default_speaker".to_string(),
            };

            return Ok(SpeakerIdentificationResult {
                speaker_id,
                is_new_speaker: false,
                confidence: 0.8,
                voice_embedding: None,
                estimated_gender: extract_result.estimated_gender,
            });
        }

        // 3. 如果有 embedding，查找最相似的说话者
        let embedding = extract_result.embedding.ok_or_else(|| {
            anyhow::anyhow!("No embedding extracted")
        })?;

        let (speaker_id, is_new_speaker, confidence) = {
            let embeddings = self.speaker_embeddings.read().await;
            
            if embeddings.is_empty() {
                // 第一个说话者
                let new_id = self.generate_speaker_id().await;
                (new_id, true, 1.0)
            } else {
                // 查找最相似的说话者
                let mut best_match: Option<(String, f32)> = None;
                
                for (id, existing_emb) in embeddings.iter() {
                    let similarity = Self::cosine_similarity(&embedding, existing_emb);
                    
                    if let Some((_, best_sim)) = best_match {
                        if similarity > best_sim {
                            best_match = Some((id.clone(), similarity));
                        }
                    } else {
                        best_match = Some((id.clone(), similarity));
                    }
                }

                if let Some((best_id, best_sim)) = best_match {
                    if best_sim >= self.similarity_threshold {
                        // 同一说话者
                        (best_id, false, best_sim)
                    } else {
                        // 新说话者
                        let new_id = self.generate_speaker_id().await;
                        (new_id, true, 1.0 - best_sim)
                    }
                } else {
                    let new_id = self.generate_speaker_id().await;
                    (new_id, true, 1.0)
                }
            }
        };

        // 4. 如果是新说话者，保存 embedding
        if is_new_speaker {
            let mut embeddings = self.speaker_embeddings.write().await;
            embeddings.insert(speaker_id.clone(), embedding.clone());
        }

        Ok(SpeakerIdentificationResult {
            speaker_id,
            is_new_speaker,
            confidence,
            voice_embedding: Some(embedding),
            estimated_gender: extract_result.estimated_gender,
        })
    }

    /// 生成新的说话者 ID
    async fn generate_speaker_id(&self) -> String {
        let mut counter = self.next_speaker_id.write().await;
        let id = format!("speaker_{}", *counter);
        *counter += 1;
        id
    }

    /// 计算两个 embedding 的余弦相似度
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() {
            return 0.0;
        }

        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a * norm_b)
    }

    /// 设置识别模式
    pub async fn set_mode(&self, mode: SpeakerIdentificationMode) {
        let mut current_mode = self.mode.write().await;
        *current_mode = mode;
    }

    /// 重置识别器状态
    pub async fn reset(&self) -> Result<()> {
        let mut embeddings = self.speaker_embeddings.write().await;
        let mut counter = self.next_speaker_id.write().await;
        let mut single_id = self.single_user_speaker_id.write().await;
        
        embeddings.clear();
        *counter = 1;
        *single_id = None;
        
        Ok(())
    }
}

/// 音色生成/克隆模块
pub struct VoiceCloner {
    enabled: bool,
    model_loaded: bool,
    yourtts_engine: Option<Arc<YourTTSEngine>>,
}

#[async_trait]
impl InferenceModule for VoiceCloner {
    fn name(&self) -> &str {
        "voice_cloning"
    }

    fn is_enabled(&self) -> bool {
        self.enabled && self.model_loaded
    }

    async fn enable(&mut self) -> Result<()> {
        if !self.model_loaded {
            // 初始化 YourTTS 引擎
            self.initialize().await?;
            self.model_loaded = true;
        }
        self.enabled = true;
        Ok(())
    }

    async fn disable(&mut self) -> Result<()> {
        self.enabled = false;
        Ok(())
    }
}

impl VoiceCloner {
    pub fn new() -> Self {
        Self {
            enabled: false,
            model_loaded: false,
            yourtts_engine: None,
        }
    }

    /// 初始化 YourTTS 引擎
    pub async fn initialize(&mut self) -> Result<()> {
        if self.yourtts_engine.is_none() {
            let config = YourTTSHttpConfig::default();
            let engine = YourTTSEngine::new(Some(config))?;
            self.yourtts_engine = Some(Arc::new(engine));
        }
        Ok(())
    }

    /// 音色克隆
    /// 
    /// # Arguments
    /// * `text` - 要合成的文本
    /// * `speaker_id` - 说话人 ID（用于从 YourTTS 服务缓存中获取音色特征）
    /// * `lang` - 语言代码（可选）
    /// 
    /// # Returns
    /// 返回 PCM16 格式的音频数据（16kHz, 16bit, 单声道）
    pub async fn clone_voice(
        &self,
        text: &str,
        speaker_id: &str,
        lang: Option<&str>,
    ) -> Result<Vec<u8>> {
        if !self.is_enabled() {
            return Err(anyhow::anyhow!("Voice cloning module is not enabled"));
        }

        let engine = self.yourtts_engine.as_ref()
            .ok_or_else(|| anyhow::anyhow!("YourTTS engine not initialized"))?;

        // 调用 YourTTS 服务进行音色克隆
        let lang_str = lang.unwrap_or("en");
        let audio = engine.synthesize(text, lang_str, Some(speaker_id)).await?;

        Ok(audio)
    }
}
