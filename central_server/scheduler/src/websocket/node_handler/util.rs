/// 锟?JobError.details 涓彁锟?service_id / service_version锛堝吋瀹规棫瀛楁 model_id / version锟?
pub fn extract_service_from_details(
    details: &serde_json::Value,
) -> Option<(String, Option<String>, Option<String>)> {
    let obj = details.as_object()?;
    let service_id = obj
        .get("service_id")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("model_id").and_then(|v| v.as_str()))?
        .to_string();
    let service_version = obj
        .get("service_version")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("version").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    let reason = obj.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string());
    Some((service_id, service_version, reason))
}


