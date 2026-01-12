impl RedisHandle {
    /// 创建新的 RedisHandle（用于测试和内部使用）
    /// 
    /// # 注意
    /// 此方法主要用于测试。在生产代码中，应通过 Phase2Runtime 来获取 RedisHandle。
    #[allow(dead_code)] // 允许在测试中未使用的警告
    pub async fn connect(cfg: &crate::core::config::Phase2RedisConfig) -> anyhow::Result<Self> {
        let inner = match cfg.mode.as_str() {
            "cluster" => {
                let urls = if cfg.cluster_urls.is_empty() {
                    vec![cfg.url.clone()]
                } else {
                    cfg.cluster_urls.clone()
                };
                let client = redis::cluster::ClusterClient::new(urls)?;
                let conn = client.get_async_connection().await?;
                RedisConn::Cluster(conn)
            }
            _ => {
                let client = redis::Client::open(cfg.url.as_str())?;
                let conn = client.get_multiplexed_tokio_connection().await?;
                RedisConn::Single(conn)
            }
        };
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
        })
    }

    pub async fn query<T: redis::FromRedisValue>(&self, cmd: redis::Cmd) -> redis::RedisResult<T> {
        let mut guard = self.inner.lock().await;
        match &mut *guard {
            RedisConn::Single(c) => cmd.query_async(c).await,
            RedisConn::Cluster(c) => cmd.query_async(c).await,
        }
    }

    pub async fn set_ex_string(&self, key: &str, val: &str, ttl_seconds: u64) -> redis::RedisResult<()> {
        let mut cmd = redis::cmd("SET");
        cmd.arg(key).arg(val).arg("EX").arg(ttl_seconds.max(1));
        self.query(cmd).await
    }

    pub async fn get_string(&self, key: &str) -> redis::RedisResult<Option<String>> {
        let mut cmd = redis::cmd("GET");
        cmd.arg(key);
        self.query(cmd).await
    }

    async fn del(&self, key: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("DEL");
        cmd.arg(key);
        self.query(cmd).await
    }

    async fn del_if_value_matches(&self, key: &str, expected: &str) -> redis::RedisResult<u64> {
        // Lua: if GET == expected then DEL
        let script = r#"
local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(key).arg(expected);
        self.query(cmd).await
    }

    pub async fn exists(&self, key: &str) -> redis::RedisResult<bool> {
        let mut cmd = redis::cmd("EXISTS");
        cmd.arg(key);
        let v: u64 = self.query(cmd).await?;
        Ok(v > 0)
    }


    async fn xadd_payload_maxlen(&self, stream: &str, payload: &str, maxlen: usize) -> redis::RedisResult<String> {
        // XADD <stream> MAXLEN ~ <maxlen> * payload <payload>
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream)
            .arg("MAXLEN")
            .arg("~")
            .arg(maxlen.max(100))
            .arg("*")
            .arg("payload")
            .arg(payload);
        self.query(cmd).await
    }

    async fn xadd_dlq_maxlen(
        &self,
        stream: &str,
        maxlen: usize,
        payload: &str,
        src_stream: &str,
        src_id: &str,
        deliveries: u64,
    ) -> redis::RedisResult<String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream)
            .arg("MAXLEN")
            .arg("~")
            .arg(maxlen.max(100))
            .arg("*")
            .arg("payload")
            .arg(payload)
            .arg("src_stream")
            .arg(src_stream)
            .arg("src_id")
            .arg(src_id)
            .arg("deliveries")
            .arg(deliveries)
            .arg("moved_at_ms")
            .arg(now_ms);
        self.query(cmd).await
    }

    async fn sadd_string(&self, key: &str, member: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("SADD");
        cmd.arg(key).arg(member);
        self.query(cmd).await
    }

    async fn smembers_strings(&self, key: &str) -> redis::RedisResult<Vec<String>> {
        let mut cmd = redis::cmd("SMEMBERS");
        cmd.arg(key);
        self.query(cmd).await
    }

    async fn srem_string(&self, key: &str, member: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("SREM");
        cmd.arg(key).arg(member);
        self.query(cmd).await
    }

    async fn set_nx_px(&self, key: &str, val: &str, ttl_ms: u64) -> redis::RedisResult<bool> {
        // SET key val NX PX ttl
        let mut cmd = redis::cmd("SET");
        cmd.arg(key).arg(val).arg("NX").arg("PX").arg(ttl_ms.max(1));
        // OK => Some("OK")；失败 => Nil
        let r: Option<String> = self.query(cmd).await?;
        Ok(r.is_some())
    }

    async fn set_nx_ex_u64(&self, key: &str, val: u64, ttl_seconds: u64) -> redis::RedisResult<bool> {
        // SET key val NX EX ttl
        let mut cmd = redis::cmd("SET");
        cmd.arg(key)
            .arg(val)
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds.max(1));
        let r: Option<String> = self.query(cmd).await?;
        Ok(r.is_some())
    }

    async fn incr_u64(&self, key: &str, delta: u64) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("INCRBY");
        cmd.arg(key).arg(delta);
        self.query(cmd).await
    }

    async fn zrem(&self, key: &str, member: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("ZREM");
        cmd.arg(key).arg(member);
        self.query(cmd).await
    }

    async fn zadd_score(&self, key: &str, member: &str, score: i64) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("ZADD");
        cmd.arg(key).arg(score).arg(member);
        self.query(cmd).await
    }

    async fn zrangebyscore_limit(&self, key: &str, min: i64, max: i64, count: usize) -> redis::RedisResult<Vec<String>> {
        let mut cmd = redis::cmd("ZRANGEBYSCORE");
        cmd.arg(key)
            .arg(min)
            .arg(max)
            .arg("LIMIT")
            .arg(0)
            .arg(count.max(1));
        self.query(cmd).await
    }


    async fn execute_lua_hset_session_bind(
        &self,
        key: &str,
        node_id: &str,
        trace_id: &str,
        updated_at: &str,
        ttl: u64,
    ) -> redis::RedisResult<u64> {
        let script = r#"
redis.call('HSET', KEYS[1], 'node_id', ARGV[1])
if ARGV[2] ~= '' then
  redis.call('HSET', KEYS[1], 'trace_id', ARGV[2])
end
redis.call('HSET', KEYS[1], 'updated_at', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(key)
            .arg(node_id)
            .arg(trace_id)
            .arg(updated_at)
            .arg(ttl);
        self.query(cmd).await
    }

    /// TRY_RESERVE: 按照设计文档实现原子预留
    /// KEYS[1]=node_cap_key, KEYS[2]=node_meta_key, KEYS[3]=resv_key
    /// ARGV[1]=ttl_ms, ARGV[2]=resv_value_json
    /// 返回: {1, 'OK'} 或 {0, reason}
    async fn try_reserve(
        &self,
        node_cap_key: &str,
        node_meta_key: &str,
        resv_key: &str,
        ttl_ms: u64,
        resv_value_json: &str,
    ) -> redis::RedisResult<(i64, String)> {
        let script = r#"
local health = redis.call('HGET', KEYS[2], 'health')
if health ~= 'ready' and health ~= false then
  return {0, 'NOT_READY'}
end

local maxv = tonumber(redis.call('HGET', KEYS[1], 'max') or '0')
local running = tonumber(redis.call('HGET', KEYS[1], 'running') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')

if maxv <= 0 then
  return {0, 'NO_CAPACITY'}
end

if (running + reserved) >= maxv then
  return {0, 'FULL'}
end

redis.call('HINCRBY', KEYS[1], 'reserved', 1)

local ok = redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[1], 'NX')
if not ok then
  redis.call('HINCRBY', KEYS[1], 'reserved', -1)
  return {0, 'RESV_EXISTS'}
end

return {1, 'OK'}
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(3)
            .arg(node_cap_key)
            .arg(node_meta_key)
            .arg(resv_key)
            .arg(ttl_ms.max(1))
            .arg(resv_value_json);
        
        // 返回格式: [1, "OK"] 或 [0, "FULL"]
        // Redis Lua返回数组时,可能是Bulk或Array格式
        let result: redis::Value = self.query(cmd).await?;
        let (status, reason) = match result {
            redis::Value::Bulk(items) => {
                let status = match items.get(0) {
                    Some(redis::Value::Int(v)) => *v,
                    _ => 0,
                };
                let reason = match items.get(1) {
                    Some(redis::Value::Data(v)) => String::from_utf8_lossy(v).to_string(),
                    Some(redis::Value::Status(v)) => v.to_string(),
                    _ => "UNKNOWN".to_string(),
                };
                (status, reason)
            }
            _ => (0, "INVALID_RESPONSE".to_string()),
        };
        Ok((status, reason))
    }

    /// COMMIT_RESERVE: reserved -> running
    /// KEYS[1]=node_cap_key, KEYS[2]=resv_key
    /// 返回: true表示成功, false表示失败(resv_key不存在或已过期)
    async fn commit_reserve(
        &self,
        node_cap_key: &str,
        resv_key: &str,
    ) -> redis::RedisResult<bool> {
        let script = r#"
-- 检查 resv_key 是否存在
if redis.call('EXISTS', KEYS[2]) == 0 then
  return 0
end

-- reserved -= 1
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
if reserved > 0 then
  redis.call('HINCRBY', KEYS[1], 'reserved', -1)
end

-- running += 1
redis.call('HINCRBY', KEYS[1], 'running', 1)

-- 删除 resv_key
redis.call('DEL', KEYS[2])

return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(2)
            .arg(node_cap_key)
            .arg(resv_key);
        let v: i64 = self.query(cmd).await?;
        Ok(v == 1)
    }

    /// RELEASE_RESERVE: 释放预留
    /// KEYS[1]=node_cap_key, KEYS[2]=resv_key
    /// 返回: true表示成功释放, false表示resv_key不存在(已过期)
    async fn release_reserve(
        &self,
        node_cap_key: &str,
        resv_key: &str,
    ) -> redis::RedisResult<bool> {
        let script = r#"
-- 如果 resv_key 存在
if redis.call('EXISTS', KEYS[2]) == 1 then
  local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
  if reserved > 0 then
    redis.call('HINCRBY', KEYS[1], 'reserved', -1)
  end
  redis.call('DEL', KEYS[2])
  return 1
end
-- resv_key 不存在(已过期), 不做任何操作, 返回0
return 0
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(2)
            .arg(node_cap_key)
            .arg(resv_key);
        let v: i64 = self.query(cmd).await?;
        Ok(v == 1)
    }

    /// DEC_RUNNING: 任务完成时 running -= 1
    /// KEYS[1]=node_cap_key
    /// 返回: true表示成功
    pub async fn dec_running(
        &self,
        node_cap_key: &str,
    ) -> redis::RedisResult<bool> {
        let script = r#"
local running = tonumber(redis.call('HGET', KEYS[1], 'running') or '0')
if running > 0 then
  redis.call('HINCRBY', KEYS[1], 'running', -1)
  return 1
end
-- running 已经是0, 不做任何操作
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(node_cap_key);
        let v: i64 = self.query(cmd).await?;
        Ok(v == 1)
    }
}

