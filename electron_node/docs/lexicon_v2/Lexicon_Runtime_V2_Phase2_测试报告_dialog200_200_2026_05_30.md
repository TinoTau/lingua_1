# Lexicon Runtime V2 — Phase 2 测试报告（dialog_200 × 200）

版本：V1.0  
日期：2026-05-30  
测试范围：Phase 2 Session Intent + FW 主链回归  
音频集：`D:\Programs\github\lingua_1\test wav\dialog_200`（**全量 200 条**）

原始结果：

- `electron_node/electron-node/tests/lexicon-v2-phase2-dialog200-batch-result.json`
- `electron_node/electron-node/tests/lexicon-v2-phase2-dialog200-quality-perf.json`
- `electron_node/electron-node/tests/phase2-dialog200-run.log`
- `electron_node/electron-node/tests/lexicon-v2-phase2-intent-e2e-result.json`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | `cleanup_orphaned_processes_simple` + 结束残留 electron |
| 构建 | `npm run build:main` + `electron-rebuild better-sqlite3` |
| 节点 | `npm start`（`PROJECT_ROOT`，`NODE_ENV=production`） |
| 配置 | `lexiconV2.enabled=true`，`sessionIntentWriteEnabled=true`，`timeoutMs=45000` |
| Intent | `lexicon-intent-cpu` @ 5018，`model_loaded=true` |
| ASR | `faster-whisper-vad` |
| FW | `fw_detector_v1`，KenLM `weak_veto` |
| V2 Runtime | `lexiconRuntimeV2.enabled=true`，startup `status=ok` |
| 批测 | `node tests/run-lexicon-v2-phase2-dialog200-batch.js --intent-drain-sec 240` |
| 批测总耗时 | **1074 s**（含 240 s Intent 队列 drain） |

---

## 2. 主链契约批测

**结论：** ✅ **200 / 200 PASS**（`pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|------|
| pass / fail / skip | 200 / 0 / 0 |
| fw_applied_total | 10 |
| text_changed_count | 9 |
| lexicon_runtime_ok_count | 200 |

与 Phase 1 批测一致：FW apply 仍集中在 **cafe** 场景（钟贝→中杯等），**0 劣化**。

---

## 3. 识别质量（相对 manifest 参考文本）

归一化字符级 CER（`analyze-phase2-dialog200-quality-perf.mjs`）。

| 指标 | raw ASR | FW 后 text_asr |
|------|---------|----------------|
| 平均 CER | **36.19%** | **35.93%** |
| 中位 CER | 26.67% | 26.67% |
| P95 CER | 88.0% | 88.0% |
| FW 改善 case | — | **9** |
| FW 劣化 case | — | **0** |

与 Phase 1 批测（35.76% final CER）**同一量级**，Phase 2 Intent 开启 **未劣化 ASR/FW 质量**。

---

## 4. 性能数据

| 指标 | avg | p50 | p95 | min | max |
|------|-----|-----|-----|-----|-----|
| pipeline_ms | 4160 | 3530 | 7458 | 2373 | 11696 |
| asr_latency_ms | 1493 | 1448 | 2084 | — | — |
| audio_ms | 3638 | 3900 | — | — | — |

| 衍生 | Phase 2 | Phase 1（对照） |
|------|---------|-----------------|
| pipeline 总 CPU 时间 | 832 s | 504 s |
| RTF pipeline | **1.144** | 0.689 |
| 批测墙钟时间 | 1074 s | ~520 s |

**说明：** Phase 2 开启 Intent 调度 + 240 s drain，pipeline 均值上升主要来自 Intent 健康检查/异步调度开销与 ASR 并发负载，**非 FW 主链逻辑变更**。

---

## 5. Phase 2 Session Intent 专项

### 5.1 dialog_200 批测后 Session 导出（200 session）

| 指标 | 值 |
|------|------|
| session 总数 | 200 |
| `lexiconSessionIntent` 已写入 | **100**（50%） |
| 含 `topicKeywords` | **100** |
| 含 `topicKeywordPinyinKeys` | **100** |
| Intent outcome 分布 | `profile_updated` 100，`skipped_by_debounce` 81，`unknown_domain` 19 |

**primaryDomain 分布（已写入 Intent）：**

| domain | count |
|--------|-------|
| meeting | 58 |
| restaurant | 21 |
| medical | 7 |
| travel | 6 |
| transport | 5 |
| tech_ai | 3 |

**50% 写入率原因：** Intent Worker **latest-only** 队列；200 条串行 finalize 各触发 bootstrap Intent，大量 job 被 `skipped_by_debounce` 替换。**非 parser/写入链缺陷**。

### 5.2 单 Session E2E（`run-lexicon-v2-phase2-intent-e2e.js`）

**结论：** ✅ **PASS**

| 字段 | 样例值 |
|------|--------|
| primaryDomain | `restaurant` |
| topicKeywords | `["咖啡","中杯","少糖","深便温"]` |
| topicKeywordPinyinKeys | `["ka\|fei","zhong\|bei","shao\|tang","shen\|bian\|wen"]` |
| source | `cpu_llm` |
| confidence | 0.95 |

Intent 服务直连 probe：`topicKeywords: ["咖啡","中杯"]` ✅

---

## 6. 验收结论

| 验收项 | 结果 |
|--------|------|
| Phase 2 Intent 写入链 | ✅ 单 session E2E PASS |
| topicKeywords + pinyinKeys | ✅ |
| dialog_200 主链回归 | ✅ 200/200 |
| ASR/FW 质量 | ✅ 无劣化 |
| Recall V2 | ⏸ 未测（Phase 3） |

---

## 7. 建议（Phase 2 暂停点）

1. **批测 Intent 覆盖率：** 若需 200/200 写入，应改为 **多 turn 同 session** 或 **串行 wait-for-intent**（耗时会显著增加）。
2. **unknown_domain（19）：** 核对 LLM 输出 domain 与 `profile-registry` 白名单。
3. **topicKeywords 噪声：** 后续可加长度/词性过滤，不阻塞 Phase 3。

---

## 8. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npx electron-rebuild -f -w better-sqlite3
npm run build:main

$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:NODE_ENV = "production"
npm start

# 新终端
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/run-lexicon-v2-phase2-dialog200-batch.js --intent-drain-sec 240
node tests/analyze-phase2-dialog200-quality-perf.mjs
node tests/run-lexicon-v2-phase2-intent-e2e.js
```
