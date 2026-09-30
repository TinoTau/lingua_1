# Assembly Frozen Design Reconstruction

**Audit:** ASSEMBLY_CANDIDATE_TO_SENTENCE_MATERIALIZATION_CONFORMANCE_AUDIT  
**Date:** 2026-08-18  
**Sources:** FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05, assembly_enumeration_contract.md, SameDomain Restoration Report 2026-07-30, Mainchain Audit 2026-07-29, freeze-contract.test.ts

---

## 1. Critical Design Question (A vs B)

**Frozen authoritative answer: B (with explicit pipeline gates)**

> 不是「所有 union FineSpan candidates 直接形成 sentence paths」；  
> 而是：**Path-local retained-domain bucket 内的 eligible + base candidates**，经 per-span budget 后，才进入 Interval DFS 组句。

Evidence:

| Source | Quote / Fact |
|--------|----------------|
| `01_Architecture.md` (Freeze 2026-08-05) | `Domain Vote → SameDomain Bucket → Assembly DFS → CrossPath ≤16 → KenLM` |
| Mainchain Audit 2026-07-29 §3 | `Winning SameDomain Buckets → Domain + Base Sentence Assembly` |
| SameDomain Restoration 2026-07-30 §7 | 每 retained domain：`sameDomain + base_term + canonical`；跨域 domain_term **不进入当前桶** |
| `assemble-domain-aware-span-sets.ts` | `runDomainAwareAssembly` → `filterDomainCandidatesPerSpan` per bucket → `budgetPerSpanCandidates` → `assembleDomainAwareSpanSets` |
| `span-assembly-v4-orchestrator.ts` | Path-local Vote→Bucket→Assembly；CrossPath merge 在 Path 生成之后 |

**Not frozen:** 将 Model2 union/budget 层全部 candidates 直接当作 Assembly 输入集合。

---

## 2. Assembly Input Contract

```
activeCandidates (post-Recall + Model2 expand, isCovered=false)
  → buildFineSpanCandidatePool(activeCandidates, pathFineSpans[])
  → voteUtteranceDomainFromPool(pool) → retainedDomains[] (presence vote, ratio 0.75)
  → FOR EACH retained bucket (or [null] if insufficientEvidence):
       filterDomainCandidatesPerSpan(pool, vote, rawText, bucketDomain)
       budgetPerSpanCandidates(filtered, perSpanLimit 8/6/4)
       assembleDomainAwareSpanSets → SpanReplacementPick[][]
  → buildSentenceCandidates(rawText, bucketSets, maxSentenceCandidates=16)
  → mergeCrossPathSentenceCandidates(all paths/buckets, cap=16)
  → KenLM (score/rank only)
```

**Assembly 输入** = 每个 PathFineSpan slot 上的 **selectedCandidates**（budget 后），不是 union 全量列表。

---

## 3. Ownership Matrix

| Stage | Owns | Does NOT own |
|-------|------|--------------|
| FineSpan / Lattice | PathFineSpan segmentation, non-overlap invariant | Sentence enumeration, domain decision |
| Recall / Model2 union | Candidate discovery, termId identity, budget at retrieval | Sentence path, overlap resolution |
| Domain Vote | Presence vote, retainedDomains, tie/ratio 0.75 | Per-span winner, sentence cap |
| SameDomain bucket | Grouping domain_term + base_term per retained domain | Cross-domain mixing inside bucket |
| Assembly (`buildSentenceCandidates`) | Non-overlap DFS, gap fill, exact-text dedup, Formula A metadata | Semantic diversity, KenLM ranking |
| CrossPath merge | Exact-text first-wins, global ≤16 | Regeneration, rescoring |
| KenLM | Score, rank, pick (weak_veto) | Candidate creation |

---

## 4. FineSpan / Candidate Ownership

- **FineSpan owns:** raw/syllable range, window binding, tone rebind trace.
- **Eligibility gate:** `isCandidateEligibleForSpanAssembly` — candidate 必须与 PathFineSpan **完全对齐**（raw + syllable）；parent_fragment 仅当完整覆盖时 eligible。
- **Candidate ownership:** termId/candidateId identity; `repairTarget=true` 才参与 DFS repair subset。
- **Production invariant:** `assertPathFineSpansNonOverlapping` — Assembly 入口 fail-fast，不 auto-repair overlap。

---

## 5. Base vs Domain Candidate Roles

| Kind | Bucket behavior |
|------|-----------------|
| `base_term` | 进入 **所有** bucket 的 `baseCandidates` |
| `domain_term` / `passive_domain_weak` | 仅进入 `domains.includes(bucketDomain)` 的 `sameDomainCandidates` |
| cross-domain domain_term | **故意排除**（非 eligibility drop） |
| canonical/raw | budget 层强制 preservation candidate，与 recall 共存，surface dedup |

---

## 6. Domain Vote / SameDomain

- **Vote:** fine-span presence count per domain（非 score mass）。
- **Retention:** maxCount tie → 全部 retained；否则 runner-up ≥ 0.75×maxCount 也 retained。
- **SameDomain role:** **bucket grouping + parallel sentence generation** — **不是** hard filter 删除所有非 winning domain candidates from universe。
- **Insufficient evidence:** single `bucketDomain=null` → base + fallback only.

---

## 7. Span Overlap Semantics (Frozen)

- **PathFineSpan:** 生产路径 non-overlapping（硬 invariant）。
- **Repair picks on path:** `rawOverlap` — overlapping repairs **never co-exist** on one sentence path.
- **DFS:** slot-by-slot enumerate all non-overlap repair subsets; empty repair set → RAW + gap canonical.
- **Not frozen:** semantic near-duplicate control inside Top16.

---

## 8. Sentence Candidate Generation

- **Algorithm:** Interval Non-Overlap Repair-Subset DFS (`build-sentence-candidates.ts`).
- **Caps:** enum nodes 1024 · repairs/path 16 · output ≤ maxSentenceCandidates (16).
- **Dedup:** exact-text first-wins after score sort (Assembly-local); CrossPath repeat.
- **Original sentence path:** always exists (empty repair subset → raw + gap fills).

---

## 9. KenLM Handoff

- Assembly/CrossPath 产出 `prefilledCombinations` → KenLM **只评分**，不重建 candidates。
- `mergeCrossPathSentenceCandidates` 为唯一 Cross-Path merge owner。
- Assembly output 经 dedup+cap 后原样进入 KenLM query set（本轮 trace: 63 cases 有 correction ngram 在 KenLM input）。

---

## 10. Streaming FineSpan Compatibility

当前生产：**Lattice PathFineSpan**（非 legacy LTR coarse hard boundary）。

- Eligibility 要求 full-span alignment — union 层可见的 parent_fragment / 未对齐 candidate **不应**假设能进 Assembly。
- **无证据**表明 Assembly 仍假设 coarse-span-contained fixed windows 作为硬限制；但 **eligibility 等价于软 coarse 对齐**。

---

## 11. Frozen vs Not Frozen

| Frozen | Not frozen / deferred |
|--------|----------------------|
| Non-overlap DFS | Semantic diversity in Top16 |
| rawOverlap contract | Per-domain sentence quota enforcement |
| maxSentenceCandidates=16 post-materialization | `allocateDomainBucketSentenceBudget` driving truncation |
| SameDomain multi-bucket | Near-duplicate policy |
| base+domain mixing per bucket | Enum cap predictable diversity |

---

**Reconstruction complete:** YES
