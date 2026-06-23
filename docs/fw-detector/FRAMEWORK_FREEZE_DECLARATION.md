# FW Repair V4 — Framework Freeze Declaration

**生效日期：** 2026-06-19  
**裁决：** Framework **允许整体冻结**  
**验收：** Dialog200 Gate 3.0 · Improved 30 · Degraded 5 · Net CER +25

---

## 1. Freeze Version

```text
FW Repair V4 Framework — 2026-06-19
```

| 子合约 | 版本 |
|--------|------|
| Tone-First Recall | V1.0.1 |
| Diagnostics / Trace | V1.0.2 |
| KenLM Runtime | Batch-Only V1.0.0 |
| Raw Log Delta Score | V1.0.0 |

---

## 2. 主链（唯一合法路径）

```text
ASR → IME V2 → Raw Boundary → Fine Span Recall → Tone-First Recall
→ Domain Vote → Sentence Assembly V4 → KenLM Batch → Raw Log Delta Pick → Apply
```

入口：`runFwDetectorOrchestrator` → `runFwDetectorV4Path` · `pipelinePath: 'v4'`

**已移除：** V3 assembly · legacy ASR repair 主链 · serial KenLM · normalized delta Gate

---

## 3. Frozen Components

| 组件 | 冻结内容 | 日期 |
|------|----------|------|
| Tone | timestamp-only · score penalty · 非 hard gate | 2026-06-19 |
| Recall | Tone-First tier · TopK limits | 2026-06-19 |
| Domain Vote / Assembly | Compatibility V1.1 · SameDomain V1.2 | 2026-06-19 |
| KenLM | batch-only subprocess | 2026-06-19 |
| Score Contract | rawDelta pick · Gate **3.0** | 2026-06-19 |
| Apply | repairTarget + overlap | 2026-06-19 |
| Diagnostics | V1.0.2 核心字段语义 | 2026-06-19 |
| **Domain Source Unification** | `RuntimeDomainRegistry` · RS-03A · PAR-01 coarse LLM · `term_domain_tags` + `domain_hierarchy` SSOT | **2026-06-23 · Frozen** |
| **Context Prior / Soft Demotion** | Domain ReRank Layer · Scheme A multiplier · `profile.primaryDomain` only | **2026-06-23 · Frozen** |

**DSU 权威文档：** [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md)

**Context Prior 权威文档：** [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) · Depends On: **Domain Source Unification**

**冲突优先级：** DSU **>** Context Prior **>** 本节下列运维文档中的 Domain 相关描述（`DOMAIN_RECALL.md` · `CONFIG.md` · `ARCHITECTURE.md` · `LEXICON_RUNTIME_V2.md` · `DIAGNOSTICS_CONTRACT.md`）

---

## 4. Future Iteration Policy

```text
Framework Frozen · Lexicon Continues
```

质量瓶颈：**Lexicon Coverage · Domain Coverage · Candidate Quality** — 见 [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md)

---

## 5. Freeze Validation

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
```

| 检查 | 状态 |
|------|------|
| 50/50 冻结合约测试 | ✅ |
| GATE-1 batch-only | ✅ |
| GATE-2 raw pick | ✅ |
| SSOT minDeltaToReplace=3.0 | ✅ |
| V4-only orchestrator | ✅ |

---

## 6. Sign-off Checklist

- [x] 四条子合约冻结 + 自动化测试
- [x] Dialog200 Gate 3.0 验收
- [x] Lexicon-Only Iteration 文档化
- [x] 核心 SSOT 文档 Consolidation（`docs/fw-detector/`）

---

## 7. 文档 SSOT

| 文档 | 路径 |
|------|------|
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Config | [CONFIG.md](./CONFIG.md) |
| KenLM Runtime | [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) |
| Score Contract | [kenlm/SCORE_CONTRACT.md](./kenlm/SCORE_CONTRACT.md) |
| Interface Freeze | [INTERFACE_FREEZE.md](./INTERFACE_FREEZE.md) |
| Diagnostics | [DIAGNOSTICS_CONTRACT.md](./DIAGNOSTICS_CONTRACT.md) |
| Domain Source Unification | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) |
| Context Prior / Soft Demotion | [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) |
| Lexicon Schema V2 | [../../electron_node/lexicon-assets/docs/SCHEMA_V2.md](../../electron_node/lexicon-assets/docs/SCHEMA_V2.md) |
| Lexicon Ops | [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md) |
| Assembly / Recall / Compatibility / Trace | 各子目录 `FROZEN*.md` |

---

*Supersede 2026-06-17 模块级冻结摘要；整体冻结以本声明为准。*
