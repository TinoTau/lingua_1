# Dialog200 端到端与 Pinyin IME Spike — 测试报告

**日期**：2026-06-03  
**音频目录**：`D:\Programs\github\lingua_1\test wav\dialog_200`  
**时间预算**：15 分钟墙钟（实际批测约 **15.1 分钟** 完成 **184/200** 条）  
**节点端**：`npm start`（`NODE_ENV=production`，test server **5020** `/health` 就绪）

---

## 1. 执行摘要

| 维度 | 结果 |
|------|------|
| 管道可跑通 | 是（183 条 `faster-whisper-vad` ASR 有文本；1 条 `unknown`/504） |
| Lexicon V3.1 Runtime | **全部失败**（`lexicon_runtime_status: error`） |
| FW Detector 契约 | **0/184 pass**（`missing_fw_detector` + `lexicon_not_ok:error`） |
| ASR→参考 CER（raw） | 均值 **23.66%**，中位 **18.75%**，P95 **56.25%** |
| FW 纠错收益 | **0** 改善 / **0** 恶化（词库未加载，无 span 应用） |
| 离线 IME Spike | 184 条评估；**top1~top10 命中率均为 0**；Freeze Gate **不推荐入主链** |

**根因（阻塞 FW/词库）**：`better-sqlite3` 为 Node 22（MODULE **127**）编译，Electron 需要 **119**。

```
lexicon_runtime_error: The module '...\better_sqlite3.node' was compiled against
NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 119.
```

另：配置合并后 `lexiconRecall.enabled: false`（日志 `raw.lexiconRecall` / `merged.lexiconRecall`）。

---

## 2. 测试环境与步骤

1. `cleanup_orphaned_processes_simple.ps1` + `kill_residual_processes.ps1`
2. `npm run build:main`（成功）
3. `npm run lexicon:rebuild-sqlite`（**失败**，未产出 Electron ABI 模块）
4. 后台 `npm start`，`PROJECT_ROOT=D:\Programs\github\lingua_1`
5. `node tests/run-dialog200-timed-batch.mjs --max-minutes 15 "<dialog_200>"`
6. `node tests/analyze-dialog200-quality-perf.mjs`
7. `npm run spike:ime:export:repair` → `npm run spike:ime:dialog200` → `npm run spike:ime:analyze`

---

## 3. 识别质量（ASR raw vs manifest 参考）

数据源：`tests/fw-detector-dialog-200-quality-perf.json`（184 条有参考句）。

| 指标 | raw_asr | final (text_asr) | merge_probe |
|------|---------|------------------|-------------|
| 平均 CER | 0.2366 | 0.2366 | 0.2366 |
| 中位 CER | 0.1875 | 0.1875 | 0.1875 |
| P95 CER | 0.5625 | 0.5625 | 0.5625 |
| 归一化完全匹配数 | 22 | 22 | 22 |

说明：因 Lexicon/FW 未运行，`text_asr` 与 `raw_asr_text` 一致，无后处理增益。

**最差 5 条（final CER）**

| id | scenario | CER | 说明 |
|----|----------|-----|------|
| d042 | gym | 1.00 | 504/空识别 |
| d110 | tech_deploy | 0.83 | 繁体+术语误识（后选生城/联调） |
| d155 | tech_deploy | 0.83 | 同上模板 |
| d045 | lexicon_homophone | 0.80 | 专名词 homophone 未纠正 |
| d088 | lexicon_homophone | 0.68 | 候选生成/接口等误识 |

---

## 4. 性能

| 指标 | count | avg | P50 | P95 | min | max |
|------|-------|-----|-----|-----|-----|-----|
| pipeline_ms | 183 | 4762 | 3323 | 12512 | 1599 | 32790 |
| asr_latency_ms | 183 | 2465 | 1197 | 5413 | 396 | 23386 |
| audio_ms | 183 | 3619 | 3880 | 4920 | — | — |

| RTF | 值 |
|-----|-----|
| pipeline / audio | **1.316** |
| ASR / audio | **0.681** |

批测墙钟：**903 s**，评估 **184** 条，均约 **4.9 s/条**（含失败重试与早期较高延迟）。

**契约汇总**

```json
{
  "evaluated": 184,
  "pass": 0,
  "fail": 184,
  "pipeline_ok_rate": 0,
  "fw_triggered_count": 0,
  "fw_applied_case_count": 0,
  "text_changed_count": 0,
  "lexicon_runtime_ok_count": 0
}
```

---

