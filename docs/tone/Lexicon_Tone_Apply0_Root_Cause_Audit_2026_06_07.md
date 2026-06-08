# Lexicon Tone 接通后 apply=0 根因审计（只读）

**日期：** 2026-06-07  
**数据源：** `tests/lexicon-tone-dialog200-batch-result.json`（200/200 全量）  
**词库：** `node_runtime/lexicon/v3`（tone 100% 已补齐）  
**约束：** 只读；无代码/阈值/架构变更建议

**关联文档：** [文档索引](./Lexicon_Tone_2026_06_07_文档索引.md) · [开发报告](./Lexicon_Tone_Seed_Rebuild_Dev_Report_2026_06_07.md) · [批测报告](./Lexicon_Tone_Dialog200_Test_Report_2026_06_07.md)

---

## 目录

1. [执行摘要](#执行摘要)
2. [一、FW 触发条件](#一fw-触发条件餐饮样本--全量)
3. [二、Span 生成链路](#二span-生成链路--餐饮错词是否进入-span-列表)
4. [三、餐饮 domain / profile](#三餐饮-domain--profile-注入)
5. [四、Recall 逐案 trace](#四recall-候选逐案-trace-d001--d002--d003)
6. [五、tone-compatible 未转 apply](#五11-次-tone-compatible-未转-apply)
7. [六、KenLM / Apply gate](#六kenlm--apply-gate)
8. [七、测试配置审计](#七测试配置审计)
9. [八、最终结论](#八最终结论)
10. [附录：数据文件](#附录数据文件)

---

## 执行摘要

`Tone compatible recall > 0` 但 `Apply = 0` 的断点 **不在 ToneModule 或 tone_pinyin_key 物化**，而在 **两段更早/更晚的门禁**：

| 阶段 | 影响条数 | 断点 |
|------|----------|------|
| **A. Span 发现（Pinyin IME v2 HintGate）** | **134/200** | 餐饮错词未成为 FW span → `reason=no_spans` |
| **B. KenLM 句级门控（minDeltaToReplace=0.03）** | **66/66 已触发** | 所有修复句 KenLM delta < 0.03 → `pickedIsRaw=true` → `approved=[]` |

Tone 仅影响 **已进入 Recall 的 span** 内候选排序；**不能**把未入 span 的错词拉进链路，也 **不能**越过 KenLM 替换门控。

---

## 一、FW 触发条件（餐饮样本 + 全量）

### 1.1 餐饮三案

| id | rawAsr（节选） | expected（节选） | fw_triggered | reason | span_count | candidate_count | apply_count |
|----|----------------|------------------|--------------|--------|------------|-----------------|-------------|
| d001 | …热拿铁**钟贝**少糖…**蓝美马分**… | …**中杯**…**蓝莓马芬**… | **false** | `no_spans` | 0 | 0 | 0 |
| d002 | …**美食**带走**大悲**… | …**美式**…**大杯**… | **false** | `no_spans` | 0 | 0 | 0 |
| d003 | …**少病**吗?我赶时间**小背** | …**少冰**…**小杯** | **true** | — | 2 | 6 | 0 |

### 1.2 d001 / d002 未触发原因（代码 + 诊断一致）

**不是** detector 未加载、**不是** lexicon 不可用、**不是** KenLM veto（未到达该阶段）。

| 案例 | IME 诊断 | 根因 |
|------|----------|------|
| d001 | `diffSpanCount=0`, `normalizerDroppedCount=2`, `skippedReason=no_approved_spans` | Pinyin IME v2 **未产生可审批 diff span**；`钟贝`/`蓝美马分` 未进入 HintGate |
| d002 | `diffSpanCount=15`, `approvedSpanCount=0`, `gateDroppedNoNeighbor=2`, `skippedReason=no_approved_spans` | 虽有 diff，但 **lexiconNearNeighbor 探针失败** 或 support 不足，**0 个 span 获批** |

Span 发现 SSOT：`resolve-pinyin-ime-v2-spans.ts` → `runPinyinImeV2HintGate()`。  
HintGate 要求（`pinyin-ime-v2-hint-gate.ts`）：

1. normalizer 通过（非单字、音节数 2–5）
2. `supportCount >= minSupportCount`
3. **`lexiconNearNeighbor(rawSpan)` 为 true** — 对 raw span 做 `recallSpanTopK(..., topK=1)`，有 hit 才算邻居

`lexiconNearNeighbor` 实现（`resolve-pinyin-ime-v2-spans.ts:35-43`）与正式 Recall 相同 profile/domain 解析。

### 1.3 全量统计

| 指标 | 值 |
|------|-----|
| 总案例 | 200 |
| `fw_triggered=true` | 66 |
| `reason=no_spans` | 134 |
| `apply_count > 0` | **0** |
| `primaryDomain=general` | **200/200** |
| IME `no_approved_spans` | 105 |
| `pickedIsRaw=true`（已触发子集） | **66/66** |

---

## 二、Span 生成链路 — 餐饮错词是否进入 span 列表

| ASR 错词 | 期望词 | 是否进入 span | 拦截 gate |
|----------|--------|---------------|-----------|
| 钟贝 | 中杯 | **否** | d001: IME `diffSpanCount=0`，无 span 提议 |
| 大悲 | 大杯 | **否** | d002: HintGate `no_approved_spans`（含 `gateDroppedNoNeighbor=2`） |
| 美食 | 美式 | **否** | 同上（未获批 span） |
| 少病 | 少冰 | **是**（span `少病`） | d003 已触发；但 Recall 未指向少冰 |
| 小背 | 小杯 | **否** | d003 未对 `小背` 建 span（IME 选了 `赶时`@16–18） |
| 蓝美马分 | 蓝莓马芬 | **否** | d001: 无 diff span |

### 2.1 链路说明（冻结架构）

```
ASR rawText
  → Pinyin IME v2 proposal（topK 解码 + diff/instability/boundary）
  → HintGate（neighbor/support/normalizer）
  → FwSpanDiagnostics[]
  → recallSpanTopK（仅对已批 span）
  → buildSentenceCandidates + KenLM rerank
  → mapSentenceToApprovedReplacements
  → applyFwSpanReplacements
```

**关键事实：** FW **不会**扫描 raw ASR 全文按词库 homophone 建 span；span 必须由 **IME v2 hint** 产出。Tone 在第三步之后才参与排序。

### 2.2 各 gate 对照

| 疑点 | 结论 |
|------|------|
| 词库候选未注入 | 词库已加载（72217 rows）；但 **无 span 则 Recall 不执行** |
| pinyin key 不匹配 | `钟贝`/`中杯` 均为 `zhong\|bei`；问题不在 key，在 **无 span** |
| CJK 粗边界失败 | d001 边界分数 avg=1.0；主因是 **diffSpanCount=0** |
| span 长度限制 | `少病`(2字)、`赶时`(2字) 合法；`蓝美马分`(4字) 未进 normalizer 流程 |
| profile 未启用 | **200/200 `primaryDomain=general`**，见第三节 |

---

## 三、餐饮 domain / profile 注入

### 3.1 词库 DB 状态（`lexicon.sqlite`）

| word | 在 DB | 表 | domain_id | repair_target | enabled | pinyin_key | tone_pinyin_key |
|------|-------|-----|-----------|---------------|---------|------------|-----------------|
| 中杯 | 是 | domain_lexicon | restaurant | 1 | 1 | zhong\|bei | zhong1\|bei1 |
| 大杯 | 是 | domain_lexicon | restaurant | 1 | 1 | da\|bei | da4\|bei1 |
| 小杯 | 是 | domain_lexicon | restaurant | 1 | 1 | xiao\|bei | xiao3\|bei1 |
| 拿铁 | 是 | domain_lexicon | restaurant | 1 | 1 | na\|tie | na2\|tie3 |
| 美式 | 是 | domain_lexicon + base_lexicon | restaurant / 四域 | 1 | 1 | mei\|shi | mei3\|shi4 |
| 摩卡 | 是 | domain_lexicon | restaurant | 1 | 1 | mo\|ka | mo2\|ka3 |
| 少冰 | **否** | — | — | — | — | — | — |
| 蓝莓马芬 | 是 | domain_lexicon | restaurant | 1 | 1 | lan\|mei\|ma\|fen | lan2\|mei2\|ma3\|fen1 |

别名：`钟贝`/`大悲`/`美食`/`少病`/`小背` 均 **不在 DB**（预期由 span+recall 处理，但 span 未生成）。

### 3.2 Pipeline 请求与 profile

**实际 payload**（`run-dialog200-timed-batch.mjs:68-76`）：

```json
{
  "wavPath": "...",
  "srcLang": "zh",
  "tgtLang": "en",
  "use_lexicon": true,
  "is_manual_cut": true,
  "session_id": "v31-d200-{id}-{ts}",
  "lexicon_v2_intent_enabled": false
}
```

| 检查项 | 结果 |
|--------|------|
| 携带 cafe/restaurant profile？ | **否** — 无 `session-migration` 预导入 |
| runtime `activeLexiconProfile.primaryDomain` | **200/200 = `general`** |
| `domain_lexicon` 是否被查询？ | **否** — `recallV2Diagnostics.active_domain = "base_only"`，`domain_hits = 0` |
| 查询 domain_id | `resolveDomainIdsForRecall()` 在 `primaryDomain=general` 时返回 **`[]`**（`domain-recall-merge.ts:17-19`） |
| fallback 到 base？ | **是** — 仅 `base_lexicon` + 可选 idiom |

对比：`run-p4-freeze-batch.js` 支持 `--profile restaurant` 并通过 `POST /session-migration/import` 注入 `primaryDomain: restaurant`。**本次批测未使用该路径。**

### 3.3 对餐饮 case 的影响

即使 span 生成成功，`中杯`/`大杯`/`小杯` 仅在 **domain_lexicon**；在 `general` profile 下 **domain recall 路径关闭**，`钟贝→中杯` 无法从 domain 层召回（只能靠 base 同音桶，而 `中杯` 不在 base）。

`美式` 在 base 有 `mei\|shi` 条目，但 d002 在 span 阶段已失败。

---

## 四、Recall 候选逐案 trace（d001 / d002 / d003）

### d001 — 未到达 Recall

| span | spanPinyinKey | acousticTone | recall candidates | toneCompatible | 备注 |
|------|---------------|--------------|-------------------|----------------|------|
| — | — | — | — | — | `fw_triggered=false`，无 span |

**钟贝→中杯 / 蓝美马分→蓝莓马芬：** 未召回 — **span 未生成**（IME diff=0）。

### d002 — 未到达 Recall

| span | 备注 |
|------|------|
| — | HintGate `approvedSpanCount=0` |

**美食→美式 / 大悲→大杯：** 未召回 — **span 未生成**（neighbor gate）。

### d003 — 有 Recall，但候选错误

| span | spanPinyinKey | acousticTonePattern | Top recall 候选 | 期望 | toneCompatible |
|------|---------------|---------------------|-----------------|------|--------------|
| 少病 @11–13 | shao\|bing | `[3,3]` | 烧饼、哨兵 | 少冰 | **0**（case 级 `recallToneCompatibleCount=0`） |
| 赶时 @16–18 | gan\|shi | 未完整映射 | 干事、干尸、干湿、矸石 | — | 0 |

**少病→少冰：** `少冰` **不在词库**；`shao\|bing` 桶内 base 候选为 **烧饼/哨兵**（同音不同调语义错误），tone 排序无法产生少冰。

**小背→小杯：** span **未建立**（IME 选中 `赶时` 片段）；小杯在 domain 表但无查询。

`recallV2Diagnostics`（d003）：

- span1: `base_hits=2, domain_hits=0, active_domain=base_only`
- span2: `base_hits=6, domain_hits=0, active_domain=base_only`

---

## 五、11 次 tone-compatible 未转 apply

**案例 ID：** d017, d028, d036, d057, d062, d064, d107, d126, d154, d171, d197（各 `recallToneCompatibleCount=1`）

### 5.1 典型样例 d017

- **Spans：** `一家`（候选：意甲、溢价、**医家**、衣架）、`一起`（候选：义气、**一齐**、仪器、一期）
- **acousticTonePattern：** `[4,4]`（span `一起`）
- **tone-compatible：** 约 1 个候选/span 调号与声学一致（如 **义气** yi4 qi4）
- **sentenceRerank：** `pickedIsRaw=true`, `maxDelta=-0.0015`, `minDeltaToReplace=0.03`
- **apply：** 0 — KenLM 判定修复句 **劣于** raw

### 5.2 汇总表（11 案共性）

| id | span（例） | compatible 候选类型 | builderIncluded | kenlmSelected | applyAllowed | vetoReason |
|----|------------|---------------------|-----------------|---------------|--------------|------------|
| d017 | 一起 | 同音不同字（义气等） | 是（组合句进 rerank） | **否** | 否 | `maxDelta < minDeltaToReplace(0.03)` → `pickedIsRaw` |
| d028~d197 | （各案同构） | 同音桶内调号匹配 | 是 | **否** | 否 | 同上 |

**链路事实**（`fw-sentence-rerank-pipeline.ts:179-182`）：

```typescript
const approved = rerank.pickedIsRaw || !rerank.picked
  ? []
  : mapSentenceToApprovedReplacements(...);
```

`rerank-fw-sentences.ts:69`：`bestDelta < minDeltaToReplace` → `pickedIsRaw=true`。

**全批最高正 delta：** ≈ **0.0069**（仍 < 0.03）。**无任何案例** KenLM 批准替换。

Tone-compatible 仅改变候选 **排序**，不改变 KenLM 基准对比结果；且兼容候选多为 **同音异字** 而非语义正确词。

---

## 六、KenLM / Apply gate

| 检查项 | 结论 |
|--------|------|
| builder 丢弃 candidate？ | 否 — `candidateSentenceCount` > 0，`combinationCount` 8–16 |
| candidate 改变句子？ | 是 — `replacementCount=2` 等 |
| KenLM 选择修复句？ | **从未** — 66/66 `pickedIsRaw=true` |
| apply 高置信门控？ | `minDeltaToReplace=0.03`（configSnapshot 冻结值） |
| final same as raw 保护？ | `pickedIsRaw` 时 `approved=[]`，`applyFwSpanReplacements` 不执行 |
| domain apply 过滤？ | 未到达 apply；`mapSentenceToApprovedReplacements` 仅检查 `repairTarget` |

**d003 KenLM top：** `…烧饼吗?我干事间小背` delta ≈ **+4e-6**，远低于 0.03。

---

## 七、测试配置审计

| 配置项 | dialog_200 批测实际值 | 说明 |
|--------|----------------------|------|
| lexicon profile | **`general`（默认）** | 无 session-migration |
| FW repair | **enabled**（`fw_detector.enabled=true`） |
| domain lexicon recall | **未启用**（general → `domainIds=[]`） |
| apply | **逻辑启用**，但 KenLM 门控阻止 |
| `lexicon_v2_intent_enabled` | **false** |
| ToneModule | **运行**（200/200 `toneEnabled=true`） |

**与 freeze 批测差异：** `run-p4-freeze-batch.js` 在 `--profile restaurant` 时会先 `POST /session-migration/import`；`run-dialog200-timed-batch.mjs` **无此步骤**。

**不存在**「只跑 pipeline 关闭 FW」的配置错误 — FW 已运行，断在 span + KenLM。

---

## 八、最终结论

### 8.1 分项回答

| # | 问题 | 结论 |
|---|------|------|
| 1 | ToneModule 是否正确进入 Recall？ | **是**（对已批 span）；45 案有 `acousticTonePattern`；排序已执行 |
| 2 | 词库候选是否正确召回？ | **部分** — base 同音桶可召回，但 **餐饮 domain 词在 general profile 下不可达**；且多数错词 **无 span** |
| 3 | 餐饮 domain 是否真实参与？ | **否** — `domain_hits=0`，`active_domain=base_only`，200/200 profile=general |
| 4 | span 为何未覆盖关键错词？ | **IME v2 HintGate 未批准**（134 案）；非 Tone/词库问题 |
| 5 | 11 次 tone-compatible 为何未 apply？ | 候选仅 **调号重排**；KenLM **全部** `pickedIsRaw`（delta < 0.03） |
| 6 | apply=0 直接原因 | **(1) 67% 案例无 span；(2) 33% 有 span 但 KenLM 句级门控拒绝全部替换** |
| 7 | 最小修复范围（定位，非本审计实施） | ① 餐饮批测注入 `restaurant` profile（与 freeze 脚本对齐）；② 审查 IME neighbor gate 对 `钟贝`/`大悲` 等；③ 核查 `minDeltaToReplace=0.03` 与当前 KenLM 标度；④ 补词 `少冰` |

### 8.2 断点示意图

```
ToneModule ✅ → acousticTonePattern ✅
       ↓
Pinyin IME v2 Span 发现 ❌ (134/200)  ← 餐饮主断点
       ↓
Recall + tone sort △ (66/200 有 span；domain 未参与)
       ↓
KenLM minDelta=0.03 ❌ (66/66 pickedIsRaw)  ← apply 主断点
       ↓
Apply = 0
```

### 8.3 边界声明

本审计 **不** 建议修改 ToneModule、词库调号或新增打分系统。  
`tone_pinyin_key` 补齐已生效；apply=0 是 **span 发现策略** 与 **测试 profile** 及 **KenLM 替换门控** 的叠加结果，而非 Tone 字段未接通。

---

## 附录：数据文件

- `electron_node/electron-node/tests/lexicon-tone-dialog200-batch-result.json`
- `electron_node/electron-node/tests/experiments/lexicon-tone-dialog200-quality-perf.json`
- `electron_node/electron-node/tests/experiments/lexicon-tone-apply0-audit-data.json`
