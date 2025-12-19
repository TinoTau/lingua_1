## ops（上线收口产物）

### Prometheus

- 告警规则样例：`ops/prometheus/alerts.yml`

建议关注指标：
- `scheduler_phase2_redis_op_total`（按 op/result）
- `scheduler_phase2_inbox_pending`
- `scheduler_phase2_dlq_moved_total`
- `scheduler_no_available_node_total`（selector/reason）
- `scheduler_phase3_pool_selected_total`（pool/outcome/fallback）
- `scheduler_phase3_pool_attempt_total`（pool/result/reason）

### Runbook

- `docs/release_runbook.md`


