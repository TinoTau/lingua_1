fn normalize_instance_id(s: &str) -> String {
    if s.trim().is_empty() || s.trim().eq_ignore_ascii_case("auto") {
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".to_string());
        let pid = std::process::id();
        let short = uuid::Uuid::new_v4().to_string();
        let short = short.split('-').next().unwrap_or("x");
        format!("{}-{}-{}", hostname, pid, short)
    } else {
        s.trim().to_string()
    }
}

fn extract_payloads_from_stream_reply(reply: redis::streams::StreamReadReply) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for k in reply.keys {
        for id in k.ids {
            if let Some(v) = id.map.get("payload") {
                if let Ok(payload) = redis::from_redis_value::<String>(v) {
                    out.push((id.id, payload));
                }
            }
        }
    }
    out
}

fn parse_xautoclaim_payloads(value: redis::Value) -> Vec<(String, String)> {
    // 期望格式：
    // [ next_start_id, [ [id, [field, value, ...]], ... ], [deleted_id...] ]
    let mut out = Vec::new();
    let redis::Value::Bulk(parts) = value else { return out };
    if parts.len() < 2 {
        return out;
    }
    let messages = &parts[1];
    let redis::Value::Bulk(entries) = messages else { return out };
    for e in entries {
        let redis::Value::Bulk(kv) = e else { continue };
        if kv.len() < 2 {
            continue;
        }
        let id = redis::from_redis_value::<String>(&kv[0]).ok();
        let fields = &kv[1];
        let payload = extract_payload_from_field_list(fields);
        if let (Some(id), Some(payload)) = (id, payload) {
            out.push((id, payload));
        }
    }
    out
}

fn extract_payload_from_field_list(value: &redis::Value) -> Option<String> {
    // fields = [field, value, field, value, ...]
    let redis::Value::Bulk(items) = value else { return None };
    let mut i = 0;
    while i + 1 < items.len() {
        let k = redis::from_redis_value::<String>(&items[i]).ok()?;
        if k == "payload" {
            return redis::from_redis_value::<String>(&items[i + 1]).ok();
        }
        i += 2;
    }
    None
}

#[derive(Debug, Clone)]
struct PendingEntry {
    id: String,
    #[allow(dead_code)]
    consumer: String,
    idle_ms: u64,
    deliveries: u64,
}

fn parse_xpending_entries(value: redis::Value) -> Vec<PendingEntry> {
    // XPENDING key group - + count
    // returns array of entries: [ [id, consumer, idle_ms, deliveries], ... ]
    let mut out = Vec::new();
    let redis::Value::Bulk(entries) = value else { return out };
    for e in entries {
        let redis::Value::Bulk(parts) = e else { continue };
        if parts.len() < 4 {
            continue;
        }
        let id = redis::from_redis_value::<String>(&parts[0]).ok();
        let consumer = redis::from_redis_value::<String>(&parts[1]).ok();
        let idle_ms = redis::from_redis_value::<u64>(&parts[2]).ok();
        let deliveries = redis::from_redis_value::<u64>(&parts[3]).ok();
        if let (Some(id), Some(consumer), Some(idle_ms), Some(deliveries)) = (id, consumer, idle_ms, deliveries) {
            out.push(PendingEntry {
                id,
                consumer,
                idle_ms,
                deliveries,
            });
        }
    }
    out
}

fn extract_payload_from_xrange(value: redis::Value) -> Option<String> {
    // XRANGE returns [ [id, [field, value, ...]] ]
    let redis::Value::Bulk(items) = value else { return None };
    if items.is_empty() {
        return None;
    }
    let redis::Value::Bulk(first) = &items[0] else { return None };
    if first.len() < 2 {
        return None;
    }
    let fields = &first[1];
    extract_payload_from_field_list(fields)
}

fn parse_xpending_summary_total(value: redis::Value) -> Option<u64> {
    // XPENDING <stream> <group>
    // returns [count, smallest_id, greatest_id, [ [consumer, count], ... ] ]
    let redis::Value::Bulk(parts) = value else { return None };
    if parts.is_empty() {
        return None;
    }
    redis::from_redis_value::<u64>(&parts[0]).ok()
}

#[allow(dead_code)]
fn redis_value_to_hashmap(value: redis::Value) -> Option<std::collections::HashMap<String, String>> {
    use std::collections::HashMap;
    let redis::Value::Bulk(items) = value else { return None };
    let mut out = HashMap::new();
    let mut i = 0;
    while i + 1 < items.len() {
        let k = redis::from_redis_value::<String>(&items[i]).ok()?;
        let v = redis::from_redis_value::<String>(&items[i + 1]).ok()?;
        out.insert(k, v);
        i += 2;
    }
    Some(out)
}

/// Phase 2：发送 NodeMessage（本地直发；否则按 owner 投递到目标实例 Streams）
