// Phase 2 节点能力同步

use crate::messages::ServiceType;

impl Phase2Runtime {
    /// Phase 2：同步节点能力到 Redis
    /// 将节点能力信息存储到 Redis Hash 中，不占用内存
    pub async fn sync_node_capabilities_to_redis(
        &self,
        node_id: &str,
        capabilities: &[crate::messages::CapabilityByType],
    ) {
        let capabilities_key = self.node_capabilities_key(node_id);
        
        info!(
            node_id = %node_id,
            capability_count = capabilities.len(),
            "开始同步节点能力信息到 Redis"
        );
        
        // 构建能力映射
        let mut capability_map = std::collections::HashMap::<String, String>::new();
        for cap in capabilities {
            let service_type_str = match &cap.r#type {
                ServiceType::Asr => "asr",
                ServiceType::Nmt => "nmt",
                ServiceType::Tts => "tts",
                ServiceType::Tone => "tone",
                ServiceType::Semantic => "semantic",
            };
            capability_map.insert(service_type_str.to_string(), cap.ready.to_string());
        }

        // 使用 HMSET 批量设置
        if !capability_map.is_empty() {
            let mut cmd = redis::cmd("HMSET");
            cmd.arg(&capabilities_key);
            for (key, value) in &capability_map {
                cmd.arg(key).arg(value);
            }
            // HMSET 返回 "OK" 字符串，不是数字
            match self.redis.query::<String>(cmd).await {
                Ok(_) => {
                    info!(
                        node_id = %node_id,
                        capability_count = capability_map.len(),
                        "节点能力信息已同步到 Redis"
                    );
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        node_id = %node_id,
                        "节点能力信息同步到 Redis 失败"
                    );
                }
            }
        }

        // 设置 TTL（1 小时，与容量信息一致）
        let _ = self.redis.query::<i64>({
            let mut c = redis::cmd("EXPIRE");
            c.arg(&capabilities_key).arg(3600);
            c
        }).await;
    }

    /// Phase 2：从 Redis 读取节点能力
    /// 返回 ServiceType -> ready 的映射
    pub async fn get_node_capabilities_from_redis(
        &self,
        node_id: &str,
    ) -> Option<std::collections::HashMap<ServiceType, bool>> {
        let capabilities_key = self.node_capabilities_key(node_id);
        
        debug!(
            node_id = %node_id,
            "从 Redis 读取节点能力信息"
        );
        
        // 读取所有字段
        let result: Result<std::collections::HashMap<String, String>, _> = self.redis.query({
            let mut c = redis::cmd("HGETALL");
            c.arg(&capabilities_key);
            c
        }).await;

        match result {
            Ok(map) => {
                let mut capabilities = std::collections::HashMap::new();
                for (key, value) in map {
                    let service_type = match key.as_str() {
                        "asr" => ServiceType::Asr,
                        "nmt" => ServiceType::Nmt,
                        "tts" => ServiceType::Tts,
                        "tone" => ServiceType::Tone,
                        "semantic" => ServiceType::Semantic,
                        _ => {
                            warn!(
                                node_id = %node_id,
                                unknown_key = %key,
                                "未知的服务类型键"
                            );
                            continue;
                        }
                    };
                    let ready = value == "true";
                    capabilities.insert(service_type, ready);
                }
                debug!(
                    node_id = %node_id,
                    capability_count = capabilities.len(),
                    "成功从 Redis 读取节点能力信息"
                );
                Some(capabilities)
            }
            Err(e) => {
                warn!(
                    error = %e,
                    node_id = %node_id,
                    "从 Redis 读取节点能力失败"
                );
                None
            }
        }
    }

    /// Phase 2：检查节点是否有某个服务能力（从 Redis 读取）
    pub async fn has_node_capability(
        &self,
        node_id: &str,
        service_type: &ServiceType,
    ) -> bool {
        if let Some(capabilities) = self.get_node_capabilities_from_redis(node_id).await {
            let ready = capabilities.get(service_type).copied().unwrap_or(false);
            debug!(
                node_id = %node_id,
                service_type = ?service_type,
                ready = ready,
                "检查节点服务能力"
            );
            ready
        } else {
            debug!(
                node_id = %node_id,
                service_type = ?service_type,
                "无法从 Redis 读取节点能力，返回 false"
            );
            false
        }
    }
}
