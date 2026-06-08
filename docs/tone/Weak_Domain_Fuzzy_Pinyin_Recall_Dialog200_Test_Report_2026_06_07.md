# Weak Domain + Fuzzy Pinyin Recall — dialog_200 测试报告

**日期：** 2026-06-07  
**对比基线：** Local Raw-IME Diff 批测（`lexicon-tone-dialog200-local-raw-ime-batch-result.json`）  
**本轮批测：** `weak-domain-fuzzy-dialog200-batch-result.json`  
**开发报告：** [Weak_Domain_Fuzzy_Pinyin_Recall_Development_Report_2026_06_07.md](./Weak_Domain_Fuzzy_Pinyin_Recall_Development_Report_2026_06_07.md)

---

## 1. 测试环境

| 项 | 值 |
|----|-----|
| 音频目录 | `D:\Programs\github\lingua_1\test wav\dialog_200` |
| 用例数 | 200（d001–d200） |
| 节点端 | Electron Node，test server **5020** |
| 批测脚本 | `tests/run-dialog200-timed-batch.mjs --max-minutes 15` |
| payload | `lexicon_v2_intent_enabled: false` → primaryDomain=**general** |
| Recall flags | `weakDomainRecallEnabled=true`, `fuzzyPinyinRecallEnabled=true` |
| 构建 | `npm run build:main` 后 `npm start` |
| 进程 | 测试前已清理旧 node/electron 进程 |

### 1.1 执行摘要

| 指标 | 值 |
|------|-----|
| 完成条数 | **200 / 200** |
| 契约 PASS | **200 / 200** |
| 墙钟时间 | **746 s**（≈ 12.4 min，未触达 15 min 上限） |
| 停止原因 | `completed_all` |
| 分析脚本 | `tests/experiments/_weak-domain-fuzzy-batch-analyze.mjs` |

---

## 2. Recall 层指标（本轮新增能力）

| 指标 | 值 | 说明 |
|------|-----|------|
| cases_with_weak_domain | **158 / 200** | FW 触发 case 中 weak 诊断开启 |
| cases_with_fuzzy | **158 / 200** | 同上，fuzzy 路径激活 |
| cases_with_domain_hits | **4 / 200** | SQL domain 桶有命中 |
| total_domain_hits | **19** | 跨 span 累计（基线 general=0） |
| total_fuzzy_candidates | **156** | fuzzy_plain + fuzzy_plain_domain 计分候选 |
| total_weak_candidates | **12** | exact_domain_weak 计分候选 |
| **recall_ms_avg** | **1.85 ms** | P0 目标 < 5ms ✅ |
| **recall_ms_p95** | **3 ms** | P0 目标 < 15ms ✅ |
| industry_routing_used | **false** | 与 weak 互斥 ✅ |

---

## 3. FW 触发与 Apply（与基线对比）

| 指标 | Local Raw-IME 基线 | 本轮 Weak+Fuzzy | Δ |
|------|-------------------|-----------------|---|
| contract PASS | 200/200 | 200/200 | 0 |
| fw_triggered | 158 | 158 | 0 |
| fw_applied (apply>0) | 0 | 0 | 0 |
| kenlm_approved_total | 0 | 0 | 0 |
| text_changed | 0 | 0 | 0 |

> Recall 层已能召回餐饮候选，但 KenLM 句子 rerank 仍 `pickedIsRaw=true`（`maxDelta < minDeltaToReplace=0.03`），Final 文本未变。

---

## 4. 识别质量（CER）

### 4.1 全量

| 指标 | Raw CER | Final CER | vs 基线 final |
|------|---------|-----------|---------------|
| avg | **0.265** | **0.250** | 相同 |
| p50 | 0.20 | 0.20 | |
| p95 | 0.60 | 0.60 | |
| exact match (final) | — | **25 / 200** | 相同 |

### 4.2 餐饮子集 (cafe)

| 指标 | 值 |
|------|-----|
| raw CER avg | **0.182** |
| final CER avg | **0.182** |
| apply>0 | **0 / 52** |

---

## 5. 性能

| 指标 | Local Raw-IME 基线 | 本轮 | Δ |
|------|-------------------|------|---|
| wall_clock_sec | 652 | **746** | +94 s (+14%) |
| pipeline_avg | 3254 ms | **3725 ms** | +471 ms |
| pipeline_p50 | — | **3462 ms** | |
| pipeline_p95 | — | **6834 ms** | |
| pipeline_min / max | — | 1683 / **15584** ms | d067 异常长句 |

Recall 子阶段增量可忽略（avg 1.85ms）；墙钟增加主要来自 ASR/ KenLM 方差，非 Recall SQL 爆炸（d001 单 case v2_sql_query_count=43，可接受）。

---

## 6. P0 关键用例抽样

### 6.1 d001（cafe）— ✅ Recall 目标达成

