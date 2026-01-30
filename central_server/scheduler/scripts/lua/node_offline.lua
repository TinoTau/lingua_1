-- 节点下线处理（有向语言对版本，使用 SCARD）
-- ARGV[1]: node_id

local node_id = ARGV[1]

-- 获取节点所在的所有池映射
local node_pools_key = "lingua:v1:node:" .. node_id .. ":pools"
local pool_mappings = redis.call("HGETALL", node_pools_key)

-- pool_mappings = {pair_key1, pool_id1, pair_key2, pool_id2, ...}
local removed_count = 0

-- 从每个池中移除节点
for i = 1, #pool_mappings, 2 do
    local pair_key = pool_mappings[i]      -- 例如 "zh:en"
    local pool_id = pool_mappings[i + 1]   -- 例如 "0"
    
    local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
    
    -- 移除节点
    redis.call("SREM", pool_key, node_id)
    
    -- ✅ 关键改进：使用 SCARD 检查池是否为空（O(1) 操作）
    local remaining = redis.call("SCARD", pool_key)
    
    if remaining == 0 then
        -- 删除空池，节省内存
        redis.call("DEL", pool_key)
    end
    
    removed_count = removed_count + 1
end

-- 删除节点数据
redis.call("DEL", node_pools_key)
redis.call("DEL", "lingua:v1:node:" .. node_id)

-- 从全局节点集合移除（如果存在）
redis.call("SREM", "lingua:v1:nodes:all", node_id)

return "OK:removed_from_" .. removed_count .. "_pools"
