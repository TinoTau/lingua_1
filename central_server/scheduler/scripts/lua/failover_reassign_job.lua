-- failover_reassign_job.lua
-- KEYS[1] = job_key
-- ARGV[1] = new_node_id
-- ARGV[2] = expected_attempt_id
-- ARGV[3] = ttl_seconds

local exists = redis.call("EXISTS", KEYS[1])
if exists == 0 then
  return 0  -- job not found
end

local attempt = tonumber(redis.call("HGET", KEYS[1], "dispatch_attempt_id") or "0")
local expected = tonumber(ARGV[2])

if attempt ~= expected then
  return -1
end

local new_attempt = attempt + 1
redis.call("HSET", KEYS[1],
  "assigned_node_id", ARGV[1],
  "dispatch_attempt_id", new_attempt
)
redis.call("EXPIRE", KEYS[1], ARGV[3])
return new_attempt
