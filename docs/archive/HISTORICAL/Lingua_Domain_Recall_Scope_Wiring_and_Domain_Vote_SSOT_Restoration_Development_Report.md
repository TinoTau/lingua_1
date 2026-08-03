<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lingua_Domain_Recall_Scope_Wiring_and_Domain_Vote_SSOT_Restoration_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lingua Domain Recall Scope Wiring & Domain Vote SSOT Restoration — Development Report

**Date:** 2026-07-16  
**Type:** Frozen Architecture Restoration（非新功能 · 非架构重设计）  
**Verdict:** **A — Domain Recall Scope Wiring Restored**  
**依据：** [`DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) · Domain Vote / SameDomain Audit 2026-07-16 · Runtime Evolution Rule

---

## Final Verdict

## A — Domain Recall Scope Wiring Restored

```text
Configured Domains
        ↓
resolveRecallScope
        ↓
recallDomainScope
        ↓
Domain Recall
        ↓
Domain Vote
        ↓
sameDomain
```

```text
No Duplicate Resolver
No Duplicate Vote
No Compatibility Layer
No Assembly Change
No KenLM Change
```

下一步：

```text
Domain Vote & SameDomain Re-validation
```

通过后才能进入：

```text
Sentence Assembly Candidate Diversity Audit / RFC
```

---

## 0. 一致性检查（开发前）

| Expected (Frozen CFG-01) | Actual (修复前) | Impact |
|--------------------------|-----------------|--------|
| `enabledDomains=[]` → `recallDomainScope=availableFineDomains` → Domain Lookup | `resolveRecallScope` 只写 diagnostics；orchestrator 仍传 `enabledDomains=[]` | Domain-only 词不可召回；Vote 空证据；200/200 general；sameDomain=0 |
| orchestrator 唯一接收已解析 scope | 接收原始 `enabledDomains` 并二次解释 | 双 SSOT |

| Action | Item |
|--------|------|
| **RESTORE** | CFG-01：空配置 = 全量 available fine domains 进入 Recall |
| **MODIFY** | orchestrator / v4-path 接口：`enabledDomains` → `recallDomainScope` |
| **DELETE** | 主链上“空 enabledDomains = 关闭 Domain Recall”的歧义路径 |
| **KEEP** | Vote 公式 · sameDomain 条件 · 8/6/4 · Assembly · KenLM · Registry · term_domain_tags |
| **MODIFY** | diagnostics：`spans[].domains` 不再硬编码 `[]`；补充 lookup metrics |

---

## 1. 根因代码位置

| # | 位置 | 问题 |
|---|------|------|
| 1 | `fw-detector-orchestrator.ts` | `resolveRecallScope()` 结果仅进 `runtimeDiag`，未传下游 |
| 2 | `fw-detector-v4-path.ts` | 向 orchestrator 传 `enabledDomains`（常为 `[]`） |
| 3 | `span-assembly-v4-orchestrator.ts` L163（修复前） | `domainIds: weakEnabled ? … : input.enabledDomains` → Domain SQL 跳过 |

**为何 resolved scope 未进 Recall：** 解析与接线断裂——scope 只做观测，Recall 仍读原始配置。

---

## 2. 修改文件与接口

### 代码

| 文件 | 变更 |
|------|------|
| `fw-detector-orchestrator.ts` | 解析 `recallDomainScope`；空则 `reason=recall_domain_scope_empty`；传 v4-path |
| `fw-detector-v4-path.ts` | 输入改为 `recallDomainScope` |
| `span-assembly-v4-orchestrator.ts` | 输入 `recallDomainScope`；`domainIds=recallDomainIds`；空 scope fail-fast；metrics 补充 |
| `v4-types.ts` / `types.ts` | 追加观测字段 |
| `build-sentence-candidates.ts` | `SpanReplacementPick.domainId?`（diagnostics） |
| `window-candidate-to-pick.ts` | 传递 `domainId` |
| `build-fw-spans-from-coarse-assembly-v4.ts` | 恢复 `domains` / `domainMatched` 真实来源 |
| `freeze-contract.test.ts` | GATE-DSU-2b |
| `recall-scope-wiring.test.ts` | Case A–H |
| `run-domain-recall-scope-wiring-regression.mjs` | dialog_200 离线对照 |

### 文档

`DOMAIN_SOURCE_UNIFICATION.md` · `DOMAIN_RECALL.md` · `ARCHITECTURE.md` · `CONFIG.md` · `assembly/FROZEN_V1_2.md` · `diagnostics/FROZEN.md`

### 未改

Vote 算法 · DomainWeight · multi-domain 合同 · sameDomain 匹配 · 8/6/4 · Assembly 枚举 · KenLM · Lexicon 数据 · `term_domain_tags`

---

## 3. 目标调用链（已恢复）

```text
Domain Registry (term_domain_tags)
  → availableFineDomains
  → resolveRecallScope(configuredEnabledDomains)
  → recallDomainScope
  → runSpanAssemblyV4Orchestrator({ recallDomainScope })
  → recallTopKForWindows({ domainIds: recallDomainScope })
  → lookupDomainsByPinyinKeyMulti(...)
  → HotwordEntry.domain / domains[] / domainWeights
  → WindowCandidate.domainId (= domains[0])
  → voteUtteranceDomainFromPool()
  → Winner → sameDomain + base
```

**兼容层：** 无。主链不再接受 orchestrator.`enabledDomains` 作为 Recall 决策输入。  
配置快照仍记录原始 `enabledDomains` + 解析后 `recallDomainScope`（观测）。

---

## 4. Empty Config 唯一语义

```text
configuredEnabledDomains = []
  → recallDomainScope = availableFineDomains（经现有 capFineDomains）
  → Domain Lookup 执行
  → 不是关闭 Domain Recall
  → 不是 Base-only
```

空 `recallDomainScope`（Registry 无可用域 / policy 展开为空）：**fail-fast**，禁止静默 general/Base-only。

---

## 5. Candidate Metadata（本轮边界）

| 层 | 状态 |
|----|------|
| DB `term_domain_tags` 多行 | KEEP |
| `HotwordEntry.domains[]` / `domainWeights` | Domain lookup 路径保留 |
| `WindowCandidate.domainId` | 仍为 `domains[0]`（多域压缩点） |
| 多领域完整 Vote | **后续独立事项**（本轮未改） |

---

## 6. 测试

### Unit / Contract

- `resolve-recall-enabled-fine-domains.test.ts` — PASS  
- `recall-scope-wiring.test.ts`（Case A–D · empty fail-fast · E–H 集成意图）— PASS  
- `GATE-DSU-2b` — 已加入 freeze-contract  

（`freeze-contract` 另有 **预存** GATE-INT-2 / CLEANUP-2 失败，与本轮无关，未顺手扩大修复。）

### dialog_200 离线回归（Electron ABI · 固定预算 2/3 · 8/6/4 · 16 · 1024）

输入：C1 traces 的 `raw_asr_text` 重放（不重跑 ASR、不调参）。

| Metric | Before (C1) | After |
|--------|------------:|------:|
| Resolved recall scope non-empty | 0（实际传入） | **12**（available） |
| Domain lookup executed | 0 | **200/200** |
| Vote-eligible candidates present | ≈0 | **200/200** |
| utteranceDomain=general | **200** | **0** |
| Fine-domain winner | 0 | **200** |
| insufficientEvidence | 200（推断） | **0** |
| sameDomainCandidateCount>0 | 0 | **197** |
| Base candidate count | >0 | **保持 >0** |

样例：

| Case | Before | After |
|------|--------|-------|
| d001 | general / same=0 | **coffee** / same=1 · scores 含 coffee |
| d002 | general / same=0 | **coffee** / same=2 |
| d003 | general / same=0 | **coffee** / same=3 |

Artifact：`tmp/budget_expansion_20260715/domain_recall_scope_wiring_regression.json`

---

## 7. Acceptance（对照 §十二）

| # | 要求 | 状态 |
|---|------|:----:|
| 1 | 空配置 → 全量 available | ✅ |
| 2 | resolved scope 唯一 Recall 输入 | ✅ |
| 3 | Domain SQL lookup 执行 | ✅ |
| 4 | Domain-only 可进池（如中杯） | ✅（集成/回归） |
| 5 | 候选带现有 domain metadata | ✅ |
| 6 | Vote 不再因接线空证据 | ✅ |
| 7 | 有证据 case 出 fine winner | ✅ 200/200 |
| 8 | sameDomain 可形成 | ✅ 197/200 |
| 9 | Base Recall 保持 | ✅ |
| 10 | general 仅真实不足 | ✅（本批 insuff=0） |
| 11–14 | 无第二 Resolver/Vote/重复 sameDomain/Base-only fallback | ✅ |
| 15 | Assembly / KenLM 算法未改 | ✅ |

---

## 8. 必须回答（§十五）

1. 根因位置？→ orchestrator/v4-path 未传 `recallDomainScope`；Recall 读空 `enabledDomains`。  
2. 为何未进入？→ 只写 diagnostics。  
3. 改了哪些？→ 见 §2。  
4. 删除歧义主链接口？→ orchestrator 不再用 `enabledDomains` 决定 Domain Lookup。  
5. 兼容层？→ **无**。  
6. Empty 语义？→ 全量 available，打开 Domain Recall。  
7. Domain Lookup？→ **是**（200/200）。  
8. Domain-only 进池？→ **是**。  
9. Vote 有 evidence？→ **是**。  
10. general 比例？→ **200 → 0**。  
11. sameDomain 恢复？→ **0 → 197 cases >0**。  
12. Base 保持？→ **是**。  
13. 改 Vote 算法？→ **否**。  
14. 改 multi-domain 合同？→ **否**（仍 `domainId=[0]`）。  
15. 改 Assembly/KenLM？→ **否**。  
16. 新 Shadow？→ **否**。  
17. SSOT 唯一？→ **是**（`term_domain_tags` + Registry → `recallDomainScope`）。  
18. 可否进 Assembly Diversity？→ **否**；先做 **Domain Vote & SameDomain Re-validation**。

---

## 9. 残留（不阻塞 Verdict A；属后续）

| 项 | 说明 |
|----|------|
| `capFineDomains(12)` | available 含 `general` 时可能挤掉末尾 fine（如 `transport`）；属既有 RS-03A cap，非本轮扩大 |
| Multi-domain Vote | 仍单 `domainId`；独立合同 |
| Winner 质量分布 | meeting/tech_ai 偏多 — 属 Vote/标签质量再验证，非接线失败 |
| 3 case sameDomain=0 | winner 非 general 但同域候选未入 selected — 交给 Re-validation |

---

## 10. Final Verdict（唯一）

## A — Domain Recall Scope Wiring Restored

下一步：

```text
Domain Vote & SameDomain Re-validation
```
