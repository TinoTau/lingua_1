<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Runtime_Domain_Documentation_Compliance_Audit.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Runtime Domain Documentation Compliance Audit

| 字段 | 值 |
|------|-----|
| Status | **AUDIT COMPLETE — NO EDITS APPLIED** |
| Date | 2026-07-20 |
| Nature | 只读文档审计 |
| Fact Priority | 源码 > Compliance Audit > Minimal Repair Report > 冻结设计 > 历史文档 |

---

## 1. Executive Summary

权威层次在索引层大体正确（`Runtime_SSOT_Contract_Freeze.md` 被标为唯一 Runtime Authority），但**文档集合整体未与当前冻结源码对齐**。

核心问题：

1. **`Runtime_SSOT_Contract_Freeze.md` 合同语义基本对齐源码，但 Markdown/控制字符损坏**（TAB 破坏 fence、BEL/FF 吞掉函数名首字母），阅读与机器解析不可靠。  
2. **多个“Current Frozen Authority”文档仍描述已删除逻辑**（Shadow Beam、`domain-rerank.ts`、Context Prior 乘分）。  
3. **`REAL KENLM ACCEPTANCE: PASS` 混用 Integration 与 Quality**；质量侧仍有 DOMAIN_VOTE_DROP / KENLM_MISRANK，不应在冻结合同中被读成质量通过。  
4. **`freeze-contract` 文档门禁过弱**：能挡乱码 UTF-8/关键词，挡不住控制字符、损坏 fence、兄弟文档过时。

**FINAL VERDICT: FAIL**（作为“文档真实反映冻结源码”的合规目标）

---

## 2. Authority Hierarchy

| Priority | Source | Role |
|----------|--------|------|
| 1 | 当前正式源码 | 唯一事实 |
| 2 | `Fine_Span_Presence_Runtime_Compliance_and_SSOT_Document_Repair_Audit.md` | 已接受审计 |
| 3 | `Runtime_Domain_Minimal_Repair_Real_KenLM_Acceptance_and_Final_Freeze_Report.md` | 执行/验收记录 |
| 4 | 冻结设计（Presence Vote / Multi-Bucket / Cross-Bucket Dedup / KenLM） | 设计约束 |
| 5 | 其它历史文档 | 仅参考 |

索引声明：

