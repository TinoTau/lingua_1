<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Domain_Vote_Atomicity_Audit_2026_08_02.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Domain Vote Atomicity Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · VOTE TRACE** |
| Focus | 神经网络 / 单元测试（Sentence Context REGRESSION 两例） |
| Status | **ROOT_CAUSE_CLASSIFIED** |

---

## 1. Question

为什么删除 compound 后 **Domain Vote 下降**，但 **Assembly / KenLM / Final 完全不变**？

为什么 **神经+网络** 不能在 Vote 上替代 **神经网络**？

---

## 2. Vote SSOT（代码事实）

`utterance-domain-vote.ts`:

1. `resolveGraphSource`: hotword 无 fine domain → `base_term`；有 fine domain → `domain_term`。
2. Vote 门禁：仅 `source ∈ {domain_term, passive_domain_weak}` 计入 FineSpanDomainSet。
3. Presence：每个 FineSpan 对每个 domain **最多 +1**（同 span 多候选不加权）。
4. `retainedDomains`：max 票或 ≥ 0.75×max 的 domain。
5. **不是** score-mass / Weight Vote（已冻结移除）。

`base_term` 仍可进 Assembly（拼表面字），但不投 Domain 票。

---

## 3. Root Cause Verdict

| 假设 | 结论 |
|------|------|
| Domain Tag 问题？ | **是（主因）** — compound 独有 fine domain tag；原子词多为无 domain 的 base |
| Vote 问题？ | **否** — Presence Vote 按冻结合同工作 |
| Candidate Merge 问题？ | **否** — 原子候选存在，只是不eligible投票 |
| Weight 问题？ | **否** — 无 weight；是 presence count |
| Runtime Bug？ | **否** — Assembly/KenLM 不变是 base 路径覆盖表面的预期行为 |

```text
PRIMARY = DOMAIN_TAG
（compound-only fine domain）+ Vote source gate（base_term 不计票）
```

Compound 在 domain_lexicon / hotword.domains 上挂有 fine domain（如 tech_ai）；原子词（神经/网络、单元/测试）通常仅为 base_term（无 fine domain）→ resolveGraphSource=base_term → Vote 门禁排除。删除 compound 后失去该 FineSpan 的 presence 票，retainedDomains 下降；Assembly 仍可用 base_term/canonical 拼出相同表面，故 KenLM/Final 不变。

---

## 4. Cases

## Case: 单元测试

**Sentence:** 请在合并前确保单元测试全部通过。

### Lexicon Domain Tags

| Word | inBase | domain_lexicon | Runtime Exact domains |
|------|--------|----------------|------------------------|
| 单元测试 | true | [tech_ai] | [tech_ai] |
| 单元 | true | [] | [] |
| 测试 | true | [] | [] |

### WITH — Vote Log

- Edges contain compound: **true**
- LexicalEdge count: 3
- Path count: 2
- Edge sample: 7:9:单元/[]/base_term; 7:11:单元测试/[tech_ai]/domain_term; 9:11:测试/[]/base_term
- Orch retainedDomains: [tech_ai]
- Orch Final: 请在合并前确保单元测试全部通过。
- Assembly count: 1
- KenLM Top3: ["请在合并前确保单元测试全部通过。"]

**Primary path (pathLogs[0])**

- path spans: 0:1[] · 1:2[] · 2:3[] · 3:4[] · 4:5[] · 5:6[] · 6:7[] · 7:11[单元测试] · 11:12[] · 12:13[] · 13:14[] · 14:15[]
- domainScores: `{"tech_ai":1}`
- retainedDomains: [tech_ai]
- buckets: ["tech_ai"]
- Vote-eligible candidates:
- `单元测试` @7:11 source=`domain_term` domains=[tech_ai] → votes **tech_ai**
  - FineSpan `fine:ba4c03fa4879c6501ab272910094c6949dbfa2002bd48f898da345ac37ed644f:7` DomainSet={tech_ai} · candidates=单元测试/domain_term/[tech_ai]✓

**Other paths:** 1 (see JSON)

### WITHOUT — Vote Log

- Edges contain compound: **false**
- LexicalEdge count: 2
- Path count: 1
- Atom edges: 7:9:单元/[]/base_term; 9:11:测试/[]/base_term
- Orch retainedDomains: []
- Orch Final: 请在合并前确保单元测试全部通过。
- Assembly count: 1
- KenLM Top3: ["请在合并前确保单元测试全部通过。"]

**Primary path**

- path spans: 0:1[] · 1:2[] · 2:3[] · 3:4[] · 4:5[] · 5:6[] · 6:7[] · 7:9[单元] · 9:11[测试] · 11:12[] · 12:13[] · 13:14[] · 14:15[]
- domainScores: `{}`
- retainedDomains: []
- buckets: [null]
- Vote-eligible candidates:
_none_

### Diff

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [tech_ai] | [] |
| domainScores (primary) | `{"tech_ai":1}` | `{}` |
| Assembly/KenLM/Final | identical surface path available | identical |

### Why 单元+测试 cannot replace 单元测试 for Vote

- **单元**: no fine domain tag → resolveGraphSource=base_term → Vote 不计票 (domains=[])
- **测试**: no fine domain tag → resolveGraphSource=base_term → Vote 不计票 (domains=[])

- Compound domains: [tech_ai]
- compound 若被 Recall 为 domain_term（hotword.domains 含 fine domain），则其所在 FineSpan 的 FineSpanDomainSet 计入 presence +1
- Contract: Vote SSOT: domainScores[domain] = distinct FineSpan presence count；仅 source∈{domain_term,passive_domain_weak} 且 domains 含 fine label 才入 set；同 span 同 domain 多候选只计 1 票

