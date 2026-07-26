# Runtime SSOT Freeze Readiness Development Report

```text
STATUS: EXECUTION RECORD

Freeze readiness cleanup + final freeze delivery for Runtime SSOT Contract V1.
Architecture authority: Runtime_SSOT_Contract_Freeze.md
```

| 字段 | 值 |
|------|-----|
| Document Status | **EXECUTION RECORD** |
| 任务 | Runtime SSOT Freeze Readiness Cleanup and Final Freeze |
| 计划 | `Freeze_Readiness_Cleanup_Plan.md` |
| 日期 | 2026-07-19 |
| Lexicon v10 | **UNCHANGED** · `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |

---

## 1. Executive Summary

已完成残留清理、合同修订、历史文档状态治理、stale dist 防护与全量验证。  
**Runtime SSOT Contract V1 已正式 FROZEN。**  
未开发 Membership / Vote 多域 / DomainWeight / Shadow 删除。

---

## 2. Cleanup Plan 执行结果

| # | 动作 | 结果 |
|---|------|------|
| 1 Freeze 措辞 | REWRITE → FROZEN | 完成 |
| 2 tone 别名赋值 | RESTORE + Tone Audit 标记 | 完成（选择 **C**） |
| 3 patch-recall-smoke `domain?` | REMOVE → `domains?` | 完成 |
| 4 GATE-INT-2 | REWRITE（取消强制传播） | 完成（选择 **B**） |
| 5 CLEANUP-2 | REWRITE（zero-path stub） | 完成 |
| 6 stale dist | clean + build + acceptance | 完成 |
| 7–12 文档状态 / 索引 / 注释 | MARK / REWRITE | 完成 |
| 8 错误测试副本 | NO ACTION（确认不存在） | 完成 |
| 9–10 selectedDomain / Hotword.domain | NO ACTION（确认 NONE） | 完成 |

---

## 3. 修改文件清单

### 代码 / 测试 / 脚本

* `main/src/lexicon-patch-v3/patch-recall-smoke.ts`
* `main/src/fw-detector/span-assembly-shared/types.ts`
* `main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts`
* `main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts`
* `main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.test.ts`
* `main/src/fw-detector/freeze-contract.test.ts`
* `scripts/runtime-ssot-acceptance.cjs`（新建）
* `package.json`（`accept:runtime-ssot`）

### 文档

* `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`（FROZEN V1）
* `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md`（新建）
* `docs/tone-v2/Freeze_Readiness_Cleanup_Plan.md`
* `docs/tone-v2/Multi_Domain_Candidate_Contract_Development_Report.md`（REJECTED）
* `docs/tone-v2/Multi_Domain_Candidate_Contract_Audit.md`
* `docs/tone-v2/Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md`
* `docs/tone-v2/Rollback_Plan.md`
* `docs/tone-v2/Runtime_SSOT_Recovery_Report.md`
* `docs/tone-v2/Runtime_SSOT_Recovery_Baseline_Audit.md`
* 本报告

---

## 4. 删除字段 / 代码清单

| 项 | 处理 |
|----|------|
| `RecallSmokeRow.hits[].domain?` | 删除；改为 `domains?` |
| GATE-INT-2 强制 `windowSource: pick.windowSource` 断言 | 删除（改为 optional 槽位 + 无 domain 污染断言） |
| CLEANUP-2 “不得出现 hardDropCount 字符串” | 删除；改为断言 `hardDropCount: 0` stub |

未删除业务 hardDrop 字段本体（compatibility FROZEN 仍列 metrics）。

---

## 5. 保留字段及冻结依据

| 字段 | 依据 |
|------|------|
| `Hotword.domains[]` / `domainWeights` | Lexicon Domain Freeze V1 |
| `WindowCandidate.domainId` | Runtime SSOT V1 §2.1 LEGACY |
| `UtteranceDomainVoteResult.utteranceDomain` | Decision SSOT |
| DomainAware 中间 `domainId` | §2.3 sameDomain only |
| `hardDropCount: 0` | compatibility/FROZEN.md 零 hard-drop 主路径 + metrics 表 |
| `recallToneIncompatibleCount?` | 恢复为 fallback 别名；正式语义仍为 `recallToneFallbackCount` |
| Shadow `domainId` | diagnostics only |

---

## 6. Tone 字段归属判定

**选择：C（恢复最后已知有效赋值）+ 独立 Tone Contract Audit**

证据：

* HEAD 存在 `tone.recallToneIncompatibleCount = tone.recallToneFallbackCount`
* `CoarseAssemblyToneDiagnostics` 正式字段为 `recallToneFallbackCount`
* 实验/trace JSON 仍读取 `recallToneIncompatibleCount`

动作：恢复赋值；类型增加 optional 别名并标注 BLOCKED FOR SEPARATE Tone Contract Audit。  
**未在本轮宣布废弃。**

---

## 7. GATE-INT-2 处理结论

**选择：B — 测试为相对 FROZEN_V1_2 的提前加严**

* `SpanReplacementPick` 可保留 optional `windowSource?` / `coveredCoarseSpanIds?` 类型槽位  
* **不要求**经 `domainAwarePickToSpanReplacementPick` 强制传播  
* Assembly/KenLM 当前不读这些字段做域决策  
* Gate 归类为 CFG Integration；修订后全量 freeze-contract PASS  

---

## 8. CLEANUP-2 处理结论

**修订测试，保留 stub**

* `compatibility/FROZEN.md` 列出 `hardDropCount`；主路径零 hard drop  
* 代码 `hardDropCount: 0` 为合法 stub  
* 错误要求“源码不得出现 hardDropCount 字符串”与冻结文档冲突 → 已改正  

---

## 9. Decision SSOT 证明

* 业务代码无 `selectedDomain` / `candidateDomains`  
* 主链 winner = `domainAssembly.vote.utteranceDomain`  
* `shadowVote` 不进入 KenLM/Apply（acceptance + 源码路径）  

**DECISION SSOT: PASS**

---

## 10. Assembly Boundary 证明

* Pick keys（acceptance）：`span,word,source,priorScore,repairTarget,candidateScore`  
* 无 `domainId` / `domains` / `selectedDomain`  
* KenLM 输入纯文本  

**ASSEMBLY BOUNDARY: PASS**

---

## 11. Shadow Isolation 证明

* 无 Shadow 多领域新合同  
* KenLM 使用 `domainAwareSpanSets`，非 `shadowBeamSpanSets`  

**SHADOW MAIN-CHAIN ISOLATION: PASS**

---

## 12. 文档状态治理清单

| 文档 | Status |
|------|--------|
| Runtime_SSOT_Contract_Freeze.md | **FROZEN** |
| RUNTIME_DOMAIN_DOCUMENT_INDEX.md | CURRENT |
| Multi_Domain_Candidate_Contract_Development_Report.md | REJECTED / SUPERSEDED |
| Multi_Domain_Candidate_Contract_Audit.md | HISTORICAL AUDIT |
| Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md | HISTORICAL AUDIT |
| Rollback_Plan.md | EXECUTION RECORD |
| Runtime_SSOT_Recovery_Report.md | EXECUTION RECORD |
| Runtime_SSOT_Recovery_Baseline_Audit.md | ACCEPTED BASELINE AUDIT |
| Freeze_Readiness_Cleanup_Plan.md | EXECUTION RECORD |

---

## 13. 当前权威文档索引

见 [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](./RUNTIME_DOMAIN_DOCUMENT_INDEX.md)。

```text
Current Frozen Authority > Accepted Audit > Execution Record > Historical Report
```

---

## 14. stale dist 治理

* `npm run build:main` 已含 `clean:main`  
* `npm run accept:runtime-ssot`：强制 clean+build → Electron smoke → 检查 dist Pick 无 `domainId` 传播  
* **STALE DIST RISK: CONTROLLED**

---

## 15. 类型检查

```text
tsc -p tsconfig.main.json --noEmit → PASS
```

---

## 16. 全量测试

```text
freeze-contract / recall-scope-wiring / assemble-domain-aware /
candidate-score / recall-span-topk-v2 / recall-span-topkv3 /
build-sentence-candidates / domain-rerank

