# Lexicon 调号补齐 — dialog_200 测试报告

**日期：** 2026-06-07  
**环境：** Windows · Electron Node `:5020` · FW `:6007` · `faster-whisper-vad`  
**音频集：** `D:\Programs\github\lingua_1\test wav\dialog_200`（200 条，全部执行）  
**词库 bundle：** `node_runtime/lexicon/v3`（checksum `84a1ed29…`，build `2026-06-07T03:23:11Z`）

---

## 1. 词库调号验收（测试前）

| 表 | 总行数 | 数字调号覆盖 |
|----|--------|--------------|
| base_lexicon | 50,000 | 100% |
| idiom_lexicon | 22,192 | 100% |
| domain_lexicon | 25 | 100% |

**结论：** 数据库词条均已包含带数字的 `tone_pinyin_key`，满足本轮开发目标。

---

## 2. 批测配置

| 项 | 值 |
|----|-----|
| 脚本 | `tests/run-dialog200-timed-batch.mjs` |
| 时限 | 15 min（实际 748 s，200/200 完成） |
| 接口 | `POST /run-pipeline-with-audio` |
| 语言 | zh → en |
| ASR | faster-whisper-vad（200/200） |
| Lexicon runtime | `lexicon_runtime_status=ok`（200/200） |

---

## 3. 契约 / 稳定性

| 指标 | 结果 |
|------|------|
| 评估条数 | 200 |
| 契约 PASS | **200** |
| FAIL | 0 |
| SKIP | 0 |
| 契约通过率 | **100%** |
| 墙钟时间 | 748 s（12.5 min） |
| FW 触发 | 66 条 |
| FW apply | **0 条** |
| 文本被 FW 修改 | 0 条 |

---

## 4. 识别质量（字符错误率 CER，对比 manifest `utterance`）

| 指标 | 值 |
|------|-----|
| 平均 CER | 0.2501 |
| 中位 CER | 0.2000 |
| P95 CER | 0.6000 |
| 完全匹配条数 | 25 / 200（12.5%） |
| 餐饮场景 cafe（15 条）平均 CER | 0.1820 |

> CER 基于去标点归一化后的字符编辑距离；反映 **ASR 原始识别质量**，非 FW 修后（本轮 FW apply=0，final≈raw）。

---

## 5. 性能

| 指标 | avg | P50 | P95 | min | max |
|------|-----|-----|-----|-----|-----|
| pipeline_ms | 3,733 | 2,917 | 8,918 | 1,597 | 13,971 |
| asr_latency_ms | 1,009 | 887 | 1,422 | — | — |
| tone_inference_ms | 7 | 7 | 11 | — | — |
| audio_ms（均值） | 3,638 | — | — | — | — |
| RTF（pipeline/audio） | 1.026 | — | — | — | — |

**ToneModule：** 200/200 条 `toneEnabled=true`（100%）。

---

## 6. 调号 Recall 运行时统计（FW 触发子集）

| 指标 | 值 |
|------|-----|
| FW 触发案例 | 66 |
| 含 `acousticTonePattern` 的案例 | 45 |
| `recallToneCompatibleCount` 累计 | 11 |
| `recallToneFallbackCount` 累计 | 272 |
| 至少 1 次 tone-compatible recall 的案例 | 11 |

**解读：** 词库侧调号已 100% 入库；运行时已有少量 tone-compatible recall（11 次），但占 fallback 总量仍低。餐饮同音词（钟贝/中杯等）ASR 已错字时，span 未进入可修复路径（`fw_triggered=false` 或 `no_spans`），故未见 apply。

---

## 7. 结果抽样

### 7.1 餐饮场景（词库含 中杯/拿铁/美式 调号）

| ID | 参考 | 识别 | CER | FW |
|----|------|------|-----|-----|
| d001 | 你好，我想点一杯热拿铁，**中杯**，少糖。顺便问一下今天有**蓝莓马芬**吗？ | 你好,我想点一杯热拿铁**钟贝**少糖 深便温 以下今天有**蓝美马分**吗? | 0.259 | 未触发 |
| d002 | 麻烦帮我做一杯**美式**带走，**大杯**就行，谢谢。 | 麻烦帮我做一杯**美食**带走**大悲**就行谢谢 | 0.118 | 未触发 |
| d003 | 请问这款燕麦拿铁可以**少冰**吗？我赶时间，**小杯**。 | 请问,这款燕麦拿铁可以**少病**吗?我赶时间**小背** | 0.105 | 触发，apply=0 |

### 7.2 完全匹配（CER=0）

| ID | 场景 | 识别文本（节选） |
|----|------|------------------|
| d018 | friend | 你最近忙不忙,想找你看下手机备份怎么设置 |
| d023 | customer_service | 想改一下收货地址还来得及吗? 麻烦尽快处理谢谢 |
| d025 | interview | 请简单介绍一下你上一段项目里负责的核心模块和难点 |

### 7.3 最差识别（CER 高，非词库问题）

| ID | CER | 现象 |
|----|-----|------|
| d067 | 3.04 | ASR 重复「您好,我定,」幻觉 |
| d110 / d155 | 0.83 | 繁简混排 + 「后选生城」等同音长句 |
| d045 / d180 | 0.68~0.80 | lexicon_homophone 场景，候选生成/ASR 双重偏差 |

### 7.4 FW 触发 + ToneModule 样例（d003）

- `toneEnabled: true`
- `alignmentTextMatched: true`
- `acousticTonePattern: [3, 3]`（「少冰」「小杯」区域）
- `recallToneCompatibleCount: 0`，`recallToneFallbackCount: 6`（该 span 候选均未通过调号兼容）

---

## 8. 结论

| 维度 | 结论 |
|------|------|
| **词库调号** | ✅ 三表 100% 含数字 `tone_pinyin_key`；spot check 正确 |
| **构建 / 部署** | ✅ v3 bundle 已更新并通过 gate |
| **Runtime 加载** | ✅ 200/200 `lexicon_runtime_status=ok` |
| **契约稳定性** | ✅ 200/200 PASS，无崩溃 |
| **ASR 质量** | ⚠️ 平均 CER 0.25；餐饮 0.18；同音错字仍常见 |
| **FW 修复收益** | ⚠️ apply=0；调号 recall 有零星命中但未转化为修词 |
| **ToneModule 性能** | ✅ 推理 P95 11 ms，不构成瓶颈 |

**本轮开发目标（词库调号 SSOT）已达成。** dialog_200 端到端修词收益尚未体现，主因是 ASR 错字后 FW span 未触发/未 apply，需在 P1.1+ 继续审计 span 召回与餐饮 profile 注入，而非回退词库调号方案。

---

## 9. 原始数据

| 文件 | 说明 |
|------|------|
| `electron_node/electron-node/tests/lexicon-tone-dialog200-batch-result.json` | 全量 200 条 pipeline 结果 |
| `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-quality-perf.json` | 汇总质量/性能/调号 |
| `electron_node/electron-node/tests/experiments/lexicon-tone-db-audit.json` | SQLite 调号审计 |
