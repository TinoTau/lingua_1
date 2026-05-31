# Domain Recall 只读验证报告

版本：V1.0  
日期：2026-05-31  
**范围：** `profile.primaryDomain=restaurant` 时，`domain_lexicon` 是否参与 Recall  
**约束：** 只读验证；未修改产品代码

原始数据：

- `electron_node/electron-node/tests/domain_recall_test.json`
- `electron_node/electron-node/tests/domain-recall-verify-result.json`
- 验证脚本：`electron_node/electron-node/tests/run-domain-recall-verify.mjs`

---

## 1. 执行摘要

| 项 | 结论 |
|----|------|
| **最终判定** | **A — `activeDomain=restaurant` 后 `domain_hits > 0`，Domain Recall 机制正常** |
| SQLite `domain_lexicon` | **25 行**（restaurant） |
| Runtime 加载 | **domain=25**（与 SQLite 一致） |
| control（general profile） | **`domain_hits = 0`**（40/40 探针） |
| test（restaurant profile） | **`domain_hits` 合计 106**；**38/40** 探针 `domain_hits > 0` |
| 对照 | 与上一轮 `base_only` + `domain_hits=0` 差异来自 **`domainIds` 是否含 `restaurant`**，非 SQLite 缺失 |

**验证方法：** 复现生产代码中的 tier SQL 路径（`resolveDomainIdsForRecall` + `lookupDomainByPinyinKey` + `collectTierCandidates`），对 `domain_recall_test.json` 中 **15 条句子 / 40 个探针 span** 执行对照实验。

**说明：** 本轮为 **Recall tier 验证**（不跑 dialog_200、不依赖 ASR metadata）。句级 apply / CER improve 需 Metadata Gate 产出 span，未在本轮统计。

---

## 2. 测试配置

| 项 | control | test |
|----|---------|------|
| `profile.primaryDomain` | **general** | **restaurant** |
| `domainIds`（Recall） | **`[]`** | **`['restaurant']`** |
| Intent | 未启用（与 P4 批测一致） | 同左 |
| P4 | `useSentenceLevelRerank=true` | 不变（本验证未进入句级 rerank） |
| Span Gate | `fw_metadata_gate` | 不变 |
| KenLM Span Gate | false | 不变 |
| Bundle | `node_runtime/lexicon/v2_shadow` | schema **v2**，domain **25** |
| perSpanLimit | 8 | SQL limit 对齐 P4 |

**方案：** **A（优先）** — 通过 `profile.primaryDomain=restaurant` 解析 `domainIds`（`domain-recall-merge.ts`），无需开启 Intent。

---

## 3. Runtime Domain 状态

| 来源 | domain_lexicon |
|------|----------------|
| SQLite 直查 | **25** |
| `manifest_v2.json` | rowCount **25**，`byDomain.restaurant` canonical **9** |
| 节点启动日志 | `lexiconRuntimeV2.tables.domain` **25** |

---

## 4. Recall 命中统计

| 指标 | general | restaurant |
|------|---------|------------|
| 探针 span 数 | 40 | 40 |
| **domain_hits 合计** | **0** | **106** |
| **base_hits 合计** | （有 base 桶命中） | （与 domain 并存） |
| `domain_hits > 0` 的探针 | **0** | **38** |
| `domainCandidates.length > 0` | **0** | **38** |
| `active_domain` | **base_only** | **restaurant** |

**2 条探针无 domain 命中（预期）：** `浓缩`、`卡布奇诺` — 不在 `domain_patch_zh_v2` 词表中。

---

## 5. 样本追踪（节选）

| case | rawText | span | activeDomain | domainIds | domain_hits | domainCandidates（restaurant） |
|------|---------|------|--------------|-----------|-------------|--------------------------------|
| t01 | 我要一杯中杯美式 | 钟贝 | restaurant | [restaurant] | **4** | 终杯、钟贝、忠贝、**中杯**（alias+canonical） |
| t01 | 我要一杯中杯美式 | 没事 | restaurant | [restaurant] | **3** | 没事、美是、**美式** |
| t02 | 我要一个大杯拿铁 | 大背 | restaurant | [restaurant] | **3** | 达杯、大悲、**大杯** |
| t04 | 给我一杯冰拿铁 | 那铁 | restaurant | [restaurant] | **3** | 拿帖、那铁、**拿铁** |
| t05 | 我要一个蓝莓马芬 | 蓝莓麻烦 | restaurant | [restaurant] | **1** | **蓝莓马芬**（alias） |
| t06 | 来一个摩卡 | 磨卡 | restaurant | [restaurant] | **2** | 磨卡、**摩卡** |
| t07 | 我要双份浓缩 | 浓缩 | restaurant | [restaurant] | **0** | （无 patch 行） |

