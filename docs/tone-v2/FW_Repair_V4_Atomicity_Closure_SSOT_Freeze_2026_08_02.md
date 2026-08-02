# FW Repair V4 — ASR Post-Processing / Atomicity / KenLM Readiness SSOT Freeze
## CURRENT · 2026-08-02

| Field | Value |
|-------|-------|
| Status | **CURRENT / FROZEN** |
| Nature | FREEZE contracts after Atomicity Closure |
| Supersedes | Open Atomicity heuristics; LTR / parent_fragment / term_pinyin_ngrams as production recall |

---

## 1. ASR Post-Processing Architecture Freeze

```text
ASR Raw
→ FineSpan / Lattice
→ Formal Term Exact Recall
→ Domain Vote
→ SameDomain Bucket
→ Sentence Assembly
→ CrossPath
→ KenLM
```

**RETIRED / HISTORICAL (not production):** LTR · Beam · parent_fragment · term_pinyin_ngrams · substring candidate · phraseCandidates · phoneticGroups · shadow recall · parallel V2/V3 recall.

---

## 2. Formal Term Atomicity Contract (Surface)

完整正式 term 仅当满足其一可保留：

- **A.** 表面不可由合法原子词无损覆盖；或  
- **B.** 表面可覆盖，但有效领域语义不能由原子词无损承担，且给原子词补标签会造成明显过宽污染（→ `domain_atomic` 例外）。

---

## 3. Domain-Semantic Atomicity Contract

Domain presence 证据不得靠 compound→segment 机械复制标签获得。  
`term_domain_tags` 是唯一 Domain Tag SSOT。  
Validator **不得**修改 Domain Tags。

合法例外元数据：

```text
term_type = domain_atomic
exception_reason = 表面可由原子词覆盖，但有效 fine-domain presence 仅由完整词承担；原子词补同域标签会造成过宽或歧义。
```

当前 KEEP_DOMAIN_ATOMIC：神经网络 · 单元测试 · 回归测试 · 测试数据 · 特征工程 · 配置文件 · 集成测试 · 迷你吧。

---

## 4. Unified Atomicity Gate Contract

| Item | Contract |
|------|----------|
| Owner | Unified Atomicity Validator（唯一） |
| Modes | `enforce`（生产 Full Rebuild 默认）；`audit` 仅显式 opt-out |
| Write paths | Full Rebuild · Patch V3 · Patch V4 · Industry Import · Supplemental · future Expansion Package |
| Runtime Recall | **禁止** Atomicity 过滤 |
| Gate | `REJECT_COMPOSITE = 0` · `UNRESOLVED = 0`；仅 `ACCEPT` / `ACCEPT_EXCEPTION` 可写入 |
| Fail closed | enforce 失败输出全部阻塞行并停止构建 |

---

## 5. Lexicon Source-to-Runtime Rebuild Contract

| Item | Contract |
|------|----------|
| Entry | `npm run lexicon:full-rebuild` |
| Source | `electron_node/docs/lexicon-assets/full_rebuild_v1/` |
| Forbidden | 读旧生产 SQLite · 读 tmp · 复制旧表 |
| Outputs | SQLite · manifest · checksum · schema gate · Source hashes · atomicity report |
| Pinyin Owner | Runtime `normalizeSyllable`（strip non `[a-z0-9]`）；Full Rebuild 写入前对齐同一规范化 |

---

## 6. Domain Vote Contract

```text
仅 domain_term / passive_domain_weak 投票
base_term 不投票
每个 FineSpan 对同一 domain 最多 +1
retainedDomains 按 frozen ratio
不恢复 score-mass / weight vote
```

词库 Atomicity 问题 **不得**用改 Vote 算法解决。

---

## 7. KenLM Input / Output Readiness Contract

| Role | Owner |
|------|-------|
| Candidate generation | Lattice / Assembly / CrossPath（非 KenLM） |
| Score / rank / pick | `rerankFwSentences` · `raw_log_delta` · Gate `minDeltaToReplace` |

输入：CrossPath final sentence candidates（≤16）。  
输出可追踪：`text` · `kenlmScore` · `deltaVsRaw` · `rank` · TopK · raw baseline。

本轮 **不**优化模型 / n-gram / threshold / TopK。

---

## Related CURRENT docs

- [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](./RUNTIME_DOMAIN_DOCUMENT_INDEX.md)
- [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md)
- [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md)
- Closure reports dated 2026-08-02
