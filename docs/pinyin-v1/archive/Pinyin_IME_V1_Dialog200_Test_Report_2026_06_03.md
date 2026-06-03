# Dialog200 端到端与 Pinyin IME V1 — 测试报告

**日期**：2026-06-03  
**音频目录**：`D:\Programs\github\lingua_1\test wav\dialog_200`  
**墙钟预算**：15 分钟（实际 **905 s**，完成 **117/200** 条）  
**节点端**：`npm start`（`NODE_ENV=production`，test server **5020** 健康）

---

## 1. 执行摘要

| 维度 | 结果 |
|------|------|
| 节点管道批测 | **117** 条评估；**0** 契约通过 |
| Lexicon V3.1 Runtime | **0/117** `lexicon_runtime_ok`（ABI 127 vs 119） |
| FW Detector | **0** 触发 / **0** 应用 |
| ASR（87 条有文本） | 平均 CER **42.92%**；完全匹配 **9** |
| pinyin-ime-v1（117 条） | top1~top10 **0%**；IME P95 **2 ms** |
| 504 / 空识别 | **30** 条（`asr_service_id: unknown`） |
| 入主链建议 | **否** |

**阻塞**：`lexicon:rebuild-sqlite` 失败；`lexiconRecall` 仍为 disabled；`better-sqlite3` Electron ABI 不匹配。

---

## 2. 测试步骤

1. 清理进程  
2. `npm run build:main`  
3. `npm run spike:pinyin-ime-v1:export:all`  
4. `npm run lexicon:rebuild-sqlite`（**失败**）  
5. 后台 `npm start`，5020 `/health` OK  
6. `node tests/run-dialog200-timed-batch.mjs --max-minutes 15`  
7. `node tests/analyze-dialog200-quality-perf.mjs`  
8. `npm run spike:pinyin-ime-v1:dialog200` + `analyze`

---

## 3. 节点端 — 识别质量（ASR raw）

**有效样本**：87 条含 `faster-whisper-vad` 文本；30 条无 ASR 文本（多为 **HTTP 504**）。

| 指标 | raw_asr |
|------|---------|
| 平均 CER | **42.92%** |
| 中位 CER | **29.63%** |
| P95 CER | **100%**（含空识别拉高） |
| 完全匹配（归一化） | **9** / 117 |
| FW 改善 / 恶化 | **0 / 0** |

**最差 5 条（CER=1，hyp 为空）**：d081～d085（bank/restaurant/gym，多属 504 段）

**契约**

```json
{
  "evaluated": 117,
  "pass": 0,
  "fail": 117,
  "fw_triggered_count": 0,
  "lexicon_runtime_ok_count": 0,
  "text_changed_count": 0
}
```

**根因摘录（d001）**

```
lexicon_runtime_error: NODE_MODULE_VERSION 127 vs 119 (better-sqlite3)
lexicon_disabled_reason: feature_lexicon_recall_disabled
contract_failures: missing_fw_detector, lexicon_not_ok:error
```

---

## 4. 节点端 — 性能（87 条有 pipeline_ms）

| 指标 | P50 | P95 | 平均 | 最小 | 最大 |
|------|-----|-----|------|------|------|
| pipeline_ms | 5891 | 17475 | 8148 | 3945 | 35847 |
| asr_latency_ms | 4007 | 10902 | 4827 | 2618 | 22038 |
| audio_ms | 3720 | 4900 | 3537 | — | — |

| RTF | 值 |
|-----|-----|
| pipeline / audio | **2.30** |
| ASR / audio | **1.37** |

墙钟 **905 s**，约 **7.7 s/条**（含 504 等待）。

**ASR 服务分布**：`faster-whisper-vad` 87，`unknown` 30。

---

## 5. pinyin-ime-v1 离线 Spike（117 条）

**词典**：三层 merge（base 72193 + domain 26，target boost）  
**后端**：`dict_dp`  
**KenLM**：可用（`zh_char_3gram.trie.bin`）

| 子集 | n | top1 | top5 | top10 | refInDiff | kenlmWouldApply |
|------|---|------|------|-------|-----------|-----------------|
| all | 117 | 0% | 0% | 0% | 0% | 0% |
| detector_miss | 78 | 0% | 0% | 0% | 0% | 0% |
| lexicon_missing | 87 | 0% | 0% | 0% | 0% | 0% |

