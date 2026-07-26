# Runtime SSOT Recovery Baseline Consistency Audit

```text
STATUS: ACCEPTED BASELINE AUDIT

Accepted evidence that R2 rollback restored a trustworthy baseline.
Final architecture authority is Runtime_SSOT_Contract_Freeze.md (Runtime SSOT Contract V1).
```

| 字段 | 值 |
|------|-----|
| Document Status | **ACCEPTED BASELINE AUDIT** |
| 任务 | Runtime SSOT Recovery Baseline Consistency Audit |
| 性质 | 独立、只读、回滚后基线审计 |
| 日期 | 2026-07-19 |
| 证据优先级 | 冻结架构文档 → 签核合同 → Git/diff → 真实代码 → 正式测试 → Runtime smoke → 回滚计划/报告（仅声明） |
| 禁止 | 修改代码/测试/配置/SQLite/Lexicon/DTO；自动修复；以 Recovery Report 单独判 PASS |

---

## 1. Executive Verdict

R2 Partial Rollback **在 Multi-Domain 错误算法层面真实完成**：Vote 均分、`selectedDomain` 多副本、Assembly/Shadow `domains[]` 扩散、错误测试均已清除；CFG-01 `recallDomainScope` **未误回滚**；Lexicon v10 checksum **与冻结期望一致且未被本轮改写**。

残留为 **已知 P2 债务**（`domains[0]` / sameDomain 单值）与 **少量越界/工作区噪音**（tone 字段清理、`freeze-contract` 与 Multi-Domain 无关的 2 项失败、Draft 措辞把债务写成“membership”）。

**主结论：B** — 回滚基本完成，仅有不阻断后续 Membership Repair 开票的文档/诊断/无关契约测试问题；**不得**仅凭 Recovery Report 升级 Freeze，须先修订 Draft 措辞并人工签核。

---

## 2. 审计基线

### 2.1 恢复目标架构（本轮对照用）

```text
term + term_domain_tags
        ↓
domain_lexicon / domain_hierarchy
        ↓
recallDomainScope
        ↓
Hotword.domains[] / domainWeights
        ↓
WindowCandidate.domainId          ← domains[0] = 已知遗留债务（非正式 Multi-Domain）
        ↓
UtteranceDomainVoteResult
        ↓
sameDomain + base (+ frozen fallback)
        ↓
SpanReplacementPick（文本合同）
        ↓
Sentence Assembly → KenLM（纯文本）
```

### 2.2 冻结文档实际路径

| 文档 | 路径 | 状态 |
|------|------|------|
| DSU | `docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md` | 已读（工作区有未提交修改，属更早 CFG/DSU 工作） |
| Domain Recall | `docs/fw-detector/recall/DOMAIN_RECALL.md` | 已读 |
| Context Prior | `docs/fw-detector/CONTEXT_PRIOR.md` | 已读 |
| Assembly Freeze | `docs/fw-detector/assembly/FROZEN_V1_2.md` | 已读 |
| Lexicon Domain Freeze | `docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md` | Frozen |
| Runtime SSOT Freeze | `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` | **Draft** |
| Deviation Audit | `docs/tone-v2/Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md` | 参考 |
| Recovery Report | `docs/tone-v2/Runtime_SSOT_Recovery_Report.md` | **仅执行声明，不作唯一事实** |

### 2.3 合同测试实际路径

| Suite | 路径 |
|-------|------|
| freeze-contract | `electron_node/electron-node/main/src/fw-detector/freeze-contract.test.ts` |
| recall-scope-wiring | `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/recall-scope-wiring.test.ts` |
| assemble-domain-aware | `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.test.ts` |
| candidate-score | `electron_node/electron-node/main/src/lexicon/candidate-score.test.ts` |
| recall-span-topk-v2/v3 | `electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.test.ts` · `recall-span-topkv3.test.ts` |
| build-sentence-candidates | `electron_node/electron-node/main/src/fw-detector/build-sentence-candidates.test.ts` |
| domain-rerank | `electron_node/electron-node/main/src/fw-detector/span-assembly-shared/domain-rerank.test.ts` |

错误测试确认不存在：`multi-domain-candidate-contract.test.ts`、`multi-domain-live-bundle.test.ts`、`candidate-domains.ts`。

---

## 3. Git 工作区状态

### 3.1 概览

工作区仍有大量未提交变更（tone-v2 文档、CFG-01/span-assembly、Lexicon v7→v10 相对 HEAD、experiments、tone_module 等）。**不能**把整个 dirty tree 当成“仅 R2”。

