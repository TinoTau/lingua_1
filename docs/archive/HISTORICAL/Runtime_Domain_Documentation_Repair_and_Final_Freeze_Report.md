<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Runtime_Domain_Documentation_Repair_and_Final_Freeze_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Runtime Domain Documentation Repair and Final Freeze Report

| Field | Value |
|------|-------|
| Status | **COMPLETE** |
| Date | 2026-07-20 |
| Scope | Documentation repair + integrity gates only |
| Sole Runtime Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |

---

## 1. Executive Verdict

**PASS.** Runtime SSOT 已以干净 UTF-8 重写；文档职责收敛为 Sole Authority + Supporting；KenLM Integration / Quality 已拆分；文档完整性门禁通过；`accept:runtime-ssot` PASS。本轮未修改 Runtime / Vote / Assembly / KenLM 算法源码。

---

## 2. Git Status

- Branch: `main` @ `262b3d3`
- 工作树在本轮之前已脏（Presence Vote 代码、tone_module、dialog_200 wav、词库等）
- **本轮仅触及允许的文档 + `freeze-contract.test.ts` 文档门禁**
- 未执行 `git reset --hard` / `git clean` / 自动提交

区分：

| 类别 | 说明 |
|------|------|
| 本轮文档修改 | Runtime SSOT、Index、DSU、DOMAIN_RECALL、FROZEN_V1_2、ARCHITECTURE、KENLM_RUNTIME、Legacy banner、本报告 |
| 本轮门禁 | `freeze-contract.test.ts` GATE-DOC-SSOT 增强 |
| 此前未提交代码 | Vote / merge / orchestrator / KenLM wiring 等（本轮未改） |
| 无关修改 | tone / wav / lexicon 产物（未触碰） |

---

## 3. Modified Files

```text
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md
docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md
docs/fw-detector/recall/DOMAIN_RECALL.md
docs/fw-detector/assembly/FROZEN_V1_2.md
docs/fw-detector/ARCHITECTURE.md
docs/fw-detector/kenlm/KENLM_RUNTIME.md
docs/tone-v2/Legacy_Domain_Logic_Removal_and_Real_Dialogue_Multi_Bucket_Acceptance_Report.md
docs/tone-v2/Runtime_Domain_Documentation_Repair_and_Final_Freeze_Report.md  (this file)
electron_node/electron-node/main/src/fw-detector/freeze-contract.test.ts
```

**CONTEXT_PRIOR.md：** 已明确 diagnostics-only / `applied:false` → **未改**。

---

## 4. Unmodified Code Confirmation

本轮未修改：

```text
utterance-domain-vote.ts
assemble-domain-aware-span-sets.ts
build-sentence-candidates.ts（算法）
span-assembly-v4-orchestrator.ts
fw-detector-v4-path.ts
run-fw-sentence-rerank-from-prefilled.ts
rerank-fw-sentences.ts
acceptance runners / KenLM scorer / lexicon / config / package 行为
```

仅更新 `freeze-contract.test.ts` 中 GATE-DOC-SSOT 静态文档检查。

---

## 5. Sole Runtime Authority