Test Suites: 9 passed
Tests: 119 passed
```

（全量 suite，非 `-t` 子集。）

---

## 17. Electron ABI smoke

```text
npm run accept:runtime-ssot → ACCEPTANCE_PASS
```

系统 Node ABI mismatch **未**用作 PASS。

---

## 18. 固定样例 Trace（acceptance）

| sample | DB tags | Hotword.domains | domainId 债务 |
|--------|---------|-----------------|---------------|
| 预订 | food_order, tourism_hotel, tourism_route, transport | 同左 | food_order |
| 少糖 | coffee, food_order, milk_tea | 同左 | coffee |
| 中杯 | coffee, food_order, milk_tea | 同左 | coffee |
| 菜单 | bakery, coffee, food_order, milk_tea | 同左 | bakery |
| 接送 | tourism_pickup, tourism_transport | 同左 | tourism_pickup |
| 机场 | tourism_transport, transport | 同左 | tourism_transport |
| 你好 | [] | [] | undefined |

合成句 `我要少糖中杯`：

* Vote winner: `coffee`  
* sameDomain: 2 · base: 0 · sentences: 1  
* KenLM: `我要少糖中杯`  
* 无 evidence：`utteranceDomain=general` · `insufficientEvidence=true`

---

## 19. Lexicon hash

```text
checksum.txt = sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef
lexicon.sqlite SHA256 = 同上
bundleVersion = 10
lastPatchId = lexicon-domain-hierarchy-completion-v1
```

**LEXICON V10: UNCHANGED**

---

## 20. 未解决问题（非阻断 / 独立票）

| 项 | 状态 |
|----|------|
| Membership / domains[0] | P2 已知债务 · 另开 Membership Repair |
| DomainWeight | 既有 DRIFT · Vote Semantics |
| Shadow 删除 | 另开 Shadow Retirement |
| `recallToneIncompatibleCount` 别名 | Tone Contract Audit |
| hardDrop 字段最终是否整删 | 需独立 CFG Cleanup（当前 stub 合法） |

---

## 21. Target List（已完成）

* [x] Freeze 措辞与双 Vote / 中间态 / 构建规则  
* [x] patch-recall-smoke domains  
* [x] tone 别名恢复  
* [x] GATE-INT-2 / CLEANUP-2  
* [x] 文档状态头 + 索引  
* [x] acceptance 脚本  
* [x] 全量验证  

---

## 22. Check List

- [x] Phase 0–6  
- [x] P0 Multi-Domain 残留 = 0  
- [x] 错误报告 REJECTED  
- [x] 唯一文档索引  
- [x] fresh dist Electron smoke  
- [x] 停止：未开 Membership / Vote / Shadow 开发  

---

## 23. Freeze 结论

```text
FREEZE READINESS:
PASS
```

```text
RUNTIME SSOT CONTRACT:
FROZEN
```

```text
ERROR MULTI-DOMAIN LOGIC RESIDUE:
NONE
```

```text
MISLEADING CODE COMMENTS:
NONE
```

```text
MISLEADING DOCUMENTS:
NONE
```

```text
STALE DIST RISK:
CONTROLLED
```

```text
FULL CONTRACT TESTS:
PASS
```

```text
ELECTRON ABI ACCEPTANCE:
PASS
```

```text
LEXICON V10:
UNCHANGED
```

```text
DECISION SSOT:
PASS
```

```text
ASSEMBLY BOUNDARY:
PASS
```

```text
SHADOW MAIN-CHAIN ISOLATION:
PASS
```

```text
NEXT ACTION:
FREEZE COMPLETE — STOP
```

```text
FREEZE READINESS CLEANUP COMPLETE — STOP
```
