-- 节点注册 Lua 脚本（有向语言对版本）
-- ARGV[1]: node_id
-- ARGV[2]: asr_langs_json (例如: ["zh","en","de"])
-- ARGV[3]: semantic_langs_json (例如: ["zh","en"])
-- ARGV[4]: tts_langs_json (例如: ["zh","en","ja"])，池分配用 asr×tts

local node_id = ARGV[1]
local asr_langs_json = ARGV[2]
local semantic_langs_json = ARGV[3]
local tts_langs_json = ARGV[4]
local now_ts = redis.call("TIME")[1]

if not asr_langs_json or asr_langs_json == "" then
    return redis.error_reply("ERROR:asr_langs_json_required")
end
if not semantic_langs_json or semantic_langs_json == "" then
    return redis.error_reply("ERROR:semantic_langs_json_required_Semantic_service_is_mandatory")
end
if not tts_langs_json or tts_langs_json == "" then
    return redis.error_reply("ERROR:tts_langs_json_required")
end

local node_key = "lingua:v1:node:" .. node_id
redis.call("HMSET", node_key,
    "asr_langs", asr_langs_json,
    "semantic_langs", semantic_langs_json,
    "tts_langs", tts_langs_json,
    "last_heartbeat_ts", tostring(now_ts)
)
redis.call("EXPIRE", node_key, 3600)

-- 添加到全局节点集合
redis.call("SADD", "lingua:v1:nodes:all", node_id)

return "OK"
