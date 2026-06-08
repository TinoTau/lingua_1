# Weak Domain Priority + Fuzzy Pinyin Recall 开发报告

**日期：** 2026-06-07  
**版本：** V1.2 P0  
**状态：** 已实现、单测通过、dialog_200 全量批测完成  
**对照方案：** [Weak Domain Priority + Fuzzy Pinyin Recall 开发方案补充文档（V1.2）](./Weak%20Domain%20Priority%20+%20Fuzzy%20Pinyin%20Recall%20开发方案补充文档（V1.2）.md)

---

## 1. 背景与目标

### 1.1 问题

在 `primaryDomain=general` 的 dialog_200 批测中，Recall 层仅查 base 桶（`domainIds=[]`），餐饮域词条（中杯、大杯、蓝莓马芬等）无法进入候选池。ASR 误识别如「钟贝少」「有蓝美马分」在 exact pinyin key 下 Recall TopK=0。

### 1.2 P0 目标

| 能力 | 说明 |
|------|------|
| Weak Domain Recall | general → base + 全部 enabledDomains weak（weight=0.2） |
| Fuzzy Pinyin Recall | plain 音节 trim / function_syllable_strip，≤4 variants |
| 互斥 | `weakDomainRecallEnabled=true` 时关闭 industry routing |
| 灰度 | flag 默认 false，运行时 config 开启 |

### 1.3 禁止范围（已遵守）

未修改 Proposal、LocalRawImeDiff、Normalizer、SpanSelector、ToneModule、KenLM、Apply；未实现 `lookupTonePinyinKey` / tone_key 索引。

---

## 2. 实现概要

### 2.1 数据流

```
recallSpanTopK (local-span-recall.ts)
  ├─ resolveWeakDomainRecallPlan → queryDomainIds
  ├─ isFuzzyPinyinRecallEnabled
  └─ recallSpanTopKV2
        ├─ buildFuzzyPinyinVariants (≤4)
        ├─ per variant: lookupBase + lookupDomain(termLength=variantLen)
        ├─ scoreHotword + fuzzyPenalty + weak domainBoost
        ├─ dedupe by hotword.id
        └─ sortRecallHitsByToneCompatibility (variant-sliced pattern)
```

### 2.2 新增模块

| 文件 | 职责 |
|------|------|
| `fuzzy-pinyin-key-builder.ts` | trim_head/tail/both、function_syllable_strip；`alignVariantWindowText` |
| `weak-domain-recall-resolver.ts` | general / restaurant strong+weak 计划 |

### 2.3 修改模块

| 文件 | 变更 |
|------|------|
| `recall-span-topk-v2.ts` | 多 variant 查桶、merge、diagnostics |
| `local-span-recall.ts` | 接入 weak plan + fuzzy flags |
| `domain-boost-calculator.ts` | `WEAK_DOMAIN_WEIGHT=0.2` |
| `candidate-score.ts` | `RecallCandidateKind` + `fuzzyPenalty` |
| `lexicon-fw-recall-config.ts` | flag 读取 + routing 互斥 |
| `recall-v2-diagnostics.ts` | weak/fuzzy 诊断字段 |
| `tone-recall-sort.ts` | per-hit `acousticTonePattern` |
| `node-config-types.ts` / `node-config-defaults.ts` | 两个 flag（默认 false） |

### 2.4 评分冻结（V1.2 §七）

```
candidateScore + domainBoost - fuzzyPenalty - editDistancePenalty
```

| Kind | fuzzyPenalty |
|------|--------------|
| exact_base / exact_domain_strong | 0 |
| exact_domain_weak | 0.02 |
| fuzzy_plain | 0.08 |
| fuzzy_plain_domain | 0.10 |

### 2.5 配置启用

批测前通过 `tests/patch-weak-domain-fuzzy-config.mjs` 写入 userData：

```json
"fwDetector": {
  "weakDomainRecallEnabled": true,
  "fuzzyPinyinRecallEnabled": true,
  "useIndustryRouting": false
}
```

路径：`%APPDATA%/lingua-electron-node/electron-node-config.json`

---

## 3. 单元测试

| 套件 | 覆盖 |
|------|------|
| `fuzzy-pinyin-key-builder.test.ts` | 钟贝少→zhong\|bei；有…→strip you |
| `weak-domain-recall-resolver.test.ts` | general / restaurant 计划 |
| `lexicon-fw-recall-config.test.ts` | weak 与 routing 互斥 |
| `domain-boost-calculator.test.ts` | WEAK_DOMAIN_WEIGHT |
| `candidate-score.test.ts` | fuzzyPenalty 冻结值 |
| `recall-span-topk-v2.test.ts` | runtime：钟贝少→中杯 |
| `freeze-contract.test.ts` | flag off 回归 |

命令：`npm run build:main` + `npm run test:fw-detector` → **146 passed**

---

## 4. P0 验收对照

| 项 | 状态 | 批测证据 |
|----|------|----------|
| contract 200/200 | ✅ | summary.pass=200 |
| general 时 domain_hits>0 | ✅ | 4 条 case 有 domain_hits；d001 合计 6 |
| 钟贝少→中杯（zhong\|bei） | ✅ | d001 span「钟贝」候选含「中杯」 |
| 有蓝美马分→蓝莓马芬 | ✅ | d001 span 候选含「蓝莓马芬」 |
| Recall Avg < 5ms | ✅ | recall_ms_avg=1.85ms |
| Recall P95 < 15ms | ✅ | recall_ms_p95=3ms |
| apply>0 / Final CER 下降 | ❌ | KenLM `pickedIsRaw=true`，瓶颈在 Apply 前 |
| 深便→顺便 | — | 非 P0 目标 |
| 少冰词库缺失 | — | Lexicon Coverage Gap（未标 Recall Failure） |

---

## 5. 已知限制与后续

1. **KenLM 句子级门控**：d001 句子 rerank `maxDelta≈0.00033 < minDeltaToReplace=0.03`，Recall 已产出「中杯」「蓝莓马芬」但 `applied=0`。
2. **d002 美食/大悲**：fuzzy variant 已生成，但该 span 未命中 domain/base 桶（需核对 span 切分与 variant 对齐）。
3. **d003 小背**：trim 变体未命中「小杯」（syllable 对齐或 span 边界问题）。
4. **domain_hits 覆盖偏低**：200 条中仅 4 条有 SQL domain_hits，因多数 span 在 exact key 下已由 base 命中或未触发 FW span。

---

## 6. 产物路径

| 产物 | 路径 |
|------|------|
| 批测原始 JSON | `electron_node/electron-node/tests/weak-domain-fuzzy-dialog200-batch-result.json` |
| 质量/性能分析 | `electron_node/electron-node/tests/experiments/weak-domain-fuzzy-dialog200-quality-perf.json` |
| 配置 patch 脚本 | `electron_node/electron-node/tests/patch-weak-domain-fuzzy-config.mjs` |
| 分析脚本 | `electron_node/electron-node/tests/experiments/_weak-domain-fuzzy-batch-analyze.mjs` |
| 测试报告 | [Weak_Domain_Fuzzy_Pinyin_Recall_Dialog200_Test_Report_2026_06_07.md](./Weak_Domain_Fuzzy_Pinyin_Recall_Dialog200_Test_Report_2026_06_07.md) |
