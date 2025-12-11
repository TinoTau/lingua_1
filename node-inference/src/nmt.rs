//! M2M100 NMT 推理引擎
//! 
//! 支持两种方式：
//! 1. HTTP 客户端方式（推荐）：调用本地 Python M2M100 服务
//! 2. ONNX 方式：直接加载 ONNX 模型进行推理（待实现）

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use reqwest::Client;
use tracing::{info, error};

/// NMT 翻译请求
#[derive(Debug, Serialize)]
struct NmtTranslateRequest {
    text: String,
    src_lang: String,
    tgt_lang: String,
}

/// NMT 翻译响应
#[derive(Debug, Deserialize)]
struct NmtTranslateResponse {
    #[allow(dead_code)]
    ok: bool,
    text: Option<String>,
    error: Option<String>,
}

/// M2M100 NMT 推理引擎
pub struct NMTEngine {
    /// HTTP 服务 URL（如果使用 HTTP 客户端方式）
    service_url: Option<String>,
    /// HTTP 客户端
    http_client: Option<Client>,
    /// 模型路径（如果使用 ONNX 方式）
    model_path: Option<PathBuf>,
}

impl NMTEngine {
    /// 创建使用 HTTP 客户端的 NMT 引擎（推荐）
    /// 
    /// # Arguments
    /// * `service_url` - M2M100 HTTP 服务 URL（如 "http://127.0.0.1:5008"）
    /// 
    /// # Returns
    /// 返回 `NMTEngine` 实例
    pub fn new_with_http_client(service_url: Option<String>) -> Result<Self> {
        let url = service_url
            .or_else(|| std::env::var("NMT_SERVICE_URL").ok())
            .unwrap_or_else(|| "http://127.0.0.1:5008".to_string());

        info!("Initializing NMT engine with HTTP client: {}", url);

        Ok(Self {
            service_url: Some(url),
            http_client: Some(Client::new()),
            model_path: None,
        })
    }

    /// 创建使用 ONNX 模型的 NMT 引擎（待实现）
    /// 
    /// # Arguments
    /// * `model_dir` - 模型目录路径（如 `models/nmt/m2m100-en-zh/`）
    /// 
    /// # Returns
    /// 返回 `NMTEngine` 实例
    pub fn new_with_onnx(_model_dir: PathBuf) -> Result<Self> {
        // TODO: 实现 ONNX 模型加载
        Err(anyhow!("ONNX mode is not yet implemented. Please use HTTP client mode."))
    }

    /// 从模型目录创建 NMT 引擎（自动选择 HTTP 或 ONNX）
    /// 
    /// # Arguments
    /// * `model_dir` - 模型目录路径（如果使用 ONNX 方式）
    /// 
    /// # Returns
    /// 返回 `NMTEngine` 实例
    /// 
    /// # Note
    /// 当前默认使用 HTTP 客户端方式
    pub fn new(_model_dir: PathBuf) -> Result<Self> {
        // 默认使用 HTTP 客户端方式
        Self::new_with_http_client(None)
    }

    /// 翻译文本
    /// 
    /// # Arguments
    /// * `text` - 源文本
    /// * `src_lang` - 源语言代码（如 "en", "zh"）
    /// * `tgt_lang` - 目标语言代码（如 "en", "zh"）
    /// 
    /// # Returns
    /// 返回翻译后的文本
    pub async fn translate(&self, text: &str, src_lang: &str, tgt_lang: &str) -> Result<String> {
        if let (Some(ref url), Some(ref client)) = (&self.service_url, &self.http_client) {
            self.translate_http(client, url, text, src_lang, tgt_lang).await
        } else if let Some(ref _model_path) = self.model_path {
            // TODO: 实现 ONNX 推理
            Err(anyhow!("ONNX mode is not yet implemented"))
        } else {
            Err(anyhow!("NMT engine is not properly initialized"))
        }
    }

    /// 使用 HTTP 客户端进行翻译
    async fn translate_http(
        &self,
        client: &Client,
        base_url: &str,
        text: &str,
        src_lang: &str,
        tgt_lang: &str,
    ) -> Result<String> {
        let url = format!("{}/v1/translate", base_url);
        
        info!("Sending NMT translation request to {}: text='{}', src_lang='{}', tgt_lang='{}'", 
            url, text, src_lang, tgt_lang);
        
        let request = NmtTranslateRequest {
            text: text.to_string(),
            src_lang: src_lang.to_string(),
            tgt_lang: tgt_lang.to_string(),
        };

        let response = client
            .post(&url)
            .json(&request)
            .send()
            .await?;
        
        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("NMT HTTP error: {} - {}", status, error_text);
            return Err(anyhow!(
                "NMT HTTP error: {} - {}",
                status,
                error_text
            ));
        }
        
        let body: NmtTranslateResponse = response.json().await?;
        
        if let Some(ref translated_text) = body.text {
            info!("NMT translation received: '{}'", translated_text);
            Ok(translated_text.clone())
        } else if let Some(ref error_msg) = body.error {
            error!("NMT service returned error: {}", error_msg);
            Err(anyhow!("NMT service error: {}", error_msg))
        } else {
            Err(anyhow!("NMT service returned empty response"))
        }
    }
}

