-- 任务调度 Lua 脚本
-- KEYS: (可为空，使用 ARGV)
-- ARGV: session_id, src_lang, tgt_lang, payload_json

local session_id = ARGV[1]
local src        = ARGV[2]
local tgt        = ARGV[3]
local payload    = ARGV[4]
local now_ts     = redis.call("TIME")[1]

-- 1. 读取会话绑定的 preferred_pool 和 timeout_node_id（如果存在）
-- Session Affinity：优先查找timeout映射，确保超时finalize的长语音任务路由到同一节点
local session_key = "scheduler:session:" .. session_id
local preferred_pool = redis.call("HGET", session_key, "preferred_pool")
local timeout_node_id = redis.call("HGET", session_key, "timeout_node_id")

-- 2. 若没有 preferred_pool，则根据语言索引获取所有 pool
local pools = {}
if not preferred_pool or preferred_pool == "" then
    -- 排序语言对（与 Pool 命名规则一致）
    local sorted_langs = {src, tgt}
    if src > tgt then
        sorted_langs = {tgt, src}
    end
    local sorted_src = sorted_langs[1]
    local sorted_tgt = sorted_langs[2]
    
    -- 尝试两个方向的语言对（因为 Redis 可能只存储了一个方向）
    local lang_key1 = "scheduler:lang:" .. sorted_src .. ":" .. sorted_tgt
    local lang_key2 = "scheduler:lang:" .. sorted_tgt .. ":" .. sorted_src
    local pools_json = redis.call("HGET", lang_key1, "pools_json")
    
    if not pools_json or pools_json == "" then
        pools_json = redis.call("HGET", lang_key2, "pools_json")
    end
    
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
    
    -- 优化：对pools按字符串排序，保证多实例一致性和行为稳定
    -- 将pool_id转换为字符串后排序，确保排序结果稳定
    local pools_str = {}
    for i = 1, #pools do
        pools_str[i] = tostring(pools[i])
    end
    table.sort(pools_str)
    pools = {}
    for i = 1, #pools_str do
        table.insert(pools, tonumber(pools_str[i]) or pools_str[i])
    end
else
    -- 如果已经有 preferred_pool，只使用这个 pool
    pools = {tonumber(preferred_pool) or preferred_pool}
end

-- 3. 节点选择策略：优先查找timeout映射，找不到的话再随机分配
-- Session Affinity：超时finalize的长语音任务需要路由到同一节点，以支持AudioAggregator的流式切分逻辑
local chosen_node_id = nil
local chosen_pool_id = nil

-- 3.1 优先查找timeout_node_id映射（Session Affinity）
-- 如果存在timeout_node_id，说明之前有超时finalize，需要将后续job路由到同一节点
local affinity_fallback = false  -- 用于标记是否需要fallback（可通过错误消息传递）
if timeout_node_id and timeout_node_id ~= "" then
    local info_key = "scheduler:node:info:" .. timeout_node_id
    local online = redis.call("HGET", info_key, "online")
    
    if online == "true" then
        -- timeout_node_id 指定的节点在线，检查该节点是否在候选 pools 中
        -- 遍历所有 pools，找到包含该节点的 pool
        for pool_idx = 1, #pools do
            local pool_id = tostring(pools[pool_idx])
            local pool_key = "scheduler:pool:" .. pool_id .. ":members"
            local is_member = redis.call("SISMEMBER", pool_key, timeout_node_id)
            
            if is_member == 1 then
                -- 节点在 pool 中，选择该节点（Session Affinity匹配成功）
                chosen_node_id = timeout_node_id
                chosen_pool_id = pool_id
                break
            end
        end
        -- 如果timeout_node_id节点在线但不在候选pools中，标记需要fallback
        if not chosen_node_id then
            affinity_fallback = true
        end
    else
        -- timeout_node_id节点离线，标记需要fallback
        affinity_fallback = true
    end
end

-- 3.2 如果没有选择到节点（timeout_node_id不存在或不可用），选择第一个可用节点
-- 优化：对nodes按字符串排序，保证多实例一致性和行为稳定
if not chosen_node_id then
    local pool_empty_count = 0  -- 统计空pool数量
    for pool_idx = 1, #pools do
        local pool_id = tostring(pools[pool_idx])
        local pool_key = "scheduler:pool:" .. pool_id .. ":members"
        local nodes = redis.call("SMEMBERS", pool_key)
        
        if nodes and #nodes > 0 then
            -- 优化：对nodes按字符串排序，保证多实例一致性
            table.sort(nodes)
            
            -- 遍历该 pool 中的所有节点，选择第一个在线的节点
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
        else
            pool_empty_count = pool_empty_count + 1
        end
    end
    
    -- 如果所有pool都为空或没有在线节点，返回错误
    -- 注意：这种情况会在Rust代码中记录日志（PoolEmpty）
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
