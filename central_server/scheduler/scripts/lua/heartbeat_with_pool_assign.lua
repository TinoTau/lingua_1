-- 节点心跳并自动分配池（有向语言对版本，使用 SCARD）
-- 被动清理：仅对节点级 key 设置 TTL；pool 集合不做 EXPIRE，由 select_node 按需 SREM 死节点。
-- ARGV[1]: node_id
-- ARGV[2]: ttl_seconds（建议 3 * 节点端心跳周期；持续收到心跳则刷新，否则自动过期）

local node_id = ARGV[1]
local ttl_sec = tonumber(ARGV[2])
if not ttl_sec or ttl_sec < 1 then
    ttl_sec = 45
end

local now_ts = redis.call("TIME")[1]

-- 检查节点是否存在
local node_key = "lingua:v1:node:" .. node_id
local exists = redis.call("EXISTS", node_key)

if exists == 0 then
    return "ERROR:NODE_NOT_REGISTERED"
end

-- 更新心跳时间，并按 TTL 刷新过期（被动清理：超时未心跳则 key 自动消失）
redis.call("HSET", node_key, "last_heartbeat_ts", tostring(now_ts))
redis.call("EXPIRE", node_key, ttl_sec)

-- 获取节点的语言能力（池分配用 asr×tts，与任务查找 src:tgt 一致）
local asr_langs_json = redis.call("HGET", node_key, "asr_langs")
local tts_langs_json = redis.call("HGET", node_key, "tts_langs")

if not asr_langs_json or not tts_langs_json then
    return "ERROR:MISSING_LANG_CAPABILITIES"
end

local asr_langs = cjson.decode(asr_langs_json)
local tts_langs = cjson.decode(tts_langs_json)

-- 生成所有有向语言对 (src ∈ asr_langs, tgt ∈ tts_langs)
local directed_pairs = {}
for _, src in ipairs(asr_langs) do
    for _, tgt in ipairs(tts_langs) do
        table.insert(directed_pairs, src .. ":" .. tgt)
    end
end

if #directed_pairs == 0 then
    return "ERROR:NO_DIRECTED_PAIRS"
end

-- 节点到池的映射
local node_pools_key = "lingua:v1:node:" .. node_id .. ":pools"

-- 池分配参数
local MAX_POOL_SIZE = 100
local MAX_POOL_ID = 999

-- 为每个有向语言对分配池
for _, pair_key in ipairs(directed_pairs) do
    -- 检查是否已分配
    local existing_pool_id = redis.call("HGET", node_pools_key, pair_key)
    
    if existing_pool_id then
        -- 已分配，确保成员存在（pool 不做 EXPIRE，依赖 select_node 懒清理死节点）
        local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. existing_pool_id .. ":nodes"
        redis.call("SADD", pool_key, node_id)  -- SADD 是幂等的
    else
        -- 未分配，查找非满的池
        local assigned = false

        for pool_id = 0, MAX_POOL_ID do
            local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"

            -- ✅ 关键改进：使用 SCARD 获取实时数量（O(1) 操作）
            local current_size = redis.call("SCARD", pool_key)

            if current_size < MAX_POOL_SIZE then
                -- 找到非满的池，加入（pool 不做 EXPIRE）
                redis.call("SADD", pool_key, node_id)  -- SADD 是幂等的

                -- 记录映射
                redis.call("HSET", node_pools_key, pair_key, tostring(pool_id))

                assigned = true
                break
            end
        end

        if not assigned then
            return "ERROR:NO_AVAILABLE_POOL_FOR_" .. pair_key
        end
    end
end

-- 不対 node:pools 设 TTL，供 select_node 懒清理时 HGETALL 查出所有池并 SREM
-- （仅 node key 过期即可判死；node:pools 用于多池一次性清理）

return "OK:" .. #directed_pairs .. "_pairs"
