-- 任务完成 Lua 脚本
-- KEYS: (可为空，使用 ARGV)
-- ARGV: job_id, node_id, status

local job_id  = ARGV[1]
local node_id = ARGV[2]
local status  = ARGV[3]  -- "finished" / "failed"
local now_ts  = redis.call("TIME")[1]

local job_key = "scheduler:job:" .. job_id

-- 1. 验证 job 存在且节点 ID 匹配
local job_node_id = redis.call("HGET", job_key, "node_id")
if not job_node_id or job_node_id ~= node_id then
    return {err = "NODE_MISMATCH"}
end

-- 2. 更新 job 状态
redis.call("HSET", job_key,
    "status", status,
    "finished_ts", tostring(now_ts)
)

-- 注意：节点任务管理（current_jobs）由节点端 GPU 仲裁器负责
-- 调度服务器不再管理 current_jobs，因此不再更新

return "OK"
