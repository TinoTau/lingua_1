-- 任务完成 Lua 脚本（简化版）
-- ARGV[1]: job_id
-- ARGV[2]: node_id  
-- ARGV[3]: status ("finished" / "failed")

local job_id = ARGV[1]
local node_id = ARGV[2]
local status = ARGV[3]
local now_ts = redis.call("TIME")[1]

-- 更新Job状态（如果使用Job FSM）
local job_key = "scheduler:job:" .. job_id .. ":state"
redis.call("HSET", job_key,
    "state", status == "finished" and "FINISHED" or "FAILED",
    "updated_at_ms", tostring(now_ts * 1000)
)
redis.call("EXPIRE", job_key, 300)  -- 5分钟后清理

-- 可选：清理Job节点绑定
local binding_key = "lingua:v1:job:" .. job_id .. ":node"
redis.call("DEL", binding_key)

return "OK"
