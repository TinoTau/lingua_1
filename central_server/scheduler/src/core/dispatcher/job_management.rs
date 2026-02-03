use super::JobDispatcher;
use crate::core::dispatcher::Job;
use crate::messages::{FeatureFlags, PipelineConfig};
use crate::utils::ModuleResolver;
use anyhow::Result;

impl JobDispatcher {
    /// 获取 Job（从Redis，SSOT）
    pub async fn get_job(&self, job_id: &str) -> Option<Job> {
        self.job_repo.get_job(job_id).await.ok().flatten()
    }

    /// 列出所有 Job（用于超时检查）
    /// 返回 (job_id, status, dispatched_at_ms) 元组列表
    pub async fn list_jobs_for_timeout_check(&self) -> Vec<(String, crate::core::dispatcher::JobStatus, Option<i64>)> {
        self.job_repo.list_jobs_for_timeout_check().await.unwrap_or_default()
    }
    
    /// 列出所有 Job（完整对象，用于超时检查）
    pub async fn list_jobs_snapshot(&self) -> Vec<Job> {
        self.job_repo.list_all_jobs().await.unwrap_or_default()
    }

    /// 更新 Job 状态（Redis，SSOT）
    pub async fn update_job_status(&self, job_id: &str, status: crate::core::dispatcher::JobStatus) -> bool {
        self.job_repo.update_job_status(job_id, status).await.is_ok()
    }

    /// 保存 Job（Redis，SSOT）
    pub async fn save_job(&self, job: &Job) -> Result<()> {
        self.job_repo.save_job(job).await
    }
    
    /// Phase 1：用于超时/重派的内部状态更新（使用 Lua 脚本原子化）
    /// - 设置新节点
    /// - 递增 dispatch_attempt_id（原子性抢占）
    /// 返回: None=失败, Some(new_attempt_id)=成功
    /// 
    /// 优化：接受 job 对象作为参数，避免内部重复查询
    pub async fn set_job_assigned_node_for_failover(&self, job: &Job, new_node_id: String) -> Option<u32> {
        use tracing::{info, warn};
        
        let job_id = &job.job_id;
        
        // 检查状态
        if matches!(job.status, crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed) {
            warn!(job_id = %job_id, status = ?job.status, "set_job_assigned_node_for_failover: Job 已终止");
            return None;
        }
        
        let expected_attempt_id = job.dispatch_attempt_id;
        let request_id = job.request_id.clone();
        let ttl_seconds = 3600u64;
        
        // 使用 Lua 脚本原子性更新
        let result = match self.job_repo.failover_reassign_job_atomic(
            job_id,
            &new_node_id,
            expected_attempt_id,
            ttl_seconds,
        ).await {
            Ok(code) => code,
            Err(e) => {
                warn!(job_id = %job_id, error = %e, "set_job_assigned_node_for_failover: Lua 脚本执行失败");
                return None;
            }
        };
        
        match result {
            0 => {
                warn!(job_id = %job_id, "set_job_assigned_node_for_failover: Job 不存在");
                None
            }
            -1i64 => {
                // Stale caller（attempt_id 已变化，其他实例已抢占）
                warn!(
                    job_id = %job_id,
                    expected_attempt_id = expected_attempt_id,
                    "set_job_assigned_node_for_failover: 调用方过期（attempt_id 已变化，其他实例已抢占）"
                );
                None
            }
            new_attempt_id if new_attempt_id >= 1 => {
                // 成功重派
                let new_attempt = new_attempt_id as u32;
                info!(
                    job_id = %job_id,
                    new_node_id = %new_node_id,
                    old_attempt_id = expected_attempt_id,
                    new_attempt_id = new_attempt,
                    "set_job_assigned_node_for_failover: 任务已原子性重派到新节点"
                );
                
                // Phase 2：更新 bind 的 node_id，并清理 dispatched 标记
                if let Some(ref rt) = self.redis_runtime {
                    if !request_id.is_empty() {
                        rt.update_request_binding_node(&request_id, &new_node_id).await;
                    }
                    // Phase 2：Job FSM reset -> CREATED（新 attempt）
                    let fsm_ttl = std::cmp::max(self.lease_seconds, self.reserved_ttl_seconds).saturating_add(300);
                    rt.job_fsm_reset_created(job_id, Some(&new_node_id), new_attempt, fsm_ttl).await;
                }
                
                Some(new_attempt)
            }
            _ => {
                warn!(job_id = %job_id, result = result, "set_job_assigned_node_for_failover: 未知的返回码");
                None
            }
        }
    }

    pub async fn required_types_for_job(&self, job: &Job) -> anyhow::Result<Vec<crate::messages::ServiceType>> {
        self.get_required_types_for_features(&job.pipeline, job.features.as_ref(), &job.src_lang, &job.tgt_lang)
    }

