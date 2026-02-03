-- 仅将节点从所有池中移除，不删除节点 key（用于语言能力变更时重分配池）
-- ARGV[1]: node_id

local node_id = ARGV[1]
local node_pools_key = "lingua:v1:node:" .. node_id .. ":pools"
local pool_mappings = redis.call("HGETALL", node_pools_key)
local removed_count = 0

for i = 1, #pool_mappings, 2 do
    local pair_key = pool_mappings[i]
    local pool_id = pool_mappings[i + 1]
    local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
    redis.call("SREM", pool_key, node_id)
    if redis.call("SCARD", pool_key) == 0 then
        redis.call("DEL", pool_key)
    end
    removed_count = removed_count + 1
end
redis.call("DEL", node_pools_key)
return "OK:cleared_" .. removed_count .. "_pools"
