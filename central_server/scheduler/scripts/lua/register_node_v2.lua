-- 节点注册 Lua 脚本（有向语言对版本）
-- 允许空语言：节点先注册拿 node_id，心跳再带语言并更新池。
-- ARGV[1]: node_id
-- ARGV[2]: asr_langs_json (例如 ["zh","en"] 或 [])
-- ARGV[3]: semantic_langs_json
-- ARGV[4]: tts_langs_json

local node_id = ARGV[1]
local asr_langs_json = ARGV[2] or "[]"
local semantic_langs_json = ARGV[3] or "[]"
local tts_langs_json = ARGV[4] or "[]"
local now_ts = redis.call("TIME")[1]

local node_key = "lingua:v1:node:" .. node_id
redis.call("HMSET", node_key,
    "asr_langs", asr_langs_json,
    "semantic_langs", semantic_langs_json,
    "tts_langs", tts_langs_json,
    "last_heartbeat_ts", tostring(now_ts)
)
redis.call("EXPIRE", node_key, 3600)
redis.call("SADD", "lingua:v1:nodes:all", node_id)
return "OK"
