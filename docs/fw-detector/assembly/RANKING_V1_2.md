# Assembly Ranking — 冻结合约 V1.2

**状态：** FROZEN（2026-06-25）  
**代码：** `span-assembly-v4/` · `lexicon/candidate-score.ts` · `lexicon-v2/recall-span-topk*.ts`  
**主链：** [FROZEN_V1_2.md](./FROZEN_V1_2.md)

---

## 1. 流水线（职责分离）

```text
voteUtteranceDomainFromPool
  → rankDomainCandidatesPerSpan
  → filterDomainCandidatesPerSpan
  → applyToneAssemblyGuard
  → selectPerSpanCandidates
  → assembleDomainAwareSpanSets
```

| 阶段 | 职责 | 禁止 |
|------|------|------|
| **rank** | 统一评分排序，输出 `RankedSpanCandidateSet` | 直接分桶 |
| **filter** | sameDomain / base / fallback 三桶 | 改分数 |
| **toneGuard** | per-span 阻断 tone 错配（如烧饼） | 句级决策 |
| **select** | `sameDomain > base > fallback > canonical` | 跨 span |

---

## 2. Recall 评分（全路径一套）

**文件（须同步）：**

- `lexicon/candidate-score.ts`
- `lexicon-v2/recall-span-topk-v3.ts` · `recall-span-topk-v2.ts`
- `lexicon/pinyin-topk-lookup.ts`
- `fw-detector/tone-recall-sort.ts`

**冻结：**

- `domainBoost = 0`（Recall 主分不加域加权）
- 主分：`prior + phonetic`（**不含** `editDistancePenalty`）
- ED **仅** tie-break：`score desc` → `editDistance asc`（同 `pinyin_key`）
- `fuzzy_plain` **不参与** ED tie-break

---

## 3. Graph Source 分桶

| recallSource | 桶 |
|--------------|-----|
| `base_term` | `baseCandidates` |
| `domain_term` | `sameDomainCandidates`（domain 匹配 vote） |
| 其他 | `fallbackCandidates` |

`selectedBucket` 须含 `canonical` 字段供 diagnostics。

---

## 4. Tone Guard

- per-span：`base` 候选 + tone mismatch → block
- 典型：少冰 vs 烧饼（coffee 族 ASR 错字）
- metrics：`toneGuardBlockedCount`

---

## 5. Diagnostics（H3）

新增/同步字段须同时更新：

- `v4-types.ts` · `types.ts` · `fw-detector-v4-path.ts`
- `v4-diagnostics-mappers.ts` · `v4-diagnostics-trace.ts`

**语义：** `assemblySelectionTraces` = **selected**（Assembly 层）；≠ `span.applied`（Writeback）。见 [diagnostics/FROZEN.md](../diagnostics/FROZEN.md)。

---

## 6. 回归门禁

| GATE | 断言 |
|------|------|
| GATE-RANK-01 | base_term → base 桶 |
| GATE-RANK-02 | sameDomain 优先 select |
| GATE-RANK-03 | ED 不进主分 |
| GATE-RANK-04 | Tone Guard 阻断烧饼（单元） |

**语义 manifest：** `tests/fw-ranking-semantics-frozen.json`  
**运行：** `node tests/run-fw-ranking-semantics-test.mjs`

| case | 预期 |
|------|------|
| d003 | final 含少冰 · 禁烧饼 |
| d048/d138 | Assembly 少冰 · 禁烧饼 · 句级 apply 视 KenLM Δ |

---

## 7. 禁止项

- 恢复 Recall `domainBoost` 主分加权
- rank 与 filter 合并为单步
- 全局 ED 排序
- 修改 KenLM raw_log_delta / Apply Gate 3.0 作为 Ranking 修复手段

---

## 8. 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="assemble-domain-aware|ranking-repair|freeze-contract"
node tests/run-fw-ranking-semantics-test.mjs
```
