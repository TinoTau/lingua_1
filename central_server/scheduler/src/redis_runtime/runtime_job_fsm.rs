impl RedisRuntime {
    pub async fn job_fsm_reset_created(
        &self,
        job_id: &str,
        node_id: Option<&str>,
        attempt_id: u32,
        ttl_seconds: u64,
    ) {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let node = node_id.unwrap_or("");
        let ttl = ttl_seconds.max(1);
        let script = r#"
redis.call('HSET', KEYS[1],
  'job_id', ARGV[1],
  'state', 'CREATED',
  'node_id', ARGV[2],
  'attempt_id', ARGV[3],
  'updated_at_ms', ARGV[4]
)
if redis.call('HEXISTS', KEYS[1], 'created_at_ms') == 0 then
  redis.call('HSET', KEYS[1], 'created_at_ms', ARGV[4])
end
redis.call('HDEL', KEYS[1], 'finished_ok')
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(job_id)
            .arg(node)
            .arg(attempt_id)
            .arg(now_ms)
            .arg(ttl);
        let _r: redis::RedisResult<i64> = self.redis.query(cmd).await;
    }

    pub async fn job_fsm_to_dispatched(&self, job_id: &str, attempt_id: u32) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'DISPATCHED' or st == 'ACCEPTED' or st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'CREATED' then return 0 end
local a = redis.call('HGET', KEYS[1], 'attempt_id')
if a ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'DISPATCHED', 'updated_at_ms', ARGV[2])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(attempt_id.to_string())
            .arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_running(&self, job_id: &str) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'DISPATCHED' and st ~= 'ACCEPTED' then
  return 0
end
redis.call('HSET', KEYS[1], 'state', 'RUNNING', 'updated_at_ms', ARGV[1])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(&key).arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_accepted(&self, job_id: &str, attempt_id: u32) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'ACCEPTED' or st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'DISPATCHED' then
  return 0
end
local a = redis.call('HGET', KEYS[1], 'attempt_id')
if a ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'ACCEPTED', 'updated_at_ms', ARGV[2])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(attempt_id.to_string())
            .arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_finished(&self, job_id: &str, attempt_id: u32, ok: bool) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let ok_str = if ok { "1" } else { "0" };
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'CREATED' and st ~= 'DISPATCHED' and st ~= 'ACCEPTED' and st ~= 'RUNNING' then
  return 0
end
local a = redis.call('HGET', KEYS[1], 'attempt_id')
if a ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'FINISHED', 'finished_ok', ARGV[2], 'updated_at_ms', ARGV[3])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(attempt_id.to_string())
            .arg(ok_str)
            .arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_released(&self, job_id: &str) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'RELEASED' then return 1 end
if st ~= 'FINISHED' then return 0 end
redis.call('HSET', KEYS[1], 'state', 'RELEASED', 'updated_at_ms', ARGV[1])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(&key).arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

}
