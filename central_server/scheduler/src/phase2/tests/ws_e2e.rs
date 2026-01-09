    #[tokio::test]
    async fn phase2_ws_e2e_real_websocket_minimal() {
        // 目标：启动两个 scheduler（A/B），node 连 A，session 连 B，
        // 验证：B 创建 job -> routed 到 A 下发 -> node 回传结果 -> routed 回 B -> session 收到 TranslationResult。
        //
        // 默认跳过：避免在普通 `cargo test` 中引入网络/时序不确定性。
        if std::env::var("LINGUA_TEST_PHASE2_WS_E2E").is_err() {
            eprintln!("skip: set LINGUA_TEST_PHASE2_WS_E2E=1 to enable");
            return;
        }

        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let key_prefix = std::env::var("LINGUA_TEST_KEY_PREFIX").unwrap_or_else(|_| {
            format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""))
        });

        let (state_a, rt_a) = build_test_state("ws-a", redis_cfg.clone(), key_prefix.clone()).await;
        let (state_b, rt_b) = build_test_state("ws-b", redis_cfg.clone(), key_prefix.clone()).await;

        // 等待 presence 生效（resolve owner 需要校验实例存活）
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if rt_a.is_instance_alive(&rt_a.instance_id).await && rt_b.is_instance_alive(&rt_b.instance_id).await {
                break;
            }
            if tokio::time::Instant::now() > deadline {
                panic!("phase2 presence not ready");
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        let (addr_a, shutdown_a) = spawn_ws_server(state_a.clone()).await;
        let (addr_b, shutdown_b) = spawn_ws_server(state_b.clone()).await;

        let node_url = format!("ws://{}/ws/node", addr_a);
        let sess_url = format!("ws://{}/ws/session", addr_b);

        // ===== node client（连接 A）=====
        let (node_ws, _) = tokio_tungstenite::connect_async(node_url).await.unwrap();
        let (mut node_write, mut node_read) = node_ws.split();
        let (node_tx, mut node_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        // writer task
        tokio::spawn(async move {
            while let Some(s) = node_rx.recv().await {
                let _ = node_write.send(tokio_tungstenite::tungstenite::Message::Text(s)).await;
            }
        });

        // send node_register
        let node_id = "node-ws-e2e-1";
        node_tx
            .send(serde_json::to_string(&sample_node_register(node_id)).unwrap())
            .unwrap();

        // 关键：发心跳让节点从 registering -> ready（NodeRegistry 选节点硬要求 status==ready）
        for _ in 0..3 {
            node_tx
                .send(serde_json::to_string(&sample_node_heartbeat(node_id)).unwrap())
                .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // 等待节点注册完成，然后触发 Pool 重建（如果启用 Phase3 自动生成）
        {
            let cfg_a = state_a.node_registry.phase3_config().await;
            if cfg_a.enabled && cfg_a.auto_generate_language_pools {
                // 等待节点注册完成
                let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
                loop {
                    if state_a.node_registry.get_node_snapshot(node_id).await.is_some() {
                        break;
                    }
                    if tokio::time::Instant::now() > deadline {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                // 触发 Pool 重建（确保 Pool 配置生成）
                state_a.node_registry.rebuild_auto_language_pools(Some(rt_a.clone())).await;
            }
        }

        // reader/reactor task：收到 job_assign 就立即回 ack/started/result
        let node_tx2 = node_tx.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = node_read.next().await {
                let tokio_tungstenite::tungstenite::Message::Text(txt) = msg else { continue };
                let parsed: crate::messages::NodeMessage = match serde_json::from_str(&txt) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let crate::messages::NodeMessage::JobAssign {
                    job_id,
                    attempt_id,
                    session_id,
                    utterance_index,
                    trace_id,
                    ..
                } = parsed
                {
                    // ack
                    let ack = crate::messages::NodeMessage::JobAck {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.to_string(),
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                    };
                    let started = crate::messages::NodeMessage::JobStarted {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.to_string(),
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                    };
                    let result = crate::messages::NodeMessage::JobResult {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.to_string(),
                        session_id: session_id.clone(),
                        utterance_index,
                        success: true,
                        text_asr: Some("hello".to_string()),
                        text_translated: Some("你好".to_string()),
                        tts_audio: None,
                        tts_format: None,
                        extra: None,
                        processing_time_ms: Some(1),
                        error: None,
                        trace_id: trace_id.clone(),
                        group_id: None,
                        part_index: None,
                        node_completed_at_ms: None,
                        asr_quality_level: None,
                        reason_codes: None,
                        quality_score: None,
                        rerun_count: None,
                        segments_meta: None,
                    };
                    let _ = node_tx2.send(serde_json::to_string(&ack).unwrap());
                    let _ = node_tx2.send(serde_json::to_string(&started).unwrap());
                    let _ = node_tx2.send(serde_json::to_string(&result).unwrap());
                    return;
                }
            }
        });

        // 等待 B 的 node snapshot refresher 把 node 同步进来且状态为 ready（否则 B 选不到节点）
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if let Some(n) = state_b.node_registry.get_node_snapshot(node_id).await {
                if n.status == NodeStatus::Ready {
                    break;
                }
            }
            if tokio::time::Instant::now() > deadline {
                let st = state_b
                    .node_registry
                    .get_node_snapshot(node_id)
                    .await
                    .map(|n| format!("{:?}", n.status))
                    .unwrap_or_else(|| "none".to_string());
                panic!("node snapshot not propagated to scheduler B as ready (current={})", st);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // 等待 Phase3 Pool 配置和成员索引同步到 Redis（如果启用 Phase3）
        let cfg_b = state_b.node_registry.phase3_config().await;
        if cfg_b.enabled && cfg_b.mode == "two_level" {
            // 等待 Pool 配置生成（如果自动生成模式）
            if cfg_b.auto_generate_language_pools {
                // 等待节点快照同步到 B，然后触发 Pool 重建
                let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
                loop {
                    // 检查节点是否在本地注册表中（快照同步后会在本地注册表中）
                    let node_in_local = {
                        let mgmt = state_b.node_registry.management_registry.read().await;
                        mgmt.nodes.contains_key(node_id)
                    };
                    if node_in_local {
                        // 节点已在本地注册表，触发 Pool 重建
                        state_b.node_registry.rebuild_auto_language_pools(Some(rt_b.clone())).await;
                        // 重新分配节点到 Pool（因为 Pool 配置可能刚生成）
                        // 注意：节点快照同步时会自动调用 phase3_upsert_node_to_pool_index
                        // 但为了确保分配，我们触发一次快照更新
                        if let Some(node) = state_b.node_registry.get_node_snapshot(node_id).await {
                            state_b.node_registry.upsert_node_from_snapshot(node, Some(&*rt_b)).await;
                        }
                        break;
                    }
                    if tokio::time::Instant::now() > deadline {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }

                // 等待 Pool 配置生成并同步到 Redis
                let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
                loop {
                    let cfg = state_b.node_registry.phase3_config().await;
                    if !cfg.pools.is_empty() {
                        // Pool 配置已生成，检查 Pool 成员索引
                        let pool_ids = state_b.node_registry.phase3_node_pool_ids(node_id).await;
                        if !pool_ids.is_empty() {
                            // 如果启用 Phase2，检查 Redis 中的 Pool 成员
                            if let Some(rt_b) = state_b.phase2.as_ref() {
                                let mut all_synced = true;
                                for pool_id in &pool_ids {
                                    if let Some(pool) = cfg.pools.iter().find(|p| p.pool_id == *pool_id) {
                                        let members_opt = rt_b.get_pool_members_from_redis(&pool.name).await;
                                        if let Some(members) = members_opt {
                                            if !members.contains(node_id) {
                                                all_synced = false;
                                                break;
                                            }
                                        } else {
                                            // Redis 中还没有 Pool 成员，继续等待
                                            all_synced = false;
                                            break;
                                        }
                                    }
                                }
                                if all_synced {
                                    break;
                                }
                            } else {
                                // 未启用 Phase2，只需要检查本地 Pool 分配
                                break;
                            }
                        }
                    }
                    if tokio::time::Instant::now() > deadline {
                        let cfg = state_b.node_registry.phase3_config().await;
                        let pool_ids = state_b.node_registry.phase3_node_pool_ids(node_id).await;
                        panic!(
                            "Phase3 Pool not ready: pools={}, node_pool_ids={:?}",
                            cfg.pools.len(),
                            pool_ids
                        );
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }

        // ===== session client（连接 B）=====
        let (sess_ws, _) = tokio_tungstenite::connect_async(sess_url).await.unwrap();
        let (mut sess_write, mut sess_read) = sess_ws.split();

        let init = crate::messages::SessionMessage::SessionInit {
            client_version: "test".to_string(),
            platform: "web".to_string(),
            src_lang: "en".to_string(),
            tgt_lang: "zh".to_string(),
            dialect: None,
            features: None,
            pairing_code: None,
            tenant_id: None,
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: Some(true),
            partial_update_interval_ms: Some(100),
            trace_id: Some("trace-ws-e2e".to_string()),
        };
        sess_write
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&init).unwrap(),
            ))
            .await
            .unwrap();

        // 收到 session_init_ack
        let mut session_id = None::<String>;
        let mut trace_id = None::<String>;
        let ack_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        while tokio::time::Instant::now() < ack_deadline {
            let msg = tokio::time::timeout(std::time::Duration::from_secs(3), sess_read.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let tokio_tungstenite::tungstenite::Message::Text(txt) = msg else { continue };
            let parsed: crate::messages::SessionMessage = serde_json::from_str(&txt).unwrap();
            if let crate::messages::SessionMessage::SessionInitAck { session_id: sid, trace_id: tid, .. } = parsed {
                session_id = Some(sid);
                trace_id = Some(tid);
                break;
            }
        }
        let session_id = session_id.expect("no session_init_ack");
        let trace_id = trace_id.unwrap_or_else(|| "trace-ws-e2e".to_string());

        // 发 utterance
        let audio_b64 = base64::engine::general_purpose::STANDARD.encode(b"\0\0\0\0");
        let utt = crate::messages::SessionMessage::Utterance {
            session_id: session_id.clone(),
            utterance_index: 0,
            manual_cut: true,
            src_lang: "en".to_string(),
            tgt_lang: "zh".to_string(),
            dialect: None,
            features: None,
            audio: audio_b64,
            audio_format: "wav".to_string(),
            sample_rate: 16000,
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: Some(true),
            partial_update_interval_ms: Some(100),
            trace_id: Some(trace_id.clone()),
        };
        sess_write
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&utt).unwrap(),
            ))
            .await
            .unwrap();

        // 等待 translation_result（或至少收到包含翻译结果的消息）
        let res_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut got_result = false;
        while tokio::time::Instant::now() < res_deadline {
            let next = tokio::time::timeout(std::time::Duration::from_secs(5), sess_read.next()).await;
            let Ok(Some(Ok(msg))) = next else { continue };
            let tokio_tungstenite::tungstenite::Message::Text(txt) = msg else { continue };
            let parsed: crate::messages::SessionMessage = match serde_json::from_str(&txt) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let crate::messages::SessionMessage::TranslationResult { session_id: sid, text_asr, text_translated, .. } = parsed {
                assert_eq!(sid, session_id);
                assert!(!text_asr.is_empty());
                assert!(!text_translated.is_empty());
                got_result = true;
                break;
            }
        }
        assert!(got_result, "did not receive translation_result");

        // shutdown servers
        let _ = shutdown_a.send(());
        let _ = shutdown_b.send(());
    }

