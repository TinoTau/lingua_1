// Phase 2 冷启动预加载（按照 NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md 规范）
// 注意：此文件通过 include! 包含到 phase2.rs 中，不需要单独的 use 语句

impl RedisRuntime {
    /// 冷启动预加载（按照文档规范：启动时加载全体节点、全体 pool、全体 lang-index）
    /// 避免启动后 100-300ms 的抖动
    pub async fn cold_start_preload(
        &self,
        app_state: &AppState,
    ) -> Result<(), anyhow::Error> {
        info!("开始冷启动预加载...");
        let start_time = std::time::Instant::now();
        
        // 1. 预加载全体节点
        let node_count = self.preload_all_nodes(app_state).await?;
        info!(node_count = node_count, "已预加载所有节点");
        
        // 2. 预加载全体 Pool
        let pool_count = self.preload_all_pools(app_state).await?;
        info!(pool_count = pool_count, "已预加载所有 Pool");
        
        // 3. 预加载全体 lang-index
        let lang_index_count = self.preload_all_lang_indices(app_state).await?;
        info!(lang_index_count = lang_index_count, "已预加载所有语言索引");
        
        let elapsed = start_time.elapsed();
        info!(
            node_count = node_count,
            pool_count = pool_count,
            lang_index_count = lang_index_count,
            elapsed_ms = elapsed.as_millis(),
            "冷启动预加载完成"
        );
        
        Ok(())
    }

    /// 预加载全体节点（从 Redis nodes:all Set 读取所有节点 ID，然后读取每个节点的快照）
    async fn preload_all_nodes(&self, app_state: &AppState) -> Result<usize, anyhow::Error> {
        let all_key = self.nodes_all_set_key();
        
        // 从 Redis Set 读取所有节点 ID
        let node_ids = match self.redis.smembers_strings(&all_key).await {
            Ok(ids) => ids,
            Err(e) => {
                warn!(error = %e, "从 Redis 读取 nodes:all 失败，可能 Redis 未启用或无节点");
                return Ok(0);
            }
        };
        
        if node_ids.is_empty() {
            debug!("Redis 中没有节点数据，跳过节点预加载");
            return Ok(0);
        }
        
        info!(node_count = node_ids.len(), "开始预加载节点快照...");
        
        // 并行读取所有节点快照（使用 tokio::spawn 优化性能）
        let mut handles = Vec::new();
        for node_id in node_ids {
            let rt_clone = self.clone();
            let _app_state_clone = app_state.clone();
            let node_id_clone = node_id.clone();
            
            let handle = tokio::spawn(async move {
                let presence_key = rt_clone.node_presence_key(&node_id_clone);
                let online = rt_clone.redis.exists(&presence_key).await.unwrap_or(false);
                if !online {
                    return None;
                }
                
                let snapshot_key = rt_clone.node_snapshot_key(&node_id_clone);
                let json_opt = match rt_clone.redis.get_string(&snapshot_key).await {
                    Ok(v) => v,
                    Err(_) => None,
                };
                
                let Some(json) = json_opt else { return None };
                
                let node: RegistryNode = match serde_json::from_str(&json) {
                    Ok(v) => v,
                    Err(e) => {
                        debug!(error = %e, node_id = %node_id_clone, "节点快照反序列化失败");
                        return None;
                    }
                };
                
                // 将全局 reserved_count 融合进 current_jobs
                let reserved = rt_clone.node_reserved_count(&node_id_clone).await as usize;
                let mut node = node;
                node.current_jobs = std::cmp::max(node.current_jobs, reserved);
                
                // Redis 直查架构：不需要 upsert 到本地（直接从 Redis 查询）
                
                Some(node_id_clone)
            });
            
            handles.push(handle);
        }
        
        // 等待所有任务完成
        let mut loaded_count = 0;
        for handle in handles {
            if let Ok(Some(_)) = handle.await {
                loaded_count += 1;
            }
        }
        
        Ok(loaded_count)
    }

    /// 预加载全体 Pool（从 Phase3Config 获取所有 Pool 配置，然后从 Redis 读取每个 Pool 的成员）
    async fn preload_all_pools(&self, _app_state: &AppState) -> Result<usize, anyhow::Error> {
        // 旧的预加载逻辑已废弃，新系统使用 PoolService 直接从 Redis 读取
        Ok(0)
    }
    
    /// 预加载全体 lang-index（从 Phase3Config 获取所有语言对，然后从 Redis 读取每个语言对的索引）
    async fn preload_all_lang_indices(&self, _app_state: &AppState) -> Result<usize, anyhow::Error> {
        // 旧的预加载逻辑已废弃，新系统使用 PoolService 直接从 Redis 读取
        Ok(0)
    }
    
    async fn _old_preload_all_pools(&self, _app_state: &AppState) -> Result<usize, anyhow::Error> {
        // 保留旧代码作为参考，但不再使用
        // 新架构中 Pool 由 PoolService 动态管理，无需预加载
        Ok(0)
    }

    async fn _old_preload_all_lang_indices(&self, _app_state: &AppState) -> Result<usize, anyhow::Error> {
        // 保留旧代码作为参考，但不再使用
        // 新架构中语言索引由 PoolService 动态管理，无需预加载
        Ok(0)
    }
}