## 5. 离线 Pinyin IME Spike（本轮开发）

| 项 | 值 |
|----|-----|
| 输入批测 | `fw-detector-dialog-200-batch-result.json`（184 cases） |
| 词表 | repair-only，`72217` 行，`58539` pinyin keys |
| 后端 | `dict_dp` |
| KenLM | 可用（`zh_char_3gram.trie.bin`） |
| IME 延迟 P95 | **1 ms**（PASS &lt; 200ms） |
| Detector Miss top5 | **0%**（FAIL，阈值需 &gt;15%） |
| Recall Empty top3 | N/A（子集 n=0） |
| recommend_mainline | **NO** |

**失败分类**：`ok: 183`，`english_mixed: 1`（d042）。绝大多数 case 的 `candidates: []`。

---

## 6. 测试结果抽样（10 条）

| id | scenario | 参考（节选） | raw ASR（节选） | CER≈ | 契约失败 | 备注 |
|----|----------|--------------|-----------------|------|----------|------|
| d001 | cafe | 热拿铁，中杯，少糖…蓝莓马芬 | 热拿铁钟贝少糖…蓝美马分 | ~0.35 | lexicon+fw | 典型同音误识 |
| d002 | cafe | 美式带走，大杯 | 美食带走大悲 | ~0.45 | lexicon+fw | |
| d004 | meeting | 接口报错，加缓存 | 包错…加緩存 | ~0.30 | lexicon+fw | 繁简混用 |
| d045 | lexicon_homophone | 后选生城，上线计划 | 后,学生成…上限計劃 | **0.80** | lexicon+fw | 词库未加载无法纠 |
| d088 | lexicon_homophone | 后选生城方案，候选生成 | 後,選生成功…候選生陳 | **0.68** | lexicon+fw | |
| d110 | tech_deploy | 上线计划窗口，后选生城模块联调 | 現對此發布…後選生 乘魔快 | **0.83** | lexicon+fw | |
| d042 | gym | 游泳次卡续费优惠 | *(空)* | **1.00** | HTTP 504 | 唯一 ERROR |
| d003 | cafe | 燕麦拿铁可以少冰吗 | *(见批测 JSON)* | 低 | lexicon+fw | 22 条完全匹配之一候选 |
| d020 | — | — | — | 低 | lexicon+fw | 完全匹配组（归一化） |
| d184 | — | — | — | — | lexicon+fw | 截止时间最后一条 |

**d001 明细**

- 参考：`你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？`
- raw：`你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?`
- `pipeline_ms`: 16969（早期冷启动偏高）
- `asr_latency_ms`: 5449

**d045 明细（专名词场景，本轮重点）**

- 参考：`关于后选生城和上线计化，请按上线计划执行，有问题群里说。`
- raw：`關於後,學生成為學生 和上限計劃請按上限計劃執行有問題群裡說`
- FW 未触发；离线 IME `candidates: []`，无法验证 topK 命中

---

## 7. 结论与修复建议

### 7.1 本轮开发（Spike）

- 离线链路**可运行**（导出、批测、分析脚本打通）。
- 在 **repair-only 词表 + dict_dp** 下，当前 ASR 拼音流**无法产生候选**，Freeze Gate 不通过属预期；需全量导出与/或 libpinyin 对比实验后再评。

### 7.2 节点端 Dialog200

- ASR 单独可测，质量与性能数据有效。
- **Lexicon + FW 路径本次未真正执行**；修复后才能评估「本轮主链相关开发」（Text Chain / FW）的真实收益。

### 7.3 建议操作（复测前）

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run lexicon:rebuild-sqlite    # 必须为 Electron ABI
# 确认 %APPDATA%\lingua-electron-node\electron-node-config.json 中 lexiconRecall.enabled=true
.\..\..\scripts\start_electron_node.ps1
node tests/run-dialog200-timed-batch.mjs --max-minutes 15 "D:\Programs\github\lingua_1\test wav\dialog_200"
```

Spike 全量词表复测：

```powershell
npm run spike:ime:export
npm run spike:ime:dialog200
npm run spike:ime:analyze
```

---

## 8. 产物路径

| 文件 |
|------|
| `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json` |
| `electron_node/electron-node/tests/fw-detector-dialog-200-quality-perf.json` |
| `electron_node/electron-node/tests/spike/spike-dialog200-results.json` |
| `electron_node/docs/pinyin-v1/spike-report-latest.md` |
| 本报告、`Pinyin_IME_Decoder_Spike_Development_Report_2026_06_03.md` |
