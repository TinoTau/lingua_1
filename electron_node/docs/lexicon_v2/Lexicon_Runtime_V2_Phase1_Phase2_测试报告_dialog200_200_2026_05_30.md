# Lexicon Runtime V2 — Phase 1 & Phase 2 测试报告（dialog_200 × 200）

版本：V1.0  
日期：2026-05-30  
测试范围：Lexicon Runtime V2 P1/P2 交付 + FW 主链回归  
音频集：`D:\Programs\github\lingua_1\test wav\dialog_200`（**全量 200 条**）

原始结果：

- `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`
- `electron_node/electron-node/tests/fw-detector-dialog-200-quality-perf.json`
- `electron_node/electron-node/tests/dialog200-batch-run.log`
- `electron_node/electron-node/logs/electron-main-batch.log`

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 清理 | `cleanup_orphaned_processes_simple` + 强制结束 electron/node |
| 构建 | `npm run build:main` + `npm run build:renderer` |
| SQLite | `npx electron-rebuild -f -w better-sqlite3` |
| 节点 | `npm start`（`PROJECT_ROOT=D:\Programs\github\lingua_1`，`NODE_ENV=production`） |
| 配置 | `%APPDATA%\lingua-electron-node\electron-node-config.json` |
| Test server | `http://127.0.0.1:5020` |
| ASR | `faster-whisper-vad`（auto-start=true） |
| FW | `fw_detector_v1`，KenLM `weak_veto` |
| V1 Lexicon | `lexicon_runtime_status=ok` × 200 |
| V2 Runtime | `lexiconRuntimeV2.enabled=true`，startup `status=ok` |
| P2 Intent | `lexiconV2.enabled=false`，批测 `lexicon_v2_intent_enabled=false` |
| 批测脚本 | `node tests/run-fw-detector-dialog-200-batch.js` |
| 批测时间 | 2026-05-30T12:08:37Z 起，串行约 **520 s** |

---

## 2. 批测前探测

| 检查项 | 结果 |
|--------|------|
| `/health` | OK |
| 单条 probe（d001） | `lexicon_runtime_status=ok`，FW apply（钟贝→中杯） |
| V2 startup | `base=50000, idiom=22192, domain=0, routing=0` |

**首次批测失败原因（已修复）：**

1. `better-sqlite3` ABI 不匹配 → electron-rebuild  
2. ASR 未拉起 → `faster-whisper-vad: true`  
3. Renderer 未构建 → `npm run build:renderer`

---

## 3. dialog_200 契约批测汇总

**结论：** ✅ **200 / 200 PASS**（`pipeline_ok_rate = 1.0`）

| 指标 | 值 |
|------|-----|
| total / pass / fail / skip | 200 / 200 / 0 / 0 |
| fw_triggered_count | 200 |
| fw_applied_case_count | 9 |
| fw_applied_total | 10 |
| text_changed_count | 9 |
| lexicon_runtime_ok_count | 200 |
| kenlm_approved_total | 49 |
| kenlm_vetoed_total | 0 |
| asr_service_id | faster-whisper-vad × 200 |

### 3.1 分场景（契约 pass）

| scenario | pass | fw_applied_cases |
|----------|------|------------------|
| cafe | 15 | **9** |
| meeting / taxi / hospital / shopping / friend | 各 15 | 0 |
| tech_deploy | 14 | 0 |
| 其余 8 场景 | 各 12 | 0 |
| lexicon_homophone | 12 | 0 |

### 3.2 FW apply 命中 case（cafe）

| id | applied | 典型修复 |
|----|---------|----------|
| d001 | 1 | 钟贝→中杯 |
| d002 | 2 | — |
| d046, d047, d091, d093, d137, d181, d182 | 各 1 | — |

---

## 4. 识别质量（相对 manifest 参考文本）

归一化规则：去标点/空白后字符级 CER（`analyze-dialog200-quality-perf.mjs`）。

| 指标 | raw ASR | FW 后 text_asr |
|------|---------|----------------|
| 平均 CER | **36.02%** | **35.76%** |
| 中位 CER | 26.32% | 26.32% |
| P95 CER | 88.0% | 88.0% |
| 完全匹配数 | 22 / 200 | 22 / 200 |
| FW 改善 case 数 | — | **9** |
| FW 劣化 case 数 | — | **0** |
| FW apply case 平均 CER 改善 | — | **5.83%** |

**说明：**

- TTS 合成音频 + 简繁/标点差异导致整体 CER 偏高；本批测重点为 **主链契约 + FW 不劣化 + P1/P2 无回归**。
- `lexicon_homophone`（后选生城/上线计化）FW **未 apply**（0/12），属 Phase 3 词库 recall 范畴。
- 高 CER 样例：d045/d090/d135/d180（homophone）、d194（shopping 繁简+截断）。

---

## 5. 性能数据

| 指标 | avg | p50 | p95 | min | max |
|------|-----|-----|-----|-----|-----|
| pipeline_ms | 2519 | 2232 | 4106 | 1530 | 7710 |
| asr_latency_ms | 894 | 869 | 1179 | 359 | 5898 |
| audio_ms | 3655 | 3900 | 5240 | — | — |

| 衍生指标 | 值 |
|----------|-----|
| 批测总耗时 | **504 s**（200 case 串行） |
| RTF（pipeline / audio） | **0.689** |
| RTF（ASR / audio） | **0.245** |

与历史 FW 主链批测（~494 s / avg pipeline ~2500 ms）同一量级，**P1 V2 Runtime 并行加载未引入可观测主链延迟回归**。

---

## 6. Phase 1 / Phase 2 专项结论

| 项 | 结论 |
|----|------|
| P1 Runtime V2 加载 | ✅ startup `status=ok`，四表计数与 shadow bundle 一致 |
| P1 接 FW Recall | ✅ 未接入（设计符合） |
| P2 Session Intent 写入 | ⏸ 批测未开 Intent；单测覆盖 parser / pinyinKey / finalize 链 |
| FW 主链回归 | ✅ 200/200 契约 PASS，0 劣化 |
| V1 词库 Recall | ✅ 200/200 `lexicon_runtime_status=ok` |

---

## 7. 建议下一步（Phase 2 暂停验证）

1. 开启 `lexiconV2.enabled=true` + `sessionIntentWriteEnabled=true`，启动 `lexicon-intent-cpu`，抽样 session 验证 `lexiconSessionIntent` 写入与 `result.extra` 字段。  
2. 通过后进入 **Phase 3**：仅改 `local-span-recall.ts` 切换 V2 lookup。  
3. **禁止**跳过 Phase 2 E2E 验证直接做 Recall V2。

---

## 8. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npx electron-rebuild -f -w better-sqlite3
npm run build:renderer
npm run build:main

# 配置 %APPDATA%\lingua-electron-node\electron-node-config.json
#   faster-whisper-vad: true
#   lexiconRuntimeV2.enabled: true

$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:NODE_ENV = "production"
npm start

# 新终端
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/run-fw-detector-dialog-200-batch.js
node tests/analyze-dialog200-quality-perf.mjs
```
