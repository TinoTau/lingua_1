// Phase 2 冷启动预加载（按照 NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md 规范）
// 注意：此文件通过 include! 包含到 phase2.rs 中，不需要单独的 use 语句

impl Phase2Runtime {
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
            let app_state_clone = app_state.clone();
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
                
                // upsert 到本地 NodeRegistry
                app_state_clone.node_registry.upsert_node_from_snapshot(node, Some(&rt_clone)).await;
                
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
    async fn preload_all_pools(&self, app_state: &AppState) -> Result<usize, anyhow::Error> {
        // 获取 Phase3 配置
        let phase3_config = app_state.node_registry.phase3_config().await;
        
        if !phase3_config.enabled || phase3_config.pools.is_empty() {
            debug!("Phase3 未启用或 Pool 配置为空，跳过 Pool 预加载");
            return Ok(0);
        }
        
        info!(pool_count = phase3_config.pools.len(), "开始预加载 Pool 成员...");
        
        // 批量读取所有 Pool 的成员
        let pool_members = self.get_all_pool_members_from_redis(&phase3_config.pools).await;
        
        debug!(
            pool_count = pool_members.len(),
            total_nodes = pool_members.values().map(|v| v.len()).sum::<usize>(),
            "已预加载所有 Pool 成员"
        );
        
        // 将 Pool 成员信息更新到本地 NodeRegistry（如果需要）
        // 注意：这里只是预加载到 Redis，实际的 Pool 成员索引已经在 NodeRegistry 中维护
        // 如果需要同步到本地，可以调用相应的方法
        
        Ok(pool_members.len())
    }

    /// 预加载全体 lang-index（从 Phase3Config 获取所有语言对，然后从 Redis 读取每个语言对的索引）
    async fn preload_all_lang_indices(&self, app_state: &AppState) -> Result<usize, anyhow::Error> {
        // 获取 Phase3 配置
        let phase3_config = app_state.node_registry.phase3_config().await;
        
        if !phase3_config.enabled || phase3_config.pools.is_empty() {
            debug!("Phase3 未启用或 Pool 配置为空，跳过语言索引预加载");
            return Ok(0);
        }
        
        // 从 Pool 配置中收集所有语言对
        let mut lang_pairs = HashSet::new();
        for pool in &phase3_config.pools {
            // 从 pool.name 提取语言对（格式: "zh-en" 或 "*-en"）
            let parts: Vec<&str> = pool.name.split('-').collect();
            if parts.len() == 2 {
                let src_lang = parts[0];
                let tgt_lang = parts[1];
                if src_lang != "*" {
                    lang_pairs.insert((src_lang.to_string(), tgt_lang.to_string()));
                }
            }
        }
        
        if lang_pairs.is_empty() {
            debug!("未找到语言对，跳过语言索引预加载");
            return Ok(0);
        }
        
        info!(lang_pair_count = lang_pairs.len(), "开始预加载语言索引...");
        
        // 并行读取所有语言索引
        let mut handles = Vec::new();
        for (src_lang, tgt_lang) in lang_pairs {
            let rt_clone = self.clone();
            let src_lang_clone = src_lang.clone();
            let tgt_lang_clone = tgt_lang.clone();
            
            let handle = tokio::spawn(async move {
                rt_clone.get_lang_index(&src_lang_clone, &tgt_lang_clone).await
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
}