```text
SOLE RUNTIME AUTHORITY (intended):
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

但索引仍把 DSU / DOMAIN_RECALL / FROZEN_V1_2 / CONTEXT_PRIOR 并列在 **Current Frozen Authority**，易被当成并行“主链合同”。正确职责应为：

| 文档 | 应有角色 |
|------|----------|
| Runtime_SSOT_Contract_Freeze | **唯一 Runtime 主链合同** |
| Lexicon_Domain_Contract_Freeze_V1 | Lexicon 事实合同 |
| DOMAIN_SOURCE_UNIFICATION | Recall scope / Registry（非 Vote 公式） |
| DOMAIN_RECALL | Recall 行为；Vote 仅引用 Runtime SSOT |
| FROZEN_V1_2 | Assembly 细节；主链摘要引用 Runtime SSOT |
| CONTEXT_PRIOR | diagnostics-only 边界 |
| Development / Acceptance Reports | **执行记录，非合同** |

---

## 3. Runtime_SSOT Review

### 与源码对齐（内容层面）

对照源码：`utterance-domain-vote.ts`、`span-assembly-v4-orchestrator.ts`、`fw-detector-v4-path.ts`、`run-fw-sentence-rerank-from-prefilled.ts`。

| 合同点 | Runtime_SSOT | 源码 | 判定 |
|--------|--------------|------|------|
| FineSpanDomainSet / One Span One Vote | 有 | 有 | 对齐 |
| Base Exclusion | 有 | 有 | 对齐 |
| 0.75 | 有 | `DOMAIN_BUCKET_RETENTION_RATIO = 0.75` | 对齐 |
| Multi-Bucket | 有 | `runDomainAwareAssembly` | 对齐 |
| Cross-Bucket Dedup 后全局 ≤16 | 有 | `mergeCrossBucketSentenceCandidates` + slice | 对齐 |
| KenLM Cross-Bucket + prefilledCombinations | 有（但函数名被控制字符损坏） | `prefilledCombinations` | 语义对齐 / 文本损坏 |
| Shadow / Rerank REMOVED | 有 | 文件已删 | 对齐 |
| REAL KENLM ACCEPTANCE: PASS | 有 | harness ACTIVE；质量非满分 | **过述**（见 §13） |

### 缺失 / 不准确

- **未拆分** KenLM Integration vs Quality vs Known Risk。  
- Open Risks 未明确写入：KenLM Top1=65%、KENLM_MISRANK=7、WSL cold-start timeout（报告有，冻结合同不足）。  
- 部分函数名因控制字符变成 `\x0cw-detector-v4-path`、`\x07llocateDomainBucketSentenceBudget`、`\x07pplied:false` — **表述损坏**。

### 重复

主链在 §3 与 Acceptance 命令/Removed 列表中合理；与 FROZEN_V1_2 / DOMAIN_RECALL 的“主链全文”重复属于**职责重叠**（见 Duplicate Contracts）。

---

## 4. Context Prior Review

`CONTEXT_PRIOR.md`（2026-07-20）：

```text
applied = false
diagnostics-only
不参与 Vote / Rerank / score / Assembly / KenLM
```

与源码 `context-prior.ts` stub **一致**。未暗示正式决策。

**例外风险（外溢）：** `DOMAIN_RECALL.md` 页眉仍写 Context Prior 属 Domain ReRank Layer 并施加 soft multiplier —— **与 CONTEXT_PRIOR 及源码冲突**（过时引用，非 CONTEXT_PRIOR 本身错误）。

---

## 5. Assembly Documentation Review

`assembly/FROZEN_V1_2.md`：

- §2 Main Chain 已部分更新 Presence Vote / multi-bucket / merge≤16 / KenLM — **大体对齐**。  
- 仍保留大量**已过时正式描述**：
  - §1 “Shadow Chain 独立：Beam…”
  - §3 接口仍含 `shadowBeamSpanSets?`
  - H5 双 Vote（含 `voteUtteranceDomain` Shadow）
  - H7 Beam 退休但仍写 shadowBeam 产出
  - 指标 `shadowBeamSpanSetsTotal`
- 源码：**无** `run-coarse-sentence-beam-v4.ts`，orchestrator **无** `shadowBeamSpanSets`。

**判定：** Assembly 文档 = **部分落后源码**；不可再当作完整主链 SSOT，只应保留 Assembly 细节并强制引用 Runtime SSOT。

`ARCHITECTURE.md` 仍写 Shadow→Beam→shadowBeamSpanSets、Context Prior 在 `domain-rerank.ts` — **严重落后**。

---

## 6. Domain Source Review

`DOMAIN_SOURCE_UNIFICATION.md`：

| 问题 | 证据 |
|------|------|
| 仍把 `domain-rerank.ts` 列为代码路径 | 文件头第 4 行；源码已删除 |
| ReRank 节仍描述 `classifyDomainRerankRelation` 为现役 | § ReRank |
| Vote 节仍写 `candidate.domainTags` / `domainWeights` / `isFineDomainEligibleForWinning` | 与 Presence Vote 源码不符 |
| 冲突优先级自称 > DOMAIN_RECALL | 可接受于 Registry/Recall Scope，但**不得**覆盖 Runtime SSOT 主链 |

Recall scope / Registry 部分仍有价值；**Vote/ReRank 相关段落过时**。

`DOMAIN_RECALL.md`：

- §4 Presence Vote：**已指向 Runtime SSOT** — 好。  
- §5 Domain ReRank：**REMOVED** — 好。  
- 页眉仍称 “§5 ReRank 系数仍有效” 且 Context Prior soft multiplier — **自相矛盾 / 落后**。  
- 后文仍出现 “ReRank 后不允许空 Span”、SecondaryDomains ReRank Bonus、Shadow Beam Structure — **残留旧合同语言**。

`Lexicon_Domain_Contract_Freeze_V1.md`：词库事实合同，与 Runtime Vote 职责分离合理（本轮未发现其把 VoteMass 当正式 Runtime 主链）。

---

## 7. KenLM Documentation Review

| 文档 | 状态 |
|------|------|
| Runtime_SSOT §16–18 | 合同正确但函数名损坏；ACCEPTANCE PASS 过述 |
| `kenlm/KENLM_RUNTIME.md` | raw_log_delta / Gate 3.0 对齐；调用链**未写** `prefilledCombinations` / 跨桶合并池 |
| Minimal Repair Report | Integration vs Quality 区分较清楚（PARTIAL PASS） |
| Legacy Acceptance | 已有 STATUS CORRECTION；正文仍含旧 PASS 叙事 |

源码正式链：

```text
orchestrator mergeCrossBucket → kenlmSentenceCandidates
→ v4-path prefilledCombinations
→ runFwSentenceRerankFromPrefilled → rerankFwSentences
```

`KENLM_RUNTIME.md` 调用链省略跨桶池 — **Integration 文档落后**。

---

## 8. Development Reports Review

| 文档 | 应有标记 | 现状 |
|------|----------|------|
| Fine_Span_Domain_Presence_Vote_…_Development_Report | EXECUTION | 索引已标 EXECUTION |
| Runtime_Domain_Minimal_Repair_…_Report | EXECUTION / ACCEPTANCE | 索引正确；内容诚实 PARTIAL PASS |
| Runtime_SSOT_Freeze_Readiness_Development_Report | EXECUTION / HISTORICAL | 在 Historical 表 |
| Fine_Span Presence Compliance Audit | ACCEPTED AUDIT | 正确 |

**不得**将 Development Report 当正式设计；索引已基本做到，但 FROZEN_V1_2 / DSU / ARCHITECTURE 仍像平行合同。

---

## 9. Historical Reports Review

| 文档 | 问题 |
|------|------|
| Legacy_Domain_Logic_Removal_… | 顶部 STATUS CORRECTION **已做**；§1 正文仍写 **PASS** / 85% 入池（已被后续预算修复与 KenLM 验收超越）→ 需读者只信 CORRECTION+新报告 |
| Multi_Domain_* / DomainId_* | 索引标 HISTORICAL/REJECTED — 合适 |
| 旧 Tone / ASR 质量报告 | 非 Runtime Domain 合同；勿混入 Authority |

---

## 10. Duplicate Contracts

同时描述“唯一正式主链”的文档：

1. **Runtime_SSOT_Contract_Freeze.md** — 应保留为唯一主链合同  
2. **FROZEN_V1_2.md** — 应降为 Assembly 细节 + 引用 Runtime SSOT；删除/归档 Shadow 接口合同段落  
3. **DOMAIN_RECALL.md** — Vote 已引用 SSOT，但页眉与后文仍像主合同  
4. **DOMAIN_SOURCE_UNIFICATION.md** — Vote/ReRank 段落与 Runtime 主链重复且过时  
5. **ARCHITECTURE.md** — 总览过时，像第三套主链  
6. **Development/Acceptance Reports** — 执行记录，偶被当最终结论

---

## 11. Missing Contracts（文档层）

冻结合同中建议补强（仅文档，非改代码）：

- KenLM：**Integration PASS** vs **Quality metrics / Known Risk** 分节  
- Cross-bucket：`prefilledCombinations` 作为正式接线名（当前被控制字符损坏）  
- WSL cold-start / fail-open 行为说明（可放 KenLM_RUNTIME 或 Open Risks）  
- 明确 “Current Frozen Authority” 表中非 Runtime SSOT 条目的**从属**关系

---

## 12. Incorrect Statements（相对源码）

| 位置 | 错误陈述 | 源码事实 |
|------|----------|----------|
| DSU 头 | `domain-rerank.ts` 存在 | 已删除 |
| DSU ReRank / Vote | 旧公式与 ReRank API | Presence Vote only |
| DOMAIN_RECALL 页眉 | §5 ReRank 系数仍有效；CP soft multiplier | ReRank REMOVED；CP applied:false |
| FROZEN_V1_2 / ARCHITECTURE | Shadow Beam 现役诊断链 | 模块已删 |
| KENLM_RUNTIME 调用链 | 无跨桶 prefilled 池 | 已接线 prefilledCombinations |
| Runtime_SSOT 损坏行 | `floor`/`fw`/`allocate`/`applied` 首字母丢失 | 控制字符 |

---

## 13. Overstated Conclusions

| 陈述 | 问题 |
|------|------|
| Runtime_SSOT：`REAL KENLM ACCEPTANCE: PASS` | 易被读成**质量**通过；实际是 harness/Integration 通过；Top1 65%、MISRANK 7、DOMAIN_VOTE_DROP 1 |
| Legacy §1 `PASS`（即使有 CORRECTION） | 正文仍过强 |
| Minimal Report 强制块 `REAL KENLM ACCEPTANCE: PASS` + `FINAL VERDICT: PARTIAL PASS` | 报告内自洽，但冻结合同未继承 Quality 限定 |

应拆分为文档表述（修复轮）：

```text
KENLM INTEGRATION: PASS
KENLM QUALITY: PARTIAL / KNOWN RISK
ARCHITECTURE FREEZE: PASS
```

---

## 14. Markdown / Encoding Issues

文件：`docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`

| 类型 | 位置（代表） | 影响 |
|------|--------------|------|
| TAB (`\t`) | 多处 `` ` `` + TAB + `ext`（本应 ` ```text `） | **代码块 fence 损坏**；渲染成普通文本 |
| FORM FEED (`\x0c`) | `floor`→`\x0cloor`；`fw-detector`→`\x0cw-detector` | 函数/路径名首字母丢失 |
| BEL (`\x07`) | `allocate`→`\x07llocate`；`applied`→`\x07pplied` | 同左 |
| UTF-8 | 严格可解码 | 编码层 PASS；内容层仍损坏 |
| U+FFFD / `???` | 未见 | — |

**MARKDOWN STRUCTURE VALID: NO**（fence 与标识符损坏）。  
**CONTROL CHARACTERS FOUND: YES**  
是否影响阅读：**是**（主链代码块与关键 API 名不可靠）。

`CONTEXT_PRIOR.md` / Index：抽样为正常 UTF-8 中文 Markdown。

---

## 15. Cross References

| 问题 | 说明 |
|------|------|
| DOMAIN_RECALL → CONTEXT_PRIOR | 指向正确文件，但**语义过时**（仍写 soft multiplier） |
| CONTEXT_PRIOR → Runtime_SSOT | 路径正确 |
| Index → Runtime_SSOT | 正确 |
| DSU → domain-rerank.ts | **死链/死文件** |
| FROZEN_V1_2 → kenlm/KENLM_RUNTIME.md | 路径存在；内容未同步跨桶 |
| Runtime_SSOT Index 链接 | 使用裸 `[RUNTIME_DOMAIN…]`（缺 `` ` ``）— 次要格式问题 |
| 无恶性循环引用 | Index ↔ Freeze 单向为主 |

