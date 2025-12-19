    async fn phase2_job_fsm_smoke() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = "test-fsm".to_string();
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

        let job_id = "job-fsm-1";
        rt.job_fsm_init(job_id, Some("node-1"), 1, 60).await;

        let s = rt.job_fsm_get(job_id).await.unwrap();
        assert_eq!(s.state, JobFsmState::Created.as_str());
        assert_eq!(s.attempt_id, 1);

        assert!(rt.job_fsm_to_dispatched(job_id, 1).await);
        assert!(rt.job_fsm_to_accepted(job_id, 1).await);
        assert!(rt.job_fsm_to_running(job_id).await);
        assert!(rt.job_fsm_to_finished(job_id, 1, true).await);
        assert!(rt.job_fsm_to_released(job_id).await);

        // 幂等：重复调用不应失败
        assert!(rt.job_fsm_to_dispatched(job_id, 1).await);
        assert!(rt.job_fsm_to_accepted(job_id, 1).await);
        assert!(rt.job_fsm_to_running(job_id).await);
        assert!(rt.job_fsm_to_finished(job_id, 1, true).await);
        assert!(rt.job_fsm_to_released(job_id).await);

        let s2 = rt.job_fsm_get(job_id).await.unwrap();
        assert_eq!(s2.state, JobFsmState::Released.as_str());
        assert_eq!(s2.finished_ok, Some(true));
    }

    #[tokio::test]
