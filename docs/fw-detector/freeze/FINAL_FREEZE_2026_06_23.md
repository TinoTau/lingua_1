# FW Repair V4 — Final Architecture Freeze

**日期：** 2026-06-23  
**裁决：** **A — 进入 Maintenance Mode**（Framework Frozen · Lexicon Continues）  
**SSOT：** [`FRAMEWORK_FREEZE_DECLARATION.md`](../FRAMEWORK_FREEZE_DECLARATION.md) · `freeze-contract.test.ts`

验收基线：dialog_200 **200/200 PASS** · Final CER **≈0.237** · Pipeline P50 **≈2540 ms**

---

## 1. 总体结论

| 问题 | 结论 |
|------|------|
| FW Repair V4 达到 Architecture Freeze？ | **是** — V4-only 单主链 + 冻结合约门禁 |
| 进入 Maintenance Mode？ | **是** |
| 503/504 阻断 FW 冻结？ | **否** — 归属 ASR Infrastructure |
| 实验主链？ | **否** — 仅 Shadow Beam（诊断，不进 KenLM/Apply） |

附注：ASR infra 修复、`legacy/*` 死代码清理为**并行运维线**，不撤回 FW 冻结裁决。

---

## 2. 组件冻结矩阵

| 组件 | 状态 |
|------|------|
| FW Detector Orchestrator | **FROZEN** — `runFwDetectorV4Path` only |
| Recall（Tone-First V2） | **FROZEN** |
| Domain Vote + ReRank | **FROZEN** |
| Interval Assembly | **FROZEN** — [`assembly/INTERVAL_ASSEMBLY.md`](../assembly/INTERVAL_ASSEMBLY.md) |
| KenLM | **FROZEN** — batch-only |
| Apply | **FROZEN** — `applyFwSpanReplacements` |
| Aggregation | **FROZEN** — 无 asrText fallback |
| Duplicate Guard | **FROZEN** — [`aggregator/DEDUP.md`](../../../electron_node/electron-node/main/src/aggregator/DEDUP.md) |
| DedupStage | **FROZEN** — sanitize → DedupStage |
| Shadow Beam | **FROZEN（诊断）** |
| Schema V2 | **FROZEN** — [`SCHEMA_V2.md`](../../../electron_node/lexicon-assets/docs/SCHEMA_V2.md) |
| **Domain Source Unification** | **FROZEN** — 2026-06-23 — [`DOMAIN_SOURCE_UNIFICATION.md`](../DOMAIN_SOURCE_UNIFICATION.md) |
| **Context Prior / Soft Demotion** | **FROZEN** — 2026-06-23 — [`CONTEXT_PRIOR.md`](../CONTEXT_PRIOR.md) |
| ASR | **MAINTENANCE_ONLY** |
| Lexicon patch/seed | **MAINTENANCE_ONLY — 数据** |

---

## 3. 主链矩阵

| 路径 | 生产 |
|------|------|
| V4 主链（IME → Recall → Domain → Interval → KenLM → Apply） | ✅ PRIMARY |
| V3 span assembly | ❌ REMOVED |
| Legacy topK / ASR repair | ❌ LEGACY_READONLY（FW off 时） |
| Shadow Beam | 仅 diagnostics/trace |
| `spanAssemblyV4Enabled=false` | throw fail-fast |
| KenLM fail-open score=0 | ✅ FROZEN 合约 |

---

## 4. 接口冻结摘要

| 接口 | 状态 |
|------|------|
| `FwDetectorResult` / `spanAssemblyV4` | FROZEN |
| `JobContext.segmentForJobResult` | FROZEN 写点白名单 |
| `DuplicateSanitizeTrace` | FROZEN |
| `FwSentenceRerankDiagnostics`（raw_log_delta） | FROZEN |
| `toneModule` / `hardDropCount` | **REMOVED** |
| `JobContext.legacy.*` | FW 主链禁止读写 |

---

## 5. 代码归属

| 目录 | 分类 |
|------|------|
| `fw-detector/`（V4 主链） | **FROZEN** — 仅 bugfix 经 freeze-contract |
| `aggregator/dedup.ts` | **FROZEN** |
| `pipeline/` | **FROZEN** — 步骤顺序/写点 |
| `lexicon-v2/` | **MAINTENANCE_ONLY** — 数据 |
| `legacy/**` | **TEST_ONLY / ROLLBACK** |
| `services/faster_whisper_vad/` | **MAINTENANCE_ONLY** |
| `docs/fw-detector/` | **FROZEN_DOCS** |

---

## 6. 变更策略

### 冻结后允许（L1–L6）

词库扩展 · Domain 数据 · 测试数据 · 监控/日志 · ASR Infrastructure 修复

### 冻结后禁止

新 Detector · 新 Recall/Assembly/Beam 主链 · 新 Domain/Tone Gate · 新 Duplicate 算法 · 新 Score 合约 · 新 FW Pipeline 步骤 · 静默降级

### Context Prior 冻结后禁止修改（2026-06-23）

| 对象 | 禁止 |
|------|------|
| Recall Ownership | `resolve-recall-enabled-fine-domains.ts` 决策逻辑 |
| Vote Ownership | `utterance-domain-vote.ts` 决策逻辑 |
| Registry Ownership | `runtime-domain-registry.ts` 决策逻辑 |
| `DOMAIN_RERANK_PENALTY` | 常量与关系判定语义 |
| Context Prior Scheme A | `CONTEXT_PRIOR_MULTIPLIER_*` · `CONTEXT_PRIOR_CLAMP_*` |

**允许：** Context Prior 层 bugfix（须经 `freeze-contract` GATE-CP-01~04）；不得改变上述所有权与常量。

---

## 7. freeze-contract 覆盖

| 域 | Gates |
|----|-------|
| Schema V2 | GATE-SV2-1 ~ SV2-7 |
| Interval Assembly | GATE-INT-1 ~ INT-4 |
| Duplicate Guard | dedup-step + segment 白名单 |
| KenLM | GATE-1 batch-only, GATE-2 raw log delta |
| V4-only | 无 V2/V3 分支 |
| Residual Cleanup | CLEANUP-1 ~ CLEANUP-5 |
| Context Prior | GATE-CP-01 ~ GATE-CP-04 |

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
```

---

## 8. Maintenance 重心

1. **P0** — 签署 Maintenance Mode；freeze-contract 为 CI 必过  
2. **P0** — ASR infra 稳定性  
3. **P1** — Lexicon 覆盖与 CER 改善（数据驱动）  
4. **P2** — legacy 死代码清理（不改变行为）

---

## 子模块文档索引

| 模块 | 文档 |
|------|------|
| Assembly V1.2 | [assembly/FROZEN_V1_2.md](../assembly/FROZEN_V1_2.md) |
| Interval Assembly | [assembly/INTERVAL_ASSEMBLY.md](../assembly/INTERVAL_ASSEMBLY.md) |
| Recall Tone-First | [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](../recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) |
| Domain Recall | [recall/DOMAIN_RECALL.md](../recall/DOMAIN_RECALL.md) |
| Duplicate Guard | [aggregator/DEDUP.md](../../../electron_node/electron-node/main/src/aggregator/DEDUP.md) |
| Schema V2 | [SCHEMA_V2.md](../../../electron_node/lexicon-assets/docs/SCHEMA_V2.md) |
| Domain Source Unification | [DOMAIN_SOURCE_UNIFICATION.md](../DOMAIN_SOURCE_UNIFICATION.md) |
| Context Prior | [CONTEXT_PRIOR.md](../CONTEXT_PRIOR.md) |