---

## 16. Required Repairs（仅文档组织/表述；本轮不执行）

1. 清洗 Runtime_SSOT：去除 BEL/FF/TAB；修复全部 ` ```text ` fence 与函数名。  
2. 拆分 Runtime_SSOT §23：Integration / Quality / Known Risk。  
3. 降级 FROZEN_V1_2 / ARCHITECTURE / DSU Vote·ReRank 段：SUPERSEDED 或改写为引用 Runtime SSOT。  
4. 修正 DOMAIN_RECALL 页眉与残留 ReRank/Shadow 语言。  
5. 更新 KENLM_RUNTIME 调用链含 `prefilledCombinations`。  
6. 强化 GATE-DOC-SSOT：禁止控制字符；校验 fence；可选校验兄弟文档不得声称 Shadow Beam 现役。  
7. Legacy 正文过期指标加 “superseded by Minimal Repair Report” 提示（保留 CORRECTION）。

---

## 17. Suggested Repair Order

1. Runtime_SSOT 控制字符 + fence + KenLM 状态拆分（最高优先）  
2. DOMAIN_RECALL 页眉矛盾 + DSU 删 domain-rerank  
3. FROZEN_V1_2 / ARCHITECTURE Shadow 残留  
4. KENLM_RUNTIME 跨桶接线  
5. 门禁加强  
6. 历史报告正文提示（低优先）

---

## 18. Target List

- [ ] Sanitize `Runtime_SSOT_Contract_Freeze.md`  
- [ ] Split KenLM Integration vs Quality in Freeze  
- [ ] Mark/trim outdated Assembly/DSU/ARCHITECTURE/Recall passages  
- [ ] Sync `KENLM_RUNTIME.md` call chain  
- [ ] Strengthen `freeze-contract` doc gates  
- [ ] Clarify Index：sole Runtime Authority vs supporting freezes  

---

## 19. Check List

| 检查项 | 结果 |
|--------|------|
| A 文档落后源码 | **YES**（DSU/Recall/Assembly/Architecture/KenLM_RUNTIME；SSOT 语义好但损坏） |
| B 多文档定义同一主链 | **YES** |
| C Runtime_SSOT 章节完整 | 语义基本完整；损坏与过述 |
| D Integration 误写 Quality PASS | **YES** |
| E Open Risks | 部分合理；缺 Top1/MISRANK/cold-start |
| F CONTEXT_PRIOR | **合规**；外溢在 DOMAIN_RECALL |
| G 执行报告误用 | 索引大体正确；正文/兄弟合同仍混用 |
| H 交叉引用错误 | **YES**（死路径/过时语义） |
| I 控制字符/Markdown | **YES / INVALID** |
| J 门禁不足 | **YES** |

---

## 20. Final Verdict

```text
SOLE RUNTIME AUTHORITY:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