| 字段 | 值 |
|------|-----|
| ref | 你好，我想点一杯热拿铁，**中杯**，少糖。顺便问一下今天有**蓝莓马芬**吗？ |
| raw | 你好,我想点一杯热拿铁**钟贝**少糖 **深便**温 以下今天有**蓝美马分**吗? |
| fin | 与 raw 相同（apply=0） |
| CER | raw=final=**0.259** |

**Recall 诊断（节选）：**

| span | fuzzyVariantExamples | domain_hits | sent_to_kenlm | 召回候选（Top） |
|------|---------------------|-------------|---------------|-----------------|
| 钟贝 | `zhong\|bei`, `bei\|shao` | 4 | 2 | **中杯**, 终杯 |
| 有蓝美马分 | `lan\|mei\|ma\|fen`, `you\|lan\|mei\|ma` | 2 | 2 | **蓝莓马芬**, 兰梅马芬 |

**句子 rerank Top1（未采纳）：**

```
你好,我想点一杯热拿铁中杯糖 身边温 以下今天蓝莓马芬吗?
kenlmDelta=0.00033  <  minDeltaToReplace=0.03  →  pickedIsRaw=true
```

### 6.2 d002（cafe）— ⚠️ Recall 未命中

| 字段 | 值 |
|------|-----|
| ref | …**美式**…**大杯**… |
| raw | …**美食**…**大悲**… |
| fw_reason | `no_candidates` |
| fuzzyVariantExamples | `yi\|bei\|mei\|shi`, `zuo\|yi\|bei\|mei` 等 |
| domain_hits | **0** |
| CER | **0.118** |

> variant 已生成，但 span「美食」「大悲」未对齐到 `mei\|shi` / `da\|bei` 查桶；属 span 切分 + fuzzy 对齐待优化。

### 6.3 d003（cafe）— ⚠️ 小杯未召回

| 字段 | 值 |
|------|-----|
| ref | …少冰…**小杯** |
| raw | …少病…**小背** |
| fuzzyVariantExamples | `shi\|jian\|xiao\|bei`, `shi\|jian\|xiao` |
| domain_hits | **0** |
| CER | **0.105** |

### 6.4 d138（cafe）— 部分命中

| 字段 | 值 |
|------|-----|
| ref | …**美式**…**小杯** |
| raw | …**美式**…**小杯**（ASR 部分正确） |
| fw | true，apply=0 |

---

## 7. 批测抽样表（6 条）

| id | scenario | fw | applied | domain_hits | fuzzyCand | raw 片段 | fin 片段 |
|----|----------|----|---------|-------------|-----------|----------|----------|
| d001 | cafe | ✅ | 0 | 6 | 5 | 钟贝少糖…蓝美马分 | 同 raw |
| d002 | cafe | ✅ | 0 | 0 | 0 | 美食…大悲 | 同 raw |
| d003 | cafe | ✅ | 0 | 0 | 0 | 少病…小背 | 同 raw |
| d046 | cafe | ✅ | 0 | 0 | 2 | 中貝…知识蛋糕 | 同 raw |
| d050 | meeting | ✅ | 0 | 0 | 0 | 订单中台内存 | 同 raw |
| d181 | cafe | ✅ | 0 | — | — | 中貝少糖…蓝没马分 | 同 raw |

---

## 8. 结论

### 8.1 P0 Recall 层

- ✅ **Weak Domain**：general 批测下 `domain_hits` 从 0 变为有命中；d001 验证 weak+fuzzy 联合查桶。
- ✅ **Fuzzy Pinyin**：`zhong|bei`、`lan|mei|ma|fen` 等 variant 进入 SQL；性能达标。
- ✅ **契约与回归**：200/200 PASS，flag 关闭行为不变（单测覆盖）。

### 8.2 端到端质量

- ❌ **Final CER / apply** 与 Local Raw-IME 基线**相同**；瓶颈仍在 **KenLM 句子级替换门控**，非 Recall。
- ⚠️ **d002/d003** 等 case Recall 仍未命中，需后续 span-variant 对齐审计。

### 8.3 建议下一步

1. 对 d001 类「Recall 有候选、KenLM 不替换」Case 做 KenLM delta 诊断（Apply 层，P1+）。
2. 审计 d002「美食→美式」span 音节与 fuzzy variant 对齐。
3. 餐饮子集注入 `primaryDomain=restaurant` 对比 weak-strong 权重效果。

---

## 9. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
node tests/patch-weak-domain-fuzzy-config.mjs
# 启动节点（另终端）
cd D:\Programs\github\lingua_1
.\scripts\start_electron_node.ps1
# 批测
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 15 --out weak-domain-fuzzy-dialog200-batch-result.json
node tests/experiments/_weak-domain-fuzzy-batch-analyze.mjs
```