完整 40 行见 `domain-recall-verify-result.json` → `rows[]`。

---

## 6. Domain Candidate 示例

### 6.1 钟贝 → domain_lexicon

```text
span: 钟贝
pinyin_key: zhong|bei

domain SQL（domain_id=restaurant）:
  终杯 (alias)
  钟贝 (alias)
  忠贝 (alias)
  中杯 (canonical)

source=domain, domain=restaurant
domain_hits=4
```

### 6.2 没事 → 美式

```text
span: 没事
pinyin_key: mei|shi

domain SQL:
  没事 (alias)
  美是 (alias)
  美式 (canonical)

domain_hits=3
```

### 6.3 Canonical 直查

| word | pinyin_key | domain SQL 行数 | 含 canonical |
|------|------------|-----------------|--------------|
| 中杯 | zhong\|bei | 4 | ✅ |
| 大杯 | da\|bei | 3 | ✅ |
| 美式 | mei\|shi | 3 | ✅ |
| 拿铁 | na\|tie | 3 | ✅ |
| 摩卡 | mo\|ka | 2 | ✅ |
| 蓝莓马芬 | lan\|mei\|ma\|fen | 2 | ✅ |

---

## 7. Apply 统计

| 指标 | 值 | 说明 |
|------|-----|------|
| apply | **N/A** | 本验证仅 Recall tier；无 ASR metadata → Metadata Gate 不产生 span |
| improve | **N/A** | 未跑参考文本 CER |
| degrade | **N/A** | 同左 |

P4 dialog_200 在 **general profile** 下仍为 `domain_hits=0`；与本验证 **restaurant profile** 结论不矛盾。

---

## 8. 最终结论

### 8.1 选项 **A** ✅

当 `profile.primaryDomain=restaurant` → `domainIds=['restaurant']` 时：

- **`domain_hits > 0`**（106 次 SQL 命中累计）
- **domain_lexicon 真正参与 Recall SQL**

### 8.2 上一轮 `domain_hits=0` 的原因（已确认）

| 因素 | 证据 |
|------|------|
| SQLite 空 | ❌ 已修复，**25 行** |
| Recall 故障 | ❌ restaurant profile 下 **38/40 探针命中** |
| **general profile** | ✅ `resolveDomainIdsForRecall` 对 general 返回 **`[]`** |
| **Intent 关** | 与 general 批测一致；**restaurant 可直接设 profile，不必 Intent** |

### 8.3 代码位置（生产路径）

| 步骤 | 文件 | 行为 |
|------|------|------|
| domainIds 解析 | `domain-recall-merge.ts` L16-27 | general → `[]`；restaurant → `['restaurant']` |
| domain SQL | `lexicon-runtime-v2.ts` L251-265 | `WHERE domain_id=? AND pinyin_key=?` |
| tier 收集 | `recall-span-topk-v2.ts` L158-164 | `for (domainId of domainIds) domainHits.push(...)` |
| diagnostics | `recall-span-topk-v2.ts` L215-231 | `domain_hits`, `active_domain` |

---

## 9. Target List

| # | Target | 结果 |
|---|--------|------|
| T1 | SQLite domain_lexicon | ✅ 25 |
| T2 | Runtime domain count | ✅ 25 |
| T3 | general → domain_hits=0 | ✅ |
| T4 | restaurant → domain_hits>0 | ✅ 106 |
| T5 | 中杯/大杯/美式/拿铁/摩卡/蓝莓马芬 SQL | ✅ 均命中 |
| T6 | 同音 alias（钟贝/没事/那铁） | ✅ 命中 domain 桶 |
| T7 | domain_recall_test.json | ✅ 15 cases |
| T8 | 验证产物 JSON | ✅ |

---

## 10. Check List

| # | 检查项 | 结果 |
|---|--------|------|
| C1 | 未修改产品代码 | ✅ |
| C2 | 使用 restaurant primaryDomain（方案 A） | ✅ |
| C3 | 对照 general profile | ✅ domain_hits=0 |
| C4 | 40 span 探针 | ✅ |
| C5 | focus 词 SQL | ✅ 6/6 有 domain 行 |
| C6 | 生产 SQL 与验证 SQL 一致 | ✅ 同表同 WHERE |
| C7 | 结论 A/B 判定 | ✅ **A** |

---

**验证完成。**
