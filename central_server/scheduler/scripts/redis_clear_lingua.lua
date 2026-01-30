-- 删除所有 lingua:v1:* 的 key，用于清理后测试调度器启动与重建。
-- 由 redis_clear_lingua.ps1 调用。

local keys = redis.call('KEYS', 'lingua:v1:*')
local n = 0
for _, k in ipairs(keys) do
    redis.call('DEL', k)
    n = n + 1
end
return n
