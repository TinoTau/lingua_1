// 配对服务单元测试

use lingua_scheduler::pairing::PairingService;

#[tokio::test]
async fn test_generate_pairing_code() {
    let service = PairingService::new();
    
    let code = service.generate_pairing_code("node-123".to_string()).await;
    
    assert_eq!(code.len(), 6);
    assert!(code.chars().all(|c| c.is_ascii_digit()));
}

#[tokio::test]
async fn test_validate_pairing_code() {
    let service = PairingService::new();
    
    let node_id = "node-456".to_string();
    let code = service.generate_pairing_code(node_id.clone()).await;
    
    let validated = service.validate_pairing_code(&code).await;
    assert_eq!(validated, Some(node_id));
}

#[tokio::test]
async fn test_validate_nonexistent_code() {
    let service = PairingService::new();
    
    let validated = service.validate_pairing_code("000000").await;
    assert_eq!(validated, None);
}

#[tokio::test]
async fn test_validate_code_twice() {
    let service = PairingService::new();
    
    let node_id = "node-789".to_string();
    let code = service.generate_pairing_code(node_id.clone()).await;
    
    // 第一次验证应该成功
    let validated1 = service.validate_pairing_code(&code).await;
    assert_eq!(validated1, Some(node_id));
    
    // 第二次验证应该失败（代码已被使用）
    let validated2 = service.validate_pairing_code(&code).await;
    assert_eq!(validated2, None);
}

#[tokio::test]
async fn test_multiple_pairing_codes() {
    let service = PairingService::new();
    
    let code1 = service.generate_pairing_code("node-1".to_string()).await;
    // 添加延迟确保时间戳不同（配对码基于秒级时间戳）
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    let code2 = service.generate_pairing_code("node-2".to_string()).await;
    
    // 验证两个配对码都能正确关联到对应的节点
    let validated1 = service.validate_pairing_code(&code1).await;
    let validated2 = service.validate_pairing_code(&code2).await;
    
    assert_eq!(validated1, Some("node-1".to_string()));
    assert_eq!(validated2, Some("node-2".to_string()));
}

#[tokio::test]
async fn test_cleanup_expired_codes() {
    let service = PairingService::new();
    
    // 生成一个配对码
    let code = service.generate_pairing_code("node-999".to_string()).await;
    
    // 清理过期代码（当前代码应该还在有效期内）
    service.cleanup_expired_codes().await;
    
    // 代码应该仍然有效
    let validated = service.validate_pairing_code(&code).await;
    assert!(validated.is_some());
}

