use crate::node_registry::NodeRegistry;
use crate::messages::{FeatureFlags, PipelineConfig};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub job_id: String,
    pub session_id: String,
    pub utterance_index: u64,
    pub src_lang: String,
    pub tgt_lang: String,
    pub dialect: Option<String>,
    pub features: Option<FeatureFlags>,
    pub pipeline: PipelineConfig,
    pub audio_data: Vec<u8>,
    pub audio_format: String,
    pub sample_rate: u32,
    pub assigned_node_id: Option<String>,
    pub status: JobStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Assigned,
    Processing,
    Completed,
    Failed,
}

#[derive(Clone)]
pub struct JobDispatcher {
    node_registry: Arc<NodeRegistry>,
    jobs: Arc<RwLock<std::collections::HashMap<String, Job>>>,
}

impl JobDispatcher {
    pub fn new(node_registry: Arc<NodeRegistry>) -> Self {
        Self {
            node_registry,
            jobs: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub async fn create_job(
        &self,
        session_id: String,
        utterance_index: u64,
        src_lang: String,
        tgt_lang: String,
        dialect: Option<String>,
        features: Option<FeatureFlags>,
        pipeline: PipelineConfig,
        audio_data: Vec<u8>,
        audio_format: String,
        sample_rate: u32,
        preferred_node_id: Option<String>,
    ) -> Job {
        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        
        let assigned_node_id = if let Some(node_id) = preferred_node_id {
            // 如果指定了节点，检查节点是否可用
            if self.node_registry.is_node_available(&node_id).await {
                Some(node_id)
            } else {
                // 回退到功能感知选择
                self.node_registry.select_node_with_features(&src_lang, &tgt_lang, &features, true).await
            }
        } else {
            // 功能感知选择节点
            self.node_registry.select_node_with_features(&src_lang, &tgt_lang, &features, true).await
        };

        let job = Job {
            job_id: job_id.clone(),
            session_id,
            utterance_index,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pipeline,
            audio_data,
            audio_format,
            sample_rate,
            assigned_node_id: assigned_node_id.clone(),
            status: if assigned_node_id.is_some() {
                JobStatus::Assigned
            } else {
                JobStatus::Pending
            },
            created_at: chrono::Utc::now(),
        };

        let mut jobs = self.jobs.write().await;
        jobs.insert(job_id, job.clone());
        job
    }

    pub async fn get_job(&self, job_id: &str) -> Option<Job> {
        let jobs = self.jobs.read().await;
        jobs.get(job_id).cloned()
    }

    pub async fn update_job_status(&self, job_id: &str, status: JobStatus) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = status;
            true
        } else {
            false
        }
    }
}

