-- mark_job_dispatched.lua
-- KEYS[1] = job_key
-- ARGV[1] = now_ms
-- ARGV[2] = ttl_seconds

local exists = redis.call("EXISTS", KEYS[1])
if exists == 0 then
  return 0
end

local dispatched = redis.call("HGET", KEYS[1], "dispatched_to_node")
if dispatched == "true" then
  return 1
end

redis.call("HSET", KEYS[1],
  "dispatched_to_node", "true",
  "dispatched_at_ms", ARGV[1]
)
redis.call("EXPIRE", KEYS[1], ARGV[2])
return 2
