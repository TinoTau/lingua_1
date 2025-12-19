impl RedisHandle {
    async fn connect(cfg: &crate::config::Phase2RedisConfig) -> anyhow::Result<Self> {
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

    async fn query<T: redis::FromRedisValue>(&self, cmd: redis::Cmd) -> redis::RedisResult<T> {
        let mut guard = self.inner.lock().await;
        match &mut *guard {
            RedisConn::Single(c) => cmd.query_async(c).await,
            RedisConn::Cluster(c) => cmd.query_async(c).await,
        }
    }

    async fn set_ex_string(&self, key: &str, val: &str, ttl_seconds: u64) -> redis::RedisResult<()> {
        let mut cmd = redis::cmd("SET");
        cmd.arg(key).arg(val).arg("EX").arg(ttl_seconds.max(1));
        self.query(cmd).await
    }

    async fn get_string(&self, key: &str) -> redis::RedisResult<Option<String>> {
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

    async fn exists(&self, key: &str) -> redis::RedisResult<bool> {
        let mut cmd = redis::cmd("EXISTS");
        cmd.arg(key);
        let v: u64 = self.query(cmd).await?;
        Ok(v > 0)
    }

    #[allow(dead_code)]
    async fn xadd_payload(&self, stream: &str, payload: &str) -> redis::RedisResult<String> {
        // 兼容旧调用点：不裁剪
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream).arg("*").arg("payload").arg(payload);
        self.query(cmd).await
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

    async fn zcard_clean_expired(&self, key: &str) -> redis::RedisResult<u64> {
        let script = r#"
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
return redis.call('ZCARD', KEYS[1])
"#;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(key).arg(now_ms);
        self.query(cmd).await
    }

    async fn zreserve_with_capacity(
        &self,
        key: &str,
        job_id: &str,
        ttl_seconds: u64,
        running_jobs: u64,
        max_jobs: u64,
    ) -> redis::RedisResult<bool> {
        let script = r#"
local now = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local running = tonumber(ARGV[3])
local maxj = tonumber(ARGV[4])
local job = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
local reserved = redis.call('ZCARD', KEYS[1])
local effective = reserved
if running > reserved then effective = running end
if effective >= maxj then
  return 0
end
redis.call('ZADD', KEYS[1], now + ttl_ms, job)
-- best-effort 保持 key 不永久增长（空集合也无所谓）
redis.call('EXPIRE', KEYS[1], math.max(60, math.floor(ttl_ms/1000) + 60))
return 1
"#;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let ttl_ms = (ttl_seconds.max(1) * 1000) as i64;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(key)
            .arg(now_ms)
            .arg(ttl_ms)
            .arg(running_jobs)
            .arg(max_jobs)
            .arg(job_id);
        let v: i64 = self.query(cmd).await?;
        Ok(v == 1)
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
}