相对 `HEAD`，与本审计强相关的源码 diff 集中在：

* `utterance-domain-vote.ts`、`recall-topk-for-windows.ts`、`v4-types.ts`、`span-assembly-v4-orchestrator.ts`、`fw-detector/types.ts`
* `hotword-types.ts`、`lexicon-runtime-v2.ts`、`candidate-score.ts`、`local-span-recall.ts` 等
* 删除：`apply-tone-assembly-guard.ts`、`filter-domain-candidates-per-span.ts`、`ranking-repair.test.ts`（属更早 span-assembly 清理，非本轮 Multi-Domain 专属）

### 3.2 变更分类

| 类 | 项 | 判定 |
|----|-----|------|
| **A. 合法保留** | Hotword `domains[]` + `domainWeights`；`lexicon-runtime-v2` merge union + `localeCompare` 排序；CFG-01 `recallDomainScope` / empty-scope throw；Vote `winnerScore`/`voteMargin` 诊断字段 | A |
| **B. 合法回滚** | Vote 去均分；WindowCandidate/Graph/Parent/Shadow 回 `domainId`；Assembly pick 去 `domains`/`selectedDomain`；删除 `candidate-domains` 与 multi-domain 假阳性测试；sameDomain `domainId === winner` | B |
| **C. 错误逻辑残留** | Vote `/domains.length`、`filterEligibleDomainsByCoarse`、`selectedDomain` 业务副本、Assembly 完整 domains | **未发现** |
| **D. 误回滚** | CFG-01 recallDomainScope / resolveRecallScope / GATE-DSU\* | **未发现** |
| **E. 新增越界修改** | `recall-topk-for-windows.ts` 去掉 `tone.recallToneIncompatibleCount = …`（无独立冻结依据） | E · OUT-OF-SCOPE |
| **F. 无法归属 / 工作区噪音** | `freeze-contract` GATE-INT-2 / CLEANUP-2 失败；大量 tone-v2 历史报告；profile-registry / fw docs 修改；相对 git HEAD 的 Lexicon v7→v10（属 Lexicon 冻结工作，非 R2 改包） | F |

### 3.3 Lexicon Bundle（相对冻结期望）