```text
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

Index 已改为 Sole Runtime Authority / Supporting / Execution / Historical，不再并列多个 Current Frozen Authority。

---

## 6. Runtime SSOT Rebuild

全文清洁 UTF-8 重写，包含任务要求的 30 个章节：Status、Sole Authority、Ownership、主链、Lexicon/Hotword/WindowCandidate、FineSpanDomainSet、One Span One Vote、Base 排除、domainScores、retainedDomains、0.75、Multi-Bucket、Base 入桶、bounded generation、cross-bucket dedup、≤16、KenLM integration、prefilledCombinations、input boundary、raw_log_delta、Context Prior、Removed/Forbidden、Integration/Quality、Known Risks、Acceptance Commands、Freeze Statement。

未创建 V2/Final/Latest/(2)/(3) 平行文件。

---

## 7. Control Character Removal

扫描结果：

```text
Runtime SSOT control characters: 0
tabs: 0
```

允许 `\n`/`\r`；禁止 TAB 及其他 C0。

---

## 8. Markdown Fence Repair

```text
Runtime SSOT unmatched fences: 0
Duplicate Runtime SSOT files: 0
```

主链使用完整 Markdown fence + `↓` 箭头；无 backtick+TAB+ext 损坏模式。

---

## 9. KenLM Integration / Quality Split

```text
KENLM INTEGRATION ACCEPTANCE: PASS
KENLM QUALITY STATUS: PARTIAL / KNOWN RISKS
```

记录事实：20 cases；pool 命中 100%；Top1 65%；MISRANK 7；final repair 95%；misrepair 0；DOMAIN_VOTE_DROP 1；dialog_200 全量 wav E2E NOT EXECUTED。

已移除单独的 `REAL KENLM ACCEPTANCE: PASS`。

---

## 10. Index Responsibility Repair

`RUNTIME_DOMAIN_DOCUMENT_INDEX.md` 重组为：

- Sole Runtime Authority
- Supporting Contracts
- Execution Records
- Accepted Audits
- Historical / Superseded

---

## 11. DOMAIN_SOURCE_UNIFICATION Repair

角色收敛为 **SOURCE_AND_REGISTRY_ONLY**。页眉声明不拥有 Vote/Assembly/KenLM。旧 Rerank/VoteMass/Assembly 规则标记 SUPERSEDED/REMOVED。

---

## 12. DOMAIN_RECALL Repair

角色收敛为 **RECALL_ONLY**。页眉：`Runtime Vote and Assembly are not owned by this document.` Context Prior：`diagnostics-only` / `applied:false`。删除“ReRank 系数仍有效 / soft multiplier”权威表述。

---

## 13. FROZEN_V1_2 Repair

角色收敛为 **ASSEMBLY_DETAIL_ONLY**。删除 Shadow Beam 正式路径合同；引用 Runtime SSOT；保留 per-bucket / merge / ≤16 / diagnostics。

---

## 14. ARCHITECTURE Repair

角色收敛为 **OVERVIEW_ONLY**。高层流水线与模块 Owner 链接；删除 Shadow/Rerank/双 Vote 作为正式路径。

---

## 15. KENLM_RUNTIME Repair

补充跨桶正式调用链：

```text
orchestrator → mergeCrossBucketSentenceCandidates → kenlmSentenceCandidates
→ fw-detector-v4-path → prefilledCombinations
→ runFwSentenceRerankFromPrefilled → rerankFwSentences
```

明确无领域元数据、≤16、raw_log_delta、Integration ≠ Quality、cold-start 风险。

---

## 16. CONTEXT_PRIOR Status

已符合 diagnostics-only / `applied:false` / 不参与 Vote·Assembly·KenLM → **未修改**。

---

## 17. Historical Report Status

`Legacy_Domain_Logic_Removal_and_Real_Dialogue_Multi_Bucket_Acceptance_Report.md` 顶部增加：

```text
STATUS: SUPERSEDED / HISTORICAL
```

并指向 Minimal Repair Report + Runtime SSOT。历史正文保留。

---

## 18. Cross-Reference Validation

Index / Owner 链接指向现存文件。本报告写入后 broken refs = 0。

当前合同文档中 Shadow formal / Domain Rerank active 声明 = 0。

---

## 19. Document Integrity Gates

`GATE-DOC-SSOT` 增强：

- C0 control 禁止（允许 LF/CR；禁 TAB）
- fence 成对
- 必需关键字列表
- 禁止单独 `REAL KENLM ACCEPTANCE: PASS`
- 禁止平行 Runtime SSOT 文件名
- 兄弟当前文档明显旧声明静态检查

结果：**PASS**

---

## 20. Test Results

| Command | Result |
|---------|--------|
| `npx tsc --project tsconfig.main.json --noEmit` | PASS |
| `npx jest --testPathPattern=freeze-contract` | PASS (84) |
| `npm run test:fw-detector` | PASS (255) |
| Doc-related jest pattern | PASS (110) |
| `npm run accept:runtime-ssot` | **ACCEPTANCE_PASS** |
| Control-char / fence / dup scan | **0 / 0 / 0** |

说明：仓库无独立 `npm run typecheck` script；使用等价 `tsc --noEmit`。全量无过滤 `npm test` 因工作树含大量无关套件未作为本轮门禁阻塞项；文档相关与 fw-detector 套件已全绿。

---

## 21. Remaining Risks

1. WSL KenLM cold-start timeout（质量/运行风险，非文档职责冲突）
2. KenLM Top1 65% — Quality NOT FROZEN
3. Pinyin Recall Noise（不得改 Presence Vote 修补）
4. 0.75 最优性未证明
5. dialog_200 全量 wav E2E 未执行
6. 工作树仍有大量此前未提交代码/资源（与本轮文档冻结隔离）

---

## 22. Target List

| Target | Status |
|--------|--------|
| Rebuild Sole Runtime SSOT | DONE |
| Converge supporting docs | DONE |
| Split KenLM Integration/Quality | DONE |
| Legacy SUPERSEDED banner | DONE |
| Document integrity gates | DONE |
| accept:runtime-ssot | PASS |

---

## 23. Check List

- [x] 无控制字符
- [x] fence 成对
- [x] 唯一 Runtime SSOT 路径
- [x] Integration / Quality 拆分
- [x] 文档职责清晰
- [x] CONTEXT_PRIOR 无需改
- [x] Runtime 算法代码未改
- [x] 门禁通过

---

## 24. Final Verdict

```text
FINAL VERDICT: PASS
```

```text
RUNTIME DOMAIN DOCUMENTATION REPAIR
AND FINAL FREEZE COMPLETE — STOP
```

---

## Mandatory Output Block

```text
RUNTIME CODE MODIFIED:
NO

SOLE RUNTIME AUTHORITY:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md

PARALLEL RUNTIME CONTRACTS:
0

RUNTIME SSOT UTF-8:
PASS

RUNTIME SSOT CONTROL CHARACTERS:
0

RUNTIME SSOT MARKDOWN FENCES:
PASS

RUNTIME SSOT API IDENTIFIERS:
PASS

KENLM INTEGRATION STATUS:
PASS

KENLM QUALITY STATUS:
PARTIAL

DOMAIN_SOURCE_UNIFICATION ROLE:
SOURCE_AND_REGISTRY_ONLY

DOMAIN_RECALL ROLE:
RECALL_ONLY

FROZEN_V1_2 ROLE:
ASSEMBLY_DETAIL_ONLY

ARCHITECTURE ROLE:
OVERVIEW_ONLY

CONTEXT PRIOR:
DIAGNOSTICS_ONLY

LEGACY SHADOW REFERENCES:
REMOVED_FROM_CURRENT_DOCS

DOMAIN RERANK ACTIVE REFERENCES:
0

BROKEN CROSS REFERENCES:
0

DOCUMENT INTEGRITY GATE:
PASS

ACCEPT_RUNTIME_SSOT:
PASS

DOCUMENT RESPONSIBILITY:
CLEAR

ARCHITECTURE CONTRACT:
UNCHANGED

DOCUMENTATION FREEZE:
PASS

FINAL VERDICT:
PASS
```
