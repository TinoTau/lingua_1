-- 节点注册 Lua 脚本
-- KEYS: (可为空，使用 ARGV)
-- ARGV: node_id, cap_json, pool_names_json(可选)

local node_id      = ARGV[1]
local cap_json     = ARGV[2]
local pool_names_json = ARGV[3] or "[]"
local now_ts       = redis.call("TIME")[1]

-- 1. 写入节点信息
local node_info_key = "scheduler:node:info:" .. node_id
redis.call("HSET", node_info_key,
    "online", "true",
    "cap_json", cap_json,
    "last_heartbeat_ts", tostring(now_ts)
)
redis.call("EXPIRE", node_info_key, 3600)

-- 注意：不再初始化 current_jobs，因为节点任务管理由节点端 GPU 仲裁器负责
-- 不再存储 max_jobs，因为调度服务器不再管理节点任务数量

-- 2. 从 pool_names_json 提取语言对并创建/更新语言索引
-- pool_names_json 格式: [{"id":1,"name":"zh-en"},{"id":2,"name":"en-zh"}]
-- 注意：如果提供了 pool_names_json，也要确保节点被添加到对应的 Pool 成员集合
if pool_names_json and pool_names_json ~= "" and pool_names_json ~= "[]" then
    if cjson then
        local pool_names = cjson.decode(pool_names_json)
        
        -- 从每个 pool name 提取语言对并创建/更新语言索引
        -- pool name 格式: "zh-en" (排序后的语言集合，用 '-' 连接)
        -- 对于 "zh-en"，提取两个语言对: zh->en 和 en->zh
        for i = 1, #pool_names do
            local pool_info = pool_names[i]
            if pool_info.id and pool_info.name then
                local pool_id_str = tostring(pool_info.id)
                local pool_id_num = tonumber(pool_info.id)
                local pool_name = pool_info.name
                
                -- 确保节点被添加到该 Pool 成员集合
                local pool_members_key = "scheduler:pool:" .. pool_id_str .. ":members"
                redis.call("SADD", pool_members_key, node_id)
                redis.call("EXPIRE", pool_members_key, 3600)
                
                -- 从 pool_name 提取语言对（格式: "zh-en"）
                local parts = {}
                for part in string.gmatch(pool_name, "([^-]+)") do
                    table.insert(parts, part)
                end
                
                if #parts == 2 then
                    local src_lang = parts[1]
                    local tgt_lang = parts[2]
                    
                    -- 跳过通配符 "*"
                    if src_lang ~= "*" then
                        -- 语言对 1: src_lang -> tgt_lang (例如: zh->en)
                        local lang_key_1 = "scheduler:lang:" .. src_lang .. ":" .. tgt_lang
                        local pools_json_1 = redis.call("HGET", lang_key_1, "pools_json")
                        local pools_list_1 = {}
                        if pools_json_1 and pools_json_1 ~= "" then
                            pools_list_1 = cjson.decode(pools_json_1)
                        end
                        
                        -- 检查 pool_id 是否已在列表中
                        local found = false
                        for j = 1, #pools_list_1 do
                            if pools_list_1[j] == pool_id_num then
                                found = true
                                break
                            end
                        end
                        if not found then
                            table.insert(pools_list_1, pool_id_num)
                        end
                        
                        local pools_json_new_1 = cjson.encode(pools_list_1)
                        redis.call("HSET", lang_key_1, "pools_json", pools_json_new_1)
                        redis.call("EXPIRE", lang_key_1, 3600)
                        
                        -- 语言对 2: tgt_lang -> src_lang (例如: en->zh)
                        if src_lang ~= tgt_lang then
                            local lang_key_2 = "scheduler:lang:" .. tgt_lang .. ":" .. src_lang
                            local pools_json_2 = redis.call("HGET", lang_key_2, "pools_json")
                            local pools_list_2 = {}
                            if pools_json_2 and pools_json_2 ~= "" then
                                pools_list_2 = cjson.decode(pools_json_2)
                            end
                            
                            -- 检查 pool_id 是否已在列表中
                            local found_2 = false
                            for j = 1, #pools_list_2 do
                                if pools_list_2[j] == pool_id_num then
                                    found_2 = true
                                    break
                                end
                            end
                            if not found_2 then
                                table.insert(pools_list_2, pool_id_num)
                            end
                            
                            local pools_json_new_2 = cjson.encode(pools_list_2)
                            redis.call("HSET", lang_key_2, "pools_json", pools_json_new_2)
                            redis.call("EXPIRE", lang_key_2, 3600)
                        end
                    end
                end
            end
        end
    else
        -- 如果 Redis 不支持 cjson，无法解析复杂的 JSON 结构
        -- 这里跳过语言索引的创建（需要手动创建）
        -- 但仍然尝试将节点添加到 Pool 成员集合，如果 pools_json 提供了
        -- 否则，如果只依赖 pool_names_json，则无法添加节点到 Pool
        -- 考虑到当前场景，cjson 应该可用，此分支不应触发
    end
end

return "OK"