    /// 获取功能所需的类型列表
    pub(crate) fn get_required_types_for_features(
        &self,
        pipeline: &PipelineConfig,
        features: Option<&FeatureFlags>,
        _src_lang: &str,
        _tgt_lang: &str,
    ) -> anyhow::Result<Vec<crate::messages::ServiceType>> {
        let mut types = Vec::new();

        if pipeline.use_asr {
            types.push(crate::messages::ServiceType::Asr);
        }
        if pipeline.use_nmt {
            types.push(crate::messages::ServiceType::Nmt);
        }
        if pipeline.use_tts {
            types.push(crate::messages::ServiceType::Tts);
        }
        if pipeline.use_semantic {
            types.push(crate::messages::ServiceType::Semantic);
        }

        // 可选模块映射到类型（当前仅 tone 可选）
        if let Some(features) = features {
            let module_names = ModuleResolver::parse_features_to_modules(features);
            let optional_models = ModuleResolver::collect_required_models(&module_names)?;
            // tone: 若模块包含 tone（例如 voice_cloning 相关）则加入
            if optional_models.iter().any(|m| m.contains("tone") || m.contains("speaker") || m.contains("voice")) {
                types.push(crate::messages::ServiceType::Tone);
            }
        }

        types.sort();
        types.dedup();

        Ok(types)
    }

    /// 标记任务已派发（使用 Lua 脚本原子化）
    /// 返回: true=成功, false=失败
    /// 
    /// 优化：接受可选参数，避免重复查询
    pub async fn mark_job_dispatched(
        &self, 
        job_id: &str,
        request_id: Option<&str>,
        dispatch_attempt_id: Option<u32>,
    ) -> bool {
        use tracing::{info, warn};
        
        let now_ms = chrono::Utc::now().timestamp_millis();
        let ttl_seconds = 3600u64;  // 1小时
        
        // 使用 Lua 脚本原子性更新
        let result = match self.job_repo.mark_job_dispatched_atomic(job_id, now_ms, ttl_seconds).await {
            Ok(code) => code,
            Err(e) => {
                warn!(job_id = %job_id, error = %e, "mark_job_dispatched: Lua 脚本执行失败");
                return false;
            }
        };
        
        match result {
            0 => {
                warn!(job_id = %job_id, "mark_job_dispatched: Job 不存在");
                false
            }
            1 => {
                // 已派发（幂等）
                info!(job_id = %job_id, "mark_job_dispatched: Job 已经被标记为已分发（幂等调用）");
                true
            }
            2 => {
                // 成功更新
                info!(job_id = %job_id, "mark_job_dispatched: Job 状态已原子性更新为已分发");
                
                // Phase 2：同步更新 request_id bind 的 dispatched 标记和 Job FSM
                // 优化：使用传入的参数，避免重复查询
                if let Some(ref rt) = self.redis_runtime {
                    if let (Some(request_id), Some(dispatch_attempt_id)) = (request_id, dispatch_attempt_id) {
                        info!(
                            job_id = %job_id,
                            request_id = %request_id,
                            dispatch_attempt_id = dispatch_attempt_id,
                            "mark_job_dispatched: 合并更新 request_id 绑定和 Job FSM 状态为 DISPATCHED"
                        );
                        let _ = rt.mark_request_and_job_fsm_dispatched(
                            request_id,
                            job_id,
                            dispatch_attempt_id.max(1),
                        ).await;
                    } else {
                        // 如果没有传入参数，回退到查询（向后兼容）
                        if let Some(job) = self.get_job(job_id).await {
                            let request_id = &job.request_id;
                            let dispatch_attempt_id = job.dispatch_attempt_id;
                            let _ = rt.mark_request_and_job_fsm_dispatched(
                                request_id,
                                job_id,
                                dispatch_attempt_id.max(1),
                            ).await;
                        }
                    }
                }
                
                true
            }
            _ => {
                warn!(job_id = %job_id, result = result, "mark_job_dispatched: 未知的返回码");
                false
            }
        }
    }
    
    /// 清理已完成的任务（防止内存泄漏）
    /// 
    /// 定期调用此方法以清理已完成或失败的任务。
    /// 
    /// # 参数
    /// - `max_age_seconds`: 已完成任务的最大保留时间（秒）
    /// 
    /// # 返回
    /// 清理的任务数量
    pub async fn cleanup_completed_jobs(&self, max_age_seconds: i64) -> usize {
        use tracing::info;
        
        // 获取所有 Job（用于超时检查的轻量级列表）
        let jobs = self.list_jobs_for_timeout_check().await;
        let now = chrono::Utc::now();
        let mut cleaned = 0;
        
        for (job_id, status, _) in jobs {
            // 只处理已完成的任务
            if !matches!(
                status,
                crate::core::dispatcher::JobStatus::Completed 
                | crate::core::dispatcher::JobStatus::CompletedNoText
                | crate::core::dispatcher::JobStatus::Failed
            ) {
                continue;
            }
            
            // 获取完整 Job 以检查 created_at
            if let Some(job) = self.get_job(&job_id).await {
                let age = now.signed_duration_since(job.created_at).num_seconds();
                if age >= max_age_seconds {
                    // 删除旧任务
                    if self.job_repo.delete_job(&job_id).await.is_ok() {
                        info!(
                            job_id = %job_id,
                            status = ?status,
                            age_seconds = age,
                            "清理已完成的任务"
                        );
                        cleaned += 1;
                    }
                }
            }
        }
        
        if cleaned > 0 {
            info!(
                cleaned_count = cleaned,
                "Job 清理完成"
            );
        }
        
        cleaned
    }
}