| 项 | 值 |
|----|-----|
| 工作区 `checksum.txt` | `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| `lexicon.sqlite` SHA256 | **相同** |
| `bundleVersion` | **10** · `lastPatchId=lexicon-domain-hierarchy-completion-v1` |
| vs git HEAD | HEAD 仍为 v7（旧）；工作区为 Lexicon 冻结基线 v10 |
| R2 是否改写 sqlite | **否**（哈希与 Lexicon Domain Freeze 期望一致） |

**LEXICON V10（相对冻结基线）：UNCHANGED**

---

## 4. 回滚前后架构对照

| 层 | 错误 Multi-Domain 开发态 | 当前回滚后 | 冻结目标 |
|----|-------------------------|------------|----------|
| Hotword | `domains[]` + 常带 `domain` 镜像 | `domains[]` only | 允许 `domains[]`/`domainWeights` |
| Candidate | `domains[]` / `selectedDomain` | `domainId`（=`domains?.[0]`） | 单值债务可暂留 |
| Vote | `/domains.length` 均分 + 多域遍历 | 只读 `candidate.domainId` | 禁止均分 |
| sameDomain | `includes` | `domainId === winner` | R2 允许债务 |
| Assembly Pick | domains / selectedDomain | 文本字段；`domainId` 仅在 DomainAware 中间态 | 文本合同 |
| KenLM | 曾风险带 metadata | 纯文本 `combinations[].text` | 纯文本 |
| Shadow | 曾迁移 domains 合同 | `domainId`；不进 KenLM `spanSets` | diagnostics only |

---

## 5. 冻结设计一致性

| 冻结点 | 代码结论 |
|--------|----------|
| DSU：`recallDomainScope` 唯一 Domain Lookup 输入 | **一致**（orchestrator + GATE-DSU-2b PASS） |
| CONTEXT_PRIOR：Vote 后 soft demotion | **一致**（`applyDomainVoteToEdges` ×0.3；无 coarse∩domains hard filter） |
| DOMAIN_RECALL：DomainWeight 公式 | **未落地**（P2 既有 DRIFT，非 R2 引入） |
| FROZEN_V1_2：`spanSets = domainAwareSpanSets` | **一致**；KenLM 用 `domainAwareSpanSets` |
| FROZEN_V1_2 DomainAware 字段白名单 | 代码中间态仍有 `domainId`（供 sameDomain），转 `SpanReplacementPick` 时剥离 — **文档略严于代码中间态** |
| Lexicon Domain Contract：Base=空 tags | **一致**（Base 样例 `你好` domains=`[]`） |

---

## 6. Vote 残留

| 检查 | 结果 |
|------|------|
| `score/weight/total / domains.length` | **无**（全仓业务代码无匹配；仅注释声明禁止） |
| `addDomainsScore` / 均分等价 | **无** |
| Vote 证据单元 | `candidate.domainId` / `evidence.domainId` / `edge.domainId` |
| 遍历 `candidate.domains[]` 投票 | **无** |
| `filterEligibleDomainsByCoarse` | **无** |

**Vote 残留：NONE（错误算法）**

REBUILD 相对纯 HEAD 差异（合法/需标注）：

* 平票 `localeCompare` 稳定排序
* `winnerScore` / `runnerUp*` / `voteMargin`（CFG-01 metrics）

---

## 7. DTO 残留

### 7.1 Hotword

* 允许：`domains?`、`domainWeights?`
* `domain` / `primaryDomain` / `selectedDomain`：**类型上未复活**
* `patch-recall-smoke.ts` 的 `RecallSmokeRow.domain?`：**类型残留**（映射已写 `domains`）→ P1 诊断噪音

### 7.2 WindowCandidate（v4）

* 正式字段：`domainId?`
* 不存在：`domains[]`、`selectedDomain`、`candidateDomains`、`votedFineDomain`、`validatedCoarseDomain`
* 唯一压缩写点：`recall-topk-for-windows.ts` → `hit.hotword.domains?.[0]`

### 7.3 Vote Result

* 句级决策 owner：`UtteranceDomainVoteResult.utteranceDomain`
* 诊断：`domainScores`、`winnerScore`、`voteMargin` 等 — **不独立改写 winner**
* 注意：orchestrator 另有 `shadowVote`（证据边路径）与 `domainAssembly.vote`（主链 pool 路径）两份结果；**KenLM/Apply 使用 `domainAssembly.vote` / `domainAwareSpanSets`**，Shadow 不覆盖正式 winner

### 7.4 SpanReplacementPick

* 正式字段：`span/word/source/priorScore/repairTarget/candidateScore`（+ 可选 window 元数据类型位）
* 重建后 dist：**无 `domainId`/`domains`/`selectedDomain`**
* DomainAware 中间态可持 `domainId` 供 sameDomain，**不进入 KenLM pick**

### 7.5 KenLM

* 输入：`SentenceCombination.text` 纯文本
* Electron pipeline smoke：`KenLM_input_texts=["我要少糖中杯"]`，pick keys 无 domain metadata

---

## 8. Decision SSOT

| 问题 | 判定 |
|------|------|
| 多业务 `selectedDomain` 副本 | **无** |
| 主链唯一句级域 | `domainAssembly.vote.utteranceDomain` |
| Shadow 二次 Vote 是否覆盖 Apply | **否**（`fw-detector-v4-path` KenLM/Apply 使用 `assemblyResult.spanSets`） |
| Decision SSOT | **PASS**（主链） |

---

## 9. Assembly 边界

| 问题 | 答案 |
|------|------|
| 是否读取完整 Lexicon domains？ | **否**（只读 Candidate.`domainId`） |
| 是否写 selectedDomain？ | **否** |
| 是否重新执行 sameDomain？ | **是**，且 **仅在 Vote 之后**（`filterDomainCandidatesPerSpan`） |
| 是否自己解释 coarse domain？ | **否** |
| 是否按 domain 复制 Candidate？ | **否** |
| 是否因 domain metadata 生成重复句？ | **否**（未见 domains 复制扩张） |
| Sentence cap ≤16 | **是**（`maxSentenceCandidates` 默认 16；freeze GATE 与 config 一致） |

**ASSEMBLY BOUNDARY：PASS**

---

## 10. sameDomain 状态

```text
candidate.domainId === winningDomain
```

* 执行时机：Vote 后分桶
* base：`graphSource === 'base_term'` 独立
* `insufficientEvidence` / `utteranceDomain==='general'` → fallback 桶（冻结行为）
* 无 Vote 前分桶；无 Candidate 自带 selectedDomain 入桶

**属 R2 目标内 P2 债务，非本轮失败。**

---

## 11. Recall Scope / CFG-01

| 检查 | 结果 |
|------|------|
| `recallDomainScope` 唯一 Lookup 输入 | **PASS** |
| orchestrator 空 scope throw（不静默 Base-only） | **PASS** |
| `resolveRecallScope` 仍由 top orchestrator 调用 | **PASS** |
| GATE-DSU-1..5 / GATE-CP-01.. 子集 | **PASS**（10/10） |
| profile-registry 作 Runtime Domain SSOT | **未回归**（GATE-DSU-1/5） |
| 误回滚 CFG-01 | **否** |

**CFG-01 / RECALL SCOPE：PASS**

---

## 12. Lexicon Recall

| 检查 | 结果 |
|------|------|
| `mergeDomainTierRows` union 全部 domains | **是** |
| domains 稳定 `localeCompare` 排序 | **是** |
| `domainWeights` 按 domain 键合并 | **是** |
| 去掉 `Hotword.domain` 后调用方 | `recall-topk` 已改为仅 `domains?.[0]`；配套 candidate-score/local-span 已跟 |
| fallback 旧 `hotword.domain` | **无** |
| Base = 空 domains | **是**（`你好`） |
| 伪造 `general` 为 fine tag | SQL/Hotword 样例未见；Vote 忽略 `domainId==='general'` |
| Recall 层 Vote / selectedDomain | **无** |

Electron 固定样例见 §18。

---

## 13. Shadow Beam

| 检查 | 结果 |
|------|------|
| Shadow DTO | 单 `domainId` |
| `domains[]` / `selectedDomain` | **无** |
| 进 KenLM / Apply | **否**（`spanSets=domainAwareSpanSets`；shadow 仅 `shadowBeam*`） |
| 影响主链 Vote winner | **否** |
| 本轮新增 Shadow 功能 | **否** |
| 仍仅 diagnostics | **是**（未删除，属 P2） |

**SHADOW MAIN-CHAIN ISOLATION：PASS**

---

## 14. general / Base

| 规则 | 状态 |
|------|------|
| Base = domains empty | **确认** |
| `domains=["general"]` / Candidate `domainId=general` 作 fine | **未作为 Lexicon fine 写入样例** |
| `utteranceDomain='general'` = insufficientEvidence | **保留** |
| general 进 sameDomain fine | Vote `addDomainScore` 跳过 general |

---

## 15. 人工 REBUILD 文件三方对比

### 15.1 `utterance-domain-vote.ts`

| vs HEAD | 一致/差异 |
|---------|-----------|
| 单 `domainId` 计分 | 一致（错误均分未进入 HEAD） |
| winner 诊断字段 + 平票排序 | **相对 HEAD 新增**（CFG metrics KEEP） |
| vs 错误 Multi-Domain 版 | 无 `/domains.length`、无 domains 遍历 |

### 15.2 `v4-types.ts`

| | |
|--|--|
| WindowCandidate | 回 `domainId` |
| metrics 扩展 | 对齐 CFG-01 orchestrator（合法 REBUILD） |

### 15.3 `recall-topk-for-windows.ts`

| | |
|--|--|
| `domainId = domains?.[0]` | 合法债务回潮（去 `hotword.domain`） |
| 去掉 `tone.recallToneIncompatibleCount` 写 | **OUT-OF-SCOPE CHANGE**（无独立冻结依据） |

### 15.4 `span-assembly-v4-orchestrator.ts`

| | |
|--|--|
| `recallDomainScope` | **保留** |
| voteEligible / 主链 | 回 `domainId` |
| Shadow 并行 | 保留，不接 KenLM |

### 15.5 `fw-detector/types.ts`

| | |
|--|--|
| 去掉 selectedDomain/candidateDomains 等 | 合法 |
| 其它诊断扩展 | 属 CFG 工作区，非 Multi-Domain 残留 |

---

## 16. 测试有效性

### 16.1 命令结果

| 命令 | 结果 |
|------|------|
| `tsc -p tsconfig.main.json --noEmit` | **PASS** |
| assemble-domain-aware / recall-scope-wiring / candidate-score / recall-span-topk-v2/v3 / build-sentence-candidates / domain-rerank | **PASS** |
| freeze-contract 全量 | **FAIL** · 2 tests |
| freeze-contract `-t "GATE-DSU\|GATE-CP"` | **PASS** · 10 tests |

### 16.2 freeze-contract 失败归属（非 Multi-Domain 残留）

1. **GATE-INT-2**：期望 `windowSource: pick.windowSource` 等传播；**当前与 git HEAD 的 `window-candidate-to-pick.ts` 均无该传播** — 属工作区测试加严与代码未对齐，**不是** Vote 均分残留。  
2. **CLEANUP-2**：期望兼容图 metrics 无 `hardDropCount` 字符串；代码仍保留 `hardDropCount: 0` stub — CFG cleanup 未完成，**非** R2 引入。

### 16.3 ABI 规则

* 系统 Node（MODULE 137）加载 better-sqlite3（MODULE 119）→ **失败**  
* **Electron 28 ABI** → **成功**  
* 未将 Node ABI 失败 skip 成 PASS

### 16.4 迁就测试

* multi-domain 假阳性测试：**已删除**  
* 现有 assemble 测试未把 `domains[0]` 宣称为未来正式设计（亦未显式标 `known debt` — 文档建议补标，非本轮改测试）

---

## 17. ABI Runtime Smoke

环境：`npx electron` + 重建后 `dist` + `node_runtime/lexicon/v3`。

| # | 验证项 | 结果 |
|---|--------|------|
| 1 | LexiconRuntimeV2 启动 | **PASS** |
| 2 | 正式 lexicon.sqlite 加载 | **PASS**（v10） |
| 3 | recallDomainScope 输入 | **PASS**（合同测试 + orchestrator 代码） |
| 4 | Domain Recall | **PASS** |
| 5 | Base Recall | **PASS**（`你好`） |
| 6 | multi-domain Hotword union | **PASS**（多 tag 词 domains 全量 + 稳定序） |
| 7 | WindowCandidate.domainId | **DEBT 投影** `domains[0]` |
| 8 | Vote | **PASS**（合成句 winner=`coffee`） |
| 9 | sameDomain bucket | **PASS**（sameDomainCount=2） |
| 10 | Sentence Assembly → KenLM 文本 | **PASS**（cap 内；无 domains metadata） |

**注意：** 审计过程中曾发现 **过期 dist** 仍把 `domainId` 写入 Pick；`npm run build:main` 后消失。基线可运行性以 **源码 + 重建 dist** 为准。

**RUNTIME ABI ACCEPTANCE：PASS**

---

## 18. 固定样例 Trace

审计目的：确认 **多领域事实只在 Hotword 保留**；压缩仅发生在 `domains[0]` 债务边界；之后无 `domains[]` 扩散。

| sample | DB tags | Hotword.domains | WindowCandidate.domainId（债务） | 说明 |
|--------|---------|-----------------|----------------------------------|------|
| 预订 | food_order, tourism_hotel, tourism_route, transport | 同左（排序） | food_order | 多域保留在 Hotword |
| 少糖 | coffee, food_order, milk_tea | 同左 | coffee | 同上 |
| 中杯 | coffee, food_order, milk_tea | 同左 | coffee | 同上 |
| 菜单 | bakery, coffee, food_order, milk_tea | 同左 | bakery | 同上 |
| 接送 | tourism_pickup, tourism_transport | 同左 | tourism_pickup | 同上 |
| 机场 | tourism_transport, transport | 同左 | tourism_transport | 同上 |
| 你好（Base） | [] | [] | undefined | Base 空域 |

合成句 `我要少糖中杯`（重建 dist）：

| 字段 | 值 |
|------|-----|
| Vote evidence domainId | coffee（来自债务投影） |
| Utterance winner | coffee |
| sameDomain | 2 candidates |
| Base | 0 |
| Sentence candidate count | 1 |
| KenLM input text | `我要少糖中杯` |
| Pick 是否含 domains | **否** |

无 domain evidence / general fallback：由 Vote `MIN_EVIDENCE_SCORE` + `utteranceDomain='general'` 代码路径覆盖（本 smoke 未另造空证据句；行为与冻结一致）。

---

## 19. 错误残留列表

* **无** Vote 均分  
* **无** selectedDomain 多 Decision owner  
* **无** Assembly 完整 domains  
* **无** Coarse hard filter on domains[]  
* **无** Shadow 主链接管  
* **无** 错误 multi-domain 测试残留  

---

## 20. 误回滚列表

* CFG-01 / `recallDomainScope`：**无误回滚**  
* Lexicon Hotword union：**无误回滚**  
* windowSource 传播：HEAD 本就未传播；失败来自测试加严，**不记为 CFG-01 MIS-ROLLBACK**

---

## 21. 越界修改列表

| 项 | 分级 |
|----|------|
| `tone.recallToneIncompatibleCount` 赋值删除 | **OUT-OF-SCOPE** · P1 |
| Vote 平票 localeCompare + margin 字段 | CFG metrics KEEP · 标注 REBUILD，非错误算法 |
| 过期 dist（已通过 rebuild 消除） | 过程风险 · 提醒 |

---

## 22. P0 / P1 / P2 分类

### P0 BLOCKER

* **无**（相对 R2 Multi-Domain 错误算法目标）

### P1 MAJOR

* Draft 将 `domainId` 表述为“membership 压缩结果” — **措辞不当**，易被误读为正式 membership  
* `recall-topk` tone 字段越界清理  
* `freeze-contract` GATE-INT-2 / CLEANUP-2 工作区不一致（非 Multi-Domain，但阻碍“全绿冻结门禁”叙事）  
* `patch-recall-smoke` 类型字段 `domain?` 残留  

### P2 KNOWN DEBT

* `domainId = domains?.[0]`  
* sameDomain `domainId === winner`  
* DomainWeight 未落地  
* Shadow 未删除（仅隔离）  
* parent_fragment 重复计分等既有问题（本轮未扩审计）

---

## 23. Freeze 文档修订建议

文件：`docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`（本轮 **不修改**）

建议将：

```text
WindowCandidate 可持 membership 压缩结果 domainId
```

改为：

```text
WindowCandidate.domainId 是开发前遗留单值投影（通常 = Hotword.domains?.[0]），
仅作为当前可运行基线，
不是完整 membership，
不是未来正式 Multi-Domain Contract。
```

其它建议：

* Status：在人工签核前保持 Draft；签核后改为 FROZEN  
* 明确 DomainAware 中间态可临时持 `domainId`，但 `SpanReplacementPick`/KenLM 禁止  
* 标明双 Vote（主链 pool vs Shadow evidence）时，**Apply/KenLM 只认主链**

---

## 24. 是否可冻结

| 问题 | 答案 |
|------|------|
| 当前代码能否作 Membership Repair 可信基线？ | **能**（Multi-Domain 错误算法已清；债务边界清晰） |
| Draft → FROZEN 立即升级？ | **否** — 先修订措辞 + 人工确认；建议处理或显式豁免无关 freeze-contract 失败 |

**SSOT FREEZE：REJECT**（拒立即升级；非拒回滚基线）

---

## 25. 后续动作

1. 人工修订 `Runtime_SSOT_Contract_Freeze.md` 措辞后签核  
2. 另开票：**Membership Repair**（禁止合并 Vote 公式大改）  
3. 另开票：Vote Semantics / DomainWeight（对照 DOMAIN_RECALL）  
4. 可选：清理 OUT-OF-SCOPE tone 字段变更归属或回补依据  
5. **禁止**本审计后自动开修  

---

## 26. Target List（若需清理 — 仅列出，本轮不改）

| 目标 | 说明 |
|------|------|
| `Runtime_SSOT_Contract_Freeze.md` §2 Candidate 行 | 修订 membership 措辞 |
| `recall-topk-for-windows.ts` tone 行 | 确认是否保留越界删除 |
| `patch-recall-smoke.ts` `domain?` | 类型对齐 `domains` |
| `freeze-contract.test.ts` GATE-INT-2 / CLEANUP-2 | 与代码或 CFG 工作对齐（独立票） |

---

## 27. Check List

- [x] 冻结文档与合同测试路径核实  
- [x] Git 分类 A–F  
- [x] 错误算法模式搜索 + 语义判断  
- [x] DTO / Decision / Assembly / sameDomain / CFG-01 / Lexicon / Shadow / general  
- [x] REBUILD 文件对照  
- [x] tsc + 指定测试 + ABI Electron smoke  
- [x] 固定样例 Trace  
- [x] P0/P1/P2 与强制结论块  
- [x] 停止：无自动修复 / 无提交 / 无 Membership 开工  

---

## 强制最终结论

```text
PRIMARY VERDICT:
B
```

```text
ROLLBACK BASELINE:
PASS
```

```text
RUNTIME ABI ACCEPTANCE:
PASS
```

```text
LEXICON V10:
UNCHANGED
```

```text
CFG-01 / RECALL SCOPE:
PASS
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
ERROR LOGIC RESIDUE:
NONE
```

```text
SSOT FREEZE:
REJECT
```

```text
NEXT ACTION:
BASELINE AUDIT COMPLETE — STOP
```

---

```text
BASELINE AUDIT COMPLETE — STOP
```