```text
OUTDATED DOCUMENTS:
docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md (Vote/ReRank + domain-rerank.ts)
docs/fw-detector/recall/DOMAIN_RECALL.md (header + residual ReRank/Shadow language)
docs/fw-detector/assembly/FROZEN_V1_2.md (Shadow interfaces / dual Vote)
docs/fw-detector/ARCHITECTURE.md (Shadow Beam + domain-rerank)
docs/fw-detector/kenlm/KENLM_RUNTIME.md (missing prefilledCombinations / cross-bucket pool)
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md (control-char / fence corruption; overstated KenLM PASS)
docs/tone-v2/Legacy_Domain_Logic_Removal_and_Real_Dialogue_Multi_Bucket_Acceptance_Report.md (body PASS metrics superseded; header CORRECTION OK)
```

```text
DUPLICATE CONTRACTS:
Runtime_SSOT_Contract_Freeze.md (keep as sole Runtime main-chain contract)
FROZEN_V1_2.md (should be Assembly detail + cite SSOT only)
DOMAIN_RECALL.md (should be Recall detail + cite SSOT for Vote)
DOMAIN_SOURCE_UNIFICATION.md (should be Registry/Scope only; Vote/ReRank stale)
ARCHITECTURE.md (overview stale; not a parallel freeze)
Development/Acceptance reports (execution records, not contracts)
```

