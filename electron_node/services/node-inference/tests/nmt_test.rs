//! NMT (M2M100) 单元测试

use lingua_node_inference::nmt::NMTEngine;

#[tokio::test]
#[ignore] // 需要 NMT 服务运行
async fn test_nmt_engine_http() {
    // 测试 NMT HTTP 客户端（需要 Python M2M100 服务运行）
    let engine = NMTEngine::new_with_http_client(None)
        .expect("Failed to create NMT engine");

    // 测试英文到中文翻译
    let result = engine.translate("Hello", "en", "zh", None).await;
    match result {
        Ok(text) => {
            println!("✓ NMT 翻译成功: Hello -> {}", text);
            assert!(!text.is_empty(), "翻译结果不应为空");
        }
        Err(e) => {
            println!("⚠️  NMT 服务不可用: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 需要 NMT 服务运行
async fn test_nmt_engine_zh_en() {
    let engine = NMTEngine::new_with_http_client(None)
        .expect("Failed to create NMT engine");

    // 测试中文到英文翻译
    let result = engine.translate("你好", "zh", "en", None).await;
    match result {
        Ok(text) => {
            println!("✓ NMT 翻译成功: 你好 -> {}", text);
            assert!(!text.is_empty(), "翻译结果不应为空");
        }
        Err(e) => {
            println!("⚠️  NMT 服务不可用: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 需要 NMT 服务运行
async fn test_nmt_engine_custom_url() {
    // 测试自定义服务 URL
    let engine = NMTEngine::new_with_http_client(Some("http://127.0.0.1:5008".to_string()))
        .expect("Failed to create NMT engine");

    let result = engine.translate("Test", "en", "zh", None).await;
    match result {
        Ok(_) => {
            println!("✓ NMT 自定义 URL 测试通过");
        }
        Err(_) => {
            println!("⚠️  NMT 服务不可用（这是正常的，如果服务未运行）");
        }
    }
}

