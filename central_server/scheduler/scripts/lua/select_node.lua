-- 选择节点（用于调度，有向语言对版本，使用 SCARD）
-- 被动清理：从池取出节点后 EXISTS 校验；若 node key 已过期则 SREM 并重试，避免派发到已断开节点。
-- ARGV[1]: pair_key (格式: "zh:en")
-- ARGV[2]: job_id (optional, MaxDuration job 级绑定)
-- ARGV[3]: session_id (optional, session affinity assigned_node_id)

local pair_key = ARGV[1]
local job_id = ARGV[2]
local session_id = ARGV[3]
local MAX_POOL_ID = 999
local MAX_TRIES = 64
local chosen_node_id = nil

-- 1. job 级绑定（MaxDuration 同 job 链）
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

-- 2. Session 亲和：scheduler:session:{session_id} assigned_node_id
if session_id and session_id ~= "" then
    local session_key = "scheduler:session:" .. session_id
    local session_node_id = redis.call("HGET", session_key, "assigned_node_id")
    if session_node_id and session_node_id ~= "" then
        local node_key = "lingua:v1:node:" .. session_node_id
        if redis.call("EXISTS", node_key) == 1 then
            for pool_id = 0, MAX_POOL_ID do
                local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
                if redis.call("SISMEMBER", pool_key, session_node_id) == 1 then
                    chosen_node_id = session_node_id
                    break
                end
            end
        end
    end
end

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
