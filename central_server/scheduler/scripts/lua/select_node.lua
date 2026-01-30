-- 选择节点（用于调度，有向语言对版本，使用 SCARD）
-- 被动清理：从池取出节点后 EXISTS 校验；若 node key 已过期则 SREM 并重试，避免派发到已断开节点。
-- ARGV[1]: pair_key (格式: "zh:en")
-- ARGV[2]: job_id (optional, 用于 timeout finalize 绑定)
-- ARGV[3]: session_id (optional, 用于读取 timeout_node_id)

local pair_key = ARGV[1]
local job_id = ARGV[2]
local session_id = ARGV[3]
local MAX_POOL_ID = 999
local MAX_TRIES = 64

-- 1. 如果有 job_id，检查是否已绑定（timeout finalize）
if job_id and job_id ~= "" then
    local binding_key = "lingua:v1:job:" .. job_id .. ":node"
    local bound_node = redis.call("GET", binding_key)

    if bound_node then
        local node_key = "lingua:v1:node:" .. bound_node
        if redis.call("EXISTS", node_key) == 1 then
            return bound_node
        end
        redis.call("DEL", binding_key)
    end
end

-- 2. Session Affinity：优先查找 timeout_node_id 映射（用于 AudioAggregator 连续性）
-- 如果存在 timeout_node_id，说明之前有超时/MaxDuration finalize，需要将后续 job 路由到同一节点
local chosen_node_id = nil
if session_id and session_id ~= "" then
    local session_key = "scheduler:session:" .. session_id
    local timeout_node_id = redis.call("HGET", session_key, "timeout_node_id")
    
    if timeout_node_id and timeout_node_id ~= "" then
        local node_key = "lingua:v1:node:" .. timeout_node_id
        local online = redis.call("EXISTS", node_key)
        
        if online == 1 then
            -- timeout_node_id 指定的节点在线，检查该节点是否在候选 pools 中
            for pool_id = 0, MAX_POOL_ID do
                local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
                local is_member = redis.call("SISMEMBER", pool_key, timeout_node_id)
                
                if is_member == 1 then
                    -- 节点在 pool 中，选择该节点（Session Affinity 匹配成功）
                    chosen_node_id = timeout_node_id
                    break
                end
            end
        end
    end
end

-- 如果通过 timeout_node_id 选择了节点，直接返回
if chosen_node_id then
    return chosen_node_id
end

-- 收集非空池
local function collect_pool_ids()
    local ids = {}
    for pool_id = 0, MAX_POOL_ID do
        local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
        if redis.call("SCARD", pool_key) > 0 then
            table.insert(ids, pool_id)
        elseif pool_id > 0 and #ids > 0 then
            break
        end
    end
    return ids
end

math.randomseed(tonumber(redis.call("TIME")[1]) + tonumber(redis.call("TIME")[2]))

local tries = 0
while tries < MAX_TRIES do
    tries = tries + 1
    local pool_ids = collect_pool_ids()
    if #pool_ids == 0 then
        return nil
    end

    local selected_pool_id = pool_ids[math.random(#pool_ids)]
    local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. selected_pool_id .. ":nodes"
    local node_id = redis.call("SRANDMEMBER", pool_key)

    if not node_id or node_id == "" then
        redis.call("DEL", pool_key)
    else
        local node_key = "lingua:v1:node:" .. node_id
        if redis.call("EXISTS", node_key) == 1 then
            if job_id and job_id ~= "" then
                redis.call("SET", "lingua:v1:job:" .. job_id .. ":node", node_id, "EX", 3600)
            end
            return node_id
        end
        -- 死节点：从所有池移除（多池场景）。用 node:pools 查出全部 (pair, pool_id)，逐个 SREM
        local node_pools_key = "lingua:v1:node:" .. node_id .. ":pools"
        local mapping = redis.call("HGETALL", node_pools_key)
        if mapping and #mapping >= 2 then
            for i = 1, #mapping, 2 do
                local pk = mapping[i]
                local pid = mapping[i + 1]
                local pk_key = "lingua:v1:pool:" .. pk .. ":" .. pid .. ":nodes"
                redis.call("SREM", pk_key, node_id)
                if redis.call("SCARD", pk_key) == 0 then
                    redis.call("DEL", pk_key)
                end
            end
            redis.call("DEL", node_pools_key)
        else
            redis.call("SREM", pool_key, node_id)
            if redis.call("SCARD", pool_key) == 0 then
                redis.call("DEL", pool_key)
            end
        end
    end
end

return nil