---

## Case: 神经网络

**Sentence:** 我们正在训练神经网络模型。

### Lexicon Domain Tags

| Word | inBase | domain_lexicon | Runtime Exact domains |
|------|--------|----------------|------------------------|
| 神经网络 | true | [tech_ai] | [tech_ai] |
| 神经 | true | [] | [] |
| 网络 | true | [] | [] |

### WITH — Vote Log

- Edges contain compound: **true**
- LexicalEdge count: 4
- Path count: 2
- Edge sample: 6:8:神经/[]/base_term; 6:10:神经网络/[tech_ai]/domain_term; 8:10:网络/[]/base_term
- Orch retainedDomains: [coffee, tech_ai]
- Orch Final: 我闷蒸在训练神经网络模型。
- Assembly count: 2
- KenLM Top3: ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"]

**Primary path (pathLogs[0])**

- path spans: 0:1[] · 1:3[闷蒸] · 3:4[] · 4:5[] · 5:6[] · 6:10[神经网络] · 10:11[] · 11:12[]
- domainScores: `{"coffee":1,"tech_ai":1}`
- retainedDomains: [coffee, tech_ai]
- buckets: ["coffee","tech_ai"]
- Vote-eligible candidates:
- `闷蒸` @1:3 source=`domain_term` domains=[coffee] → votes **coffee**
- `神经网络` @6:10 source=`domain_term` domains=[tech_ai] → votes **tech_ai**
  - FineSpan `fine:6a30f0d631e80b1536265f92d74554969c9cb5017aaff04939a72ddb3f9ab6fe:1` DomainSet={coffee} · candidates=闷蒸/domain_term/[coffee]✓
  - FineSpan `fine:6a30f0d631e80b1536265f92d74554969c9cb5017aaff04939a72ddb3f9ab6fe:5` DomainSet={tech_ai} · candidates=神经网络/domain_term/[tech_ai]✓

**Other paths:** 1 (see JSON)

### WITHOUT — Vote Log

- Edges contain compound: **false**
- LexicalEdge count: 3
- Path count: 1
- Atom edges: 6:8:神经/[]/base_term; 8:10:网络/[]/base_term
- Orch retainedDomains: [coffee]
- Orch Final: 我闷蒸在训练神经网络模型。
- Assembly count: 2
- KenLM Top3: ["我闷蒸在训练神经网络模型。","我们正在训练神经网络模型。"]

**Primary path**

- path spans: 0:1[] · 1:3[闷蒸] · 3:4[] · 4:5[] · 5:6[] · 6:8[神经] · 8:10[网络] · 10:11[] · 11:12[]
- domainScores: `{"coffee":1}`
- retainedDomains: [coffee]
- buckets: ["coffee"]
- Vote-eligible candidates:
- `闷蒸` @1:3 source=`domain_term` domains=[coffee] → votes **coffee**
  - FineSpan `fine:95260b2a981376a037966622319c7efba02d49426ef2068dc101dbaf98ef4dcb:1` DomainSet={coffee} · candidates=闷蒸/domain_term/[coffee]✓

### Diff

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [coffee, tech_ai] | [coffee] |
| domainScores (primary) | `{"coffee":1,"tech_ai":1}` | `{"coffee":1}` |
| Assembly/KenLM/Final | identical surface path available | identical |

### Why 神经+网络 cannot replace 神经网络 for Vote

- **神经**: no fine domain tag → resolveGraphSource=base_term → Vote 不计票 (domains=[])
- **网络**: no fine domain tag → resolveGraphSource=base_term → Vote 不计票 (domains=[])

- Compound domains: [tech_ai]
- compound 若被 Recall 为 domain_term（hotword.domains 含 fine domain），则其所在 FineSpan 的 FineSpanDomainSet 计入 presence +1
- Contract: Vote SSOT: domainScores[domain] = distinct FineSpan presence count；仅 source∈{domain_term,passive_domain_weak} 且 domains 含 fine label 才入 set；同 span 同 domain 多候选只计 1 票


---

## 5. Why Assembly / KenLM / Final unchanged

1. Path 上仍有 `单元|测试` / `神经|网络`（或 compound 与原子并存）的 LexicalEdge。
2. Vote 丢失只减少 **retained bucket**（如去掉 tech_ai），不删除 base/canonical 表面候选。
3. Cross-path merge 按 text dedup：最终句字符串仍可由 base 路径生成 → KenLM 池与 Top1 可完全一致。
4. 因此：**Vote 退化 ≠ 表面句退化**。Sentence Context 审计把 DOMAIN_VOTE 单独判 REGRESSION 是正确的。

---

## 6. Implication for DELETE_RUNTIME_SAFE

若 Source 删除 compound：

- 仅当关心 **Domain Vote / domain-aware bucket** 时：这两个词在部分句子上 **不安全**（会丢 tech_ai）。
- 若只关心 **Final 字面**：表面仍可由原子恢复。
- Cleanup 前需二选一：  
  (A) 给原子词补齐等价 domain tag（可能过宽）；或  
  (B) 接受 Vote 变粗，仅保留 Final 等价；或  
  (C) 对 Vote 敏感的 compound **不删**（Runtime-required for Domain Vote，而非“术语例外”）。

Artifact: `docs/tone-v2/_audit_scratch/domain_vote_atomicity/domain_vote_atomicity.json`
