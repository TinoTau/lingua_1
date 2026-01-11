-- 节点心跳 Lua 脚本
-- KEYS: (可为空，使用 ARGV)
-- ARGV: node_id, online_flag, load_json(可选)

local node_id  = ARGV[1]
local online   = ARGV[2]  -- "true" / "false"
local load     = ARGV[3] or ""  -- 可选，负载或健康信息的 JSON
local now_ts   = redis.call("TIME")[1]

local node_info_key = "scheduler:node:info:" .. node_id

-- 更新节点状态
redis.call("HSET", node_info_key,
    "online", online,
    "last_heartbeat_ts", tostring(now_ts)
)

-- 如果提供了负载信息，也更新
if load and load ~= "" then
    redis.call("HSET", node_info_key, "load_json", load)
end

redis.call("EXPIRE", node_info_key, 3600)

return "OK"