```text
EXECUTION REPORTS MISUSED AS CONTRACT:
NO
```

（索引层大体正确；风险在过时冻结文档与 SSOT 过述，而非把 Development Report 升格为 Authority。）

```text
KENLM INTEGRATION VS QUALITY MIXED:
YES
```

```text
CONTROL CHARACTERS FOUND:
YES
```

```text
MARKDOWN STRUCTURE VALID:
NO
```

```text
DOCUMENT RESPONSIBILITY CLEAR:
NO
```

```text
REPAIR READY:
YES
```

```text
FINAL VERDICT:
FAIL
```

---

### freeze-contract.test.ts 门禁缺口（J）

现有 GATE-DOC-SSOT 覆盖：存在性、UTF-8 fatal、U+FFFD、`???`、平行文件名、若干关键词。

**缺失：**

- 禁止 C0 控制字符（BEL/FF 等；TAB 在 fence 外策略）  
- 校验 ` ```text ` / ` ``` ` fence 成对且不被 TAB 污染  
- 关键 API 字面量完整（`allocateDomainBucketSentenceBudget`、`fw-detector-v4-path`、`applied:false`）  
- Integration vs Quality 分字段（禁止单独 `REAL KENLM ACCEPTANCE: PASS` 而无 Quality/Risk）  
- 可选：权威兄弟文档不得再声称 `domain-rerank.ts` 现役 / Shadow Beam 进主链  

---

RUNTIME DOMAIN DOCUMENTATION COMPLIANCE AUDIT COMPLETE — STOP
