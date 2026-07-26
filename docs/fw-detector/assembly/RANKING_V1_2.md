# Assembly Ranking — 冻结合约 V1.2

**状态：** FROZEN（2026-06-25 · Tone V2 Phase 1 CLOSED 2026-06-29 同步）  
**代码：** `span-assembly-v4/` · `lexicon/candidate-score.ts` · `lexicon-v2/recall-span-topk*.ts`  
**主链：** [FROZEN_V1_2.md](./FROZEN_V1_2.md)  
**Tone SSOT：** [../../tone-v2/TONE_V2_CONTRACT_FREEZE.md](../../tone-v2/TONE_V2_CONTRACT_FREEZE.md)

---

## 1. 流水线（职责分离）

```text
voteUtteranceDomainFromPool
  → buildFineSpanCandidatePool
  → filterDomainCandidatesPerSpan
  → selectPerSpanCandidates
  → assembleDomainAwareSpanSets
```

| 阶段 | 职责 | 禁止 |
|------|------|------|
| **vote** | utterance 域投票 | 改 Recall 分数 |
| **filter** | sameDomain / base / fallback 三桶 | 改分数 · tone hard filter |
| **select** | `sameDomain > base > fallback > canonical` | 跨 span · **Tone Guard** |

**Tone Effective Location = Recall / Ranking。** Assembly **无** Tone Decision（无 `applyToneAssemblyGuard`）。

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
- Tone：`computeToneScoreResult` → `tonePenalty`（×0.8 mismatch），**非** Assembly 阻断

---

## 3. Graph Source 分桶

| recallSource / graphSource | 桶 |
|----------------------------|-----|
| `base_term` | `baseCandidates` |
| `domain_term`（domain 匹配 vote） | `sameDomainCandidates` |
| 其他 | `fallbackCandidates` |

`selectedBucket` 须含 `canonical` 字段供 diagnostics。

---

## 4. Diagnostics（H3）

新增/同步字段须同时更新：

- `v4-types.ts` · `types.ts` · `fw-detector-v4-path.ts`
- `v4-diagnostics-mappers.ts` · `v4-diagnostics-trace.ts`

**语义：** `assemblySelectionTraces` = **selected**（Assembly 层）；≠ `span.applied`（Writeback）。见 [diagnostics/FROZEN.md](../diagnostics/FROZEN.md)。

---

## 5. 回归门禁

| GATE | 断言 |
|------|------|
| GATE-RANK-01 | base_term → base 桶 |
| GATE-RANK-02 | sameDomain 优先 select（`selectPerSpanCandidates`） |
| GATE-RANK-03 | ED 不进主分 |
| GATE-RANK-04 | **无** Assembly Tone Guard · orchestrator 无引用 · 无 `toneGuardBlockedCount` |

**语义 manifest：** `tests/fw-ranking-semantics-frozen.json`  
**运行：** `node tests/run-fw-ranking-semantics-test.mjs`

| case | 预期 |
|------|------|
| d003 | final 含少冰 · 禁烧饼（via Recall/Ranking，非 Assembly Guard） |
| d048/d138 | Assembly 少冰 · 句级 apply 视 KenLM Δ |

---

## 6. 禁止项

- 恢复 Recall `domainBoost` 主分加权
- 恢复 Assembly Tone Guard / `toneGuardBlockedCount`
- rank 与 filter 合并为单步
- 全局 ED 排序
- 修改 KenLM raw_log_delta / Apply Gate 3.0 作为 Ranking 修复手段

---

## 7. 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="assemble-domain-aware|freeze-contract"
node tests/run-fw-ranking-semantics-test.mjs
```
