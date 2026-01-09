//! Session 运行时单元测试

#[cfg(test)]
mod tests {
    use super::super::session_runtime::{
        SessionRuntimeManager, SessionRuntimeState, SessionEntry,
    };
    use std::sync::Arc;

    #[test]
    fn test_session_runtime_state_new() {
        let state = SessionRuntimeState::new();
        assert_eq!(state.preferred_pool, None);
        assert_eq!(state.bound_lang_pair, None);
        assert_eq!(state.cached_pool_members, None);
    }

    #[test]
    fn test_session_runtime_state_set_preferred_pool() {
        let mut state = SessionRuntimeState::new();
        state.set_preferred_pool(1);
        assert_eq!(state.preferred_pool, Some(1));
        
        state.set_preferred_pool(2);
        assert_eq!(state.preferred_pool, Some(2));
    }

    #[test]
    fn test_session_runtime_state_set_bound_lang_pair() {
        let mut state = SessionRuntimeState::new();
        state.set_bound_lang_pair("zh".to_string(), "en".to_string());
        assert_eq!(state.bound_lang_pair, Some(("zh".to_string(), "en".to_string())));
    }

    #[tokio::test]
    async fn test_session_runtime_state_pool_members_cache() {
        let mut state = SessionRuntimeState::new();
        
        // 更新缓存
        state.update_pool_members_cache(1, vec!["node-1".to_string(), "node-2".to_string()]);
        assert!(state.cached_pool_members.is_some());
        
        // 获取缓存（未过期）
        let cached = state.get_cached_pool_members(1, 10000);
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().len(), 2);
        
        // 获取缓存（过期）- 使用更短的等待时间
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        let cached_expired = state.get_cached_pool_members(1, 5); // 5ms TTL，应该过期
        assert!(cached_expired.is_none());
    }

    #[tokio::test]
    async fn test_session_entry() {
        let entry = SessionEntry::new();
        let mut state = entry.get_state().await;
        
        state.set_preferred_pool(1);
        state.set_bound_lang_pair("zh".to_string(), "en".to_string());
        
        drop(state);
        
        // 再次获取状态，应该保持
        let state2 = entry.get_state().await;
        assert_eq!(state2.preferred_pool, Some(1));
        assert_eq!(state2.bound_lang_pair, Some(("zh".to_string(), "en".to_string())));
    }

    #[tokio::test]
    async fn test_session_runtime_manager_new() {
        let manager = SessionRuntimeManager::new();
        assert_eq!(manager.stats().session_count, 0);
    }

    #[tokio::test]
    async fn test_session_runtime_manager_get_or_create_entry() {
        let manager = SessionRuntimeManager::new();
        
        let entry1 = manager.get_or_create_entry("session-1");
        let entry2 = manager.get_or_create_entry("session-1");
        
        // 应该返回同一个 entry
        assert!(Arc::ptr_eq(&entry1.mutex, &entry2.mutex));
        
        // 不同的 session 应该返回不同的 entry
        let entry3 = manager.get_or_create_entry("session-2");
        assert!(!Arc::ptr_eq(&entry1.mutex, &entry3.mutex));
    }

    #[tokio::test]
    async fn test_session_runtime_manager_get_entry() {
        let manager = SessionRuntimeManager::new();
        
        // 不存在的 session
        assert!(manager.get_entry("session-1").is_none());
        
        // 创建后应该能获取
        manager.get_or_create_entry("session-1");
        assert!(manager.get_entry("session-1").is_some());
    }

    #[tokio::test]
    async fn test_session_runtime_manager_remove_entry() {
        let manager = SessionRuntimeManager::new();
        
        manager.get_or_create_entry("session-1");
        assert_eq!(manager.stats().session_count, 1);
        
        let removed = manager.remove_entry("session-1");
        assert!(removed);
        assert_eq!(manager.stats().session_count, 0);
        
        // 移除不存在的 session
        let removed2 = manager.remove_entry("session-2");
        assert!(!removed2);
    }

    #[tokio::test]
    async fn test_session_runtime_manager_get_all_session_ids() {
        let manager = SessionRuntimeManager::new();
        
        manager.get_or_create_entry("session-1");
        manager.get_or_create_entry("session-2");
        manager.get_or_create_entry("session-3");
        
        let ids = manager.get_all_session_ids();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains(&"session-1".to_string()));
        assert!(ids.contains(&"session-2".to_string()));
        assert!(ids.contains(&"session-3".to_string()));
    }

    #[tokio::test]
    async fn test_session_runtime_manager_concurrent_access() {
        let manager = SessionRuntimeManager::new();
        
        // 并发创建和访问（使用 futures_util 而不是 tokio::spawn，避免运行时问题）
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let manager = manager.clone();
                async move {
                    let session_id = format!("session-{}", i);
                    let entry = manager.get_or_create_entry(&session_id);
                    let mut state = entry.get_state().await;
                    state.set_preferred_pool(i as u16);
                    state.set_bound_lang_pair("zh".to_string(), "en".to_string());
                }
            })
            .collect();
        
        futures_util::future::join_all(handles).await;
        
        assert_eq!(manager.stats().session_count, 10);
    }

    #[tokio::test]
    async fn test_session_runtime_state_cache_ttl() {
        let mut state = SessionRuntimeState::new();
        
        state.update_pool_members_cache(1, vec!["node-1".to_string()]);
        
        // 立即获取（应该有效）
        let cached = state.get_cached_pool_members(1, 1000);
        assert!(cached.is_some());
        
        // 等待过期 - 使用更短的等待时间
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        let cached_expired = state.get_cached_pool_members(1, 5); // 5ms TTL，应该过期
        assert!(cached_expired.is_none());
    }
}
