// Phase 2 Request 绑定管理

impl RedisRuntime {
    /// Phase 2：获取 request_id 绑定（跨实例幂等）
    pub async fn get_request_binding(&self, request_id: &str) -> Option<RequestBinding> {
        let key = self.request_binding_key(request_id);
        let json = self.redis.get_string(&key).await.ok().flatten()?;
        serde_json::from_str(&json).ok()
    }


    /// 优化：合并 mark_request_dispatched 和 job_fsm_to_dispatched
    /// 减少网络往返（从2次减少到1次，如果request_id为空则只执行job_fsm）
    pub async fn mark_request_and_job_fsm_dispatched(
        &self,
        request_id: &str,
        job_id: &str,
        attempt_id: u32,
    ) -> bool {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let request_key = if !request_id.is_empty() {
            Some(self.request_binding_key(request_id))
        } else {
            None
        };
        let job_fsm_key = self.job_fsm_key(job_id);
        
        // 如果request_id为空，只执行job_fsm更新
        if request_key.is_none() {
            return self.job_fsm_to_dispatched(job_id, attempt_id).await;
        }
        
        // 合并操作：先更新request_binding，然后更新job_fsm
        // 由于request_binding需要JSON解析，我们仍然需要先读取
        // 但可以在一个Lua脚本中原子性地更新两个key
        let request_key = request_key.unwrap();
        
        // 先读取request_binding（需要JSON解析）
        if let Some(mut b) = self.get_request_binding(request_id).await {
            b.dispatched_to_node = true;
            let ttl_ms = b.expire_at_ms - now_ms;
            let ttl_s = (ttl_ms.max(0) as u64) / 1000;
            if ttl_s == 0 {
                // TTL接近0，只更新job_fsm
                return self.job_fsm_to_dispatched(job_id, attempt_id).await;
            }
            let json = match serde_json::to_string(&b) {
                Ok(v) => v,
                Err(_) => {
                    // JSON序列化失败，只更新job_fsm
                    return self.job_fsm_to_dispatched(job_id, attempt_id).await;
                }
            };
            
            // 使用Lua脚本原子性地更新request_binding和job_fsm
            let script = r#"
-- 更新 request_binding
if ARGV[1] ~= '' then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
end

-- 更新 job_fsm
local st = redis.call('HGET', KEYS[2], 'state')
if st == false then return 0 end
if st == 'DISPATCHED' or st == 'ACCEPTED' or st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'CREATED' then return 0 end
local a = redis.call('HGET', KEYS[2], 'attempt_id')
if a ~= ARGV[3] then return 0 end
redis.call('HSET', KEYS[2], 'state', 'DISPATCHED', 'updated_at_ms', ARGV[4])
return 1
"#;
            let mut cmd = redis::cmd("EVAL");
            cmd.arg(script)
                .arg(2)
                .arg(&request_key)
                .arg(&job_fsm_key)
                .arg(&json)
                .arg(ttl_s.max(1).to_string())
                .arg(attempt_id.to_string())
                .arg(now_ms.to_string());
            
            self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
        } else {
            // request_binding不存在，只更新job_fsm
            self.job_fsm_to_dispatched(job_id, attempt_id).await
        }
    }

    pub async fn update_request_binding_node(&self, request_id: &str, node_id: &str) {
        if let Some(mut b) = self.get_request_binding(request_id).await {
            b.node_id = Some(node_id.to_string());
            b.dispatched_to_node = false;
            let ttl_ms = b.expire_at_ms - chrono::Utc::now().timestamp_millis();
            let ttl_s = (ttl_ms.max(0) as u64) / 1000;
            if ttl_s == 0 {
                return;
            }
            let json = match serde_json::to_string(&b) {
                Ok(v) => v,
                Err(_) => return,
            };
            let _ = self
                .redis
                .set_ex_string(&self.request_binding_key(request_id), &json, ttl_s.max(1))
                .await;
        }
    }

}
