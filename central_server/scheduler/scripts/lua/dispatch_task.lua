-- 任务调度 Lua 脚本
-- KEYS: (可为空，使用 ARGV)
-- ARGV: session_id, src_lang, tgt_lang, payload_json

local session_id = ARGV[1]
local src        = ARGV[2]
local tgt        = ARGV[3]
local payload    = ARGV[4]
local now_ts     = redis.call("TIME")[1]

-- 1. 读取会话绑定的 preferred_pool（如果存在）
local session_key = "scheduler:session:" .. session_id
local preferred_pool = redis.call("HGET", session_key, "preferred_pool")

-- 2. 若没有 preferred_pool，则根据语言索引获取所有 pool
local pools = {}
if not preferred_pool or preferred_pool == "" then
    local lang_key = "scheduler:lang:" .. src .. ":" .. tgt
    local pools_json = redis.call("HGET", lang_key, "pools_json")
    
    if not pools_json or pools_json == "" then
        return {err = "NO_POOL_FOR_LANG_PAIR"}
    end
    
    -- 解析 pools_json（JSON 数组或逗号分隔）
    if string.sub(pools_json, 1, 1) == "[" then
        -- JSON 数组格式
        if cjson then
            pools = cjson.decode(pools_json)
        else
            -- 降级：手动解析 JSON 数组（简化版）
            for pool_id in string.gmatch(pools_json:gsub("[%[%]]", ""), "([^,]+)") do
                table.insert(pools, tonumber(pool_id) or pool_id)
            end
        end
    else
        -- 逗号分隔格式
        for pool_id in string.gmatch(pools_json, "([^,]+)") do
            table.insert(pools, tonumber(pool_id) or pool_id)
        end
    end
    
    if not pools or #pools == 0 then
        return {err = "NO_POOL_FOR_LANG_PAIR"}
    end
else
    -- 如果已经有 preferred_pool，只使用这个 pool
    pools = {tonumber(preferred_pool) or preferred_pool}
end

-- 3. 遍历所有 pool，找到第一个可用节点
local chosen_node_id = nil
local chosen_pool_id = nil

for pool_idx = 1, #pools do
    local pool_id = tostring(pools[pool_idx])
    local pool_key = "scheduler:pool:" .. pool_id .. ":members"
    local nodes = redis.call("SMEMBERS", pool_key)
    
    if nodes and #nodes > 0 then
        -- 遍历该 pool 中的所有节点
        -- 注意：SMEMBERS 返回的节点顺序是不确定的，但应该优先选择可用资源较多的节点
        -- TODO: 未来需要根据节点资源使用情况（心跳中的资源信息）来排序和选择节点
        -- 目前暂时按顺序选择第一个在线的节点
        for i = 1, #nodes do
            local node_id = nodes[i]
            local info_key = "scheduler:node:info:" .. node_id
            
            -- 检查节点是否在线（节点任务管理由节点端 GPU 仲裁器负责，调度服务器不检查任务数量）
            local online = redis.call("HGET", info_key, "online")
            if online == "true" then
                -- 节点在线，选择该节点
                chosen_node_id = node_id
                chosen_pool_id = pool_id
                break
            end
        end
        
        -- 如果找到了节点，退出 pool 循环
        if chosen_node_id then
            break
        end
    end
end

if not chosen_node_id then
    return {err = "NO_AVAILABLE_NODE"}
end

-- 4. 更新会话绑定（如果还没有 preferred_pool）
if not preferred_pool or preferred_pool == "" then
    redis.call("HSET", session_key,
        "preferred_pool", chosen_pool_id,
        "last_lang_pair", src .. "->" .. tgt
    )
    redis.call("EXPIRE", session_key, 3600)
end

-- 5. 创建 job 记录
local job_id_seq = redis.call("INCR", "scheduler:job:id_seq")
local job_id = session_id .. ":" .. tostring(job_id_seq)
local job_key = "scheduler:job:" .. job_id
redis.call("HSET", job_key,
    "node_id", chosen_node_id,
    "session_id", session_id,
    "src_lang", src,
    "tgt_lang", tgt,
    "payload_json", payload,
    "status", "created",
    "created_ts", tostring(now_ts)
)
redis.call("EXPIRE", job_key, 3600)

return {chosen_node_id, job_id}