| Freeze Gate | 阈值 | 结果 |
|-------------|------|------|
| Detector Miss top5 | > 15% | **FAIL** (0%, n=78) |
| Recall Empty top3 | > 25% | N/A (n=0) |
| IME P95 | < 200 ms | **PASS** (2 ms) |

**失败分类**：`ok` 87（有 CJK 拼音流但 0 候选），`english_mixed` 30（无文本/504）。

**说明**：三层导出后短句可解码（如「今天讨论」），但 Dialog200 **整句 ASR 字面拼音** 与词典短语链难以对齐，故候选为空；与上一轮单文件 repair 表现一致，**非**未导出 base。

---

## 6. 测试结果抽样（10 条）

### 6.1 节点端 ASR（raw vs 参考）

| id | scenario | 参考（节选） | raw ASR（节选） | 备注 |
|----|----------|--------------|-----------------|------|
| d001 | cafe | 热拿铁，中杯，少糖…蓝莓马芬 | 热拿铁钟贝少糖…蓝美马分 | pipeline 10.5s；词库 error |
| d002 | cafe | 美式带走，大杯 | 美食带走大悲 | 同音误识 |
| d045 | lexicon_homophone | 后选生城，上线计划 | （本批未测到，见历史批测） | — |
| d007 | taxi | 中关村软件园，九点半 | 市富曲仲觀村…药师赌车 | 严重误识 |
| d010 | clinic | 头痛，血常规 | 醫生…歇常規 | 繁体+错字 |
| d081 | bank | 理财产品风险等级 | *(空)* | 504 |
| d082 | restaurant | 靠窗，不要香菜 | *(空)* | 504 |
| d020 | — | — | （9 条完全匹配之一） | CER≈0 |
| d114 | — | — | 有 ASR；lexicon error | 批测末期 |
| d117 | — | — | 截止时间最后一条 | — |

### 6.2 pinyin-ime-v1（同批 raw）

| id | candidateCount | top5 | pinyin 流（前 40 音节） | 说明 |
|----|----------------|------|-------------------------|------|
| d001 | 0 | ✗ | ni hao wo xiang dian yi bei re na tie zhong bei… | 整句无 beam 终点 |
| d002 | 0 | ✗ | ma fan bang wo zuo yi bei mei shi… | |
| d004 | 0 | ✗ | xiao chen ke hu fan kui… | |
| d010 | 0 | ✗ | yi sheng nin hao… | |
| d081 | 0 | ✗ | *(english_mixed)* | 504 无 raw |
| d082 | 0 | ✗ | *(english_mixed)* | |

---

## 7. 指标分栏（本轮要求）

| 指标层 | 数据源 | 本轮结论 |
|--------|--------|----------|
| ASR raw quality | `fw-detector-dialog-200-quality-perf.json` | CER 高；30 条空识别 |
| FW Detector | batch `fw_*` | 未执行（missing_fw_detector） |
| Lexicon Runtime | `lexicon_runtime_status` | 全部 error |
| pinyin-ime-v1 | `pinyin-ime-v1-report-summary.json` | 0% topK；延迟达标 |

---

## 8. 复测前修复建议

```powershell
cd electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run lexicon:rebuild-sqlite   # 必须成功（Electron MODULE 119）
# 确认 %APPDATA%\lingua-electron-node\electron-node-config.json
#   lexiconRecall.enabled = true
.\..\..\scripts\start_electron_node.ps1
node tests/run-dialog200-timed-batch.mjs --max-minutes 15 "D:\Programs\github\lingua_1\test wav\dialog_200"
npm run spike:pinyin-ime-v1:export:all
npm run spike:pinyin-ime-v1:dialog200
npm run spike:pinyin-ime-v1:analyze
```

---

## 9. 产物路径

| 文件 |
|------|
| `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json` |
| `electron_node/electron-node/tests/fw-detector-dialog-200-quality-perf.json` |
| `electron_node/electron-node/tests/spike/pinyin-ime-v1-dialog200-results.json` |
| `electron_node/electron-node/tests/spike/pinyin-ime-v1-report-summary.json` |
| `docs/pinyin-v1/pinyin-ime-v1-report-latest.md` |
| 本报告、`Pinyin_IME_V1_Development_Report_2026_06_03.md` |
