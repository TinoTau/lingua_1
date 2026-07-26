# Fine-Span Presence Vote Runtime Compliance and Runtime Domain SSOT Documentation Repair Audit

| 字段 | 值 |
|------|-----|
| Status | **AUDIT COMPLETE — NO CODE/DOC FIX APPLIED** |
| Date | 2026-07-19 |
| Nature | 只读代码审计 + 只读文档审计 + 失败样本证据 + 修复方案设计 |
| Lexicon | v10 · `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| HEAD | `262b3d32717db97807fa48103aa44f1ea518361a` (`stable version`) |

---

## 1. Executive Verdict

正式运行主链确已收敛为 **唯一 Fine-Span Presence Vote → Multi-Bucket Assembly → 跨桶合并候选池 → KenLM rerank**；`VoteMass` / Graph Vote / Domain Rerank / Shadow Beam 生产决策路径已删除。

但上一轮验收报告把 **KenLM INCONCLUSIVE** 与 **REAL DIALOGUE QUALITY** 一并标成 **PASS** 不成立；`Runtime_SSOT_Contract_Freeze.md` **仓库文件本身编码损坏**（非仅显示问题）；`BUCKET_BUDGET_DROP` / `DOMAIN_VOTE_DROP` 均可复现且根因可分类。

**FINAL AUDIT VERDICT: PARTIAL PASS**

---

## 2. Git 状态

| 项 | 值 |
|----|-----|
| 分支 | `main` · 跟踪 `origin/main` |
| HEAD | `262b3d3` |
| 相对 remote | 工作树极脏（大量未提交 fw-detector / tone / lexicon / docs） |
| `Runtime_SSOT_Contract_Freeze.md` | **未跟踪 `??`** · 工作区存在 · **非有效 UTF-8** |
| `Runtime_SSOT_Contract_Freeze(2).md` | **不存在**（本仓库无此文件；无 Git 历史） |
| 二者内容比较 | 不适用（仅一份损坏文件） |
| 本轮 | **未** `reset` / `checkout` / `clean` / 改编码 |

关键未提交相关：Presence Vote / multi-bucket / legacy deletion / 验收脚本与报告 / 文档索引。

---

## 3. 审计范围

- 正式入口：`fw-detector-step` → orchestrator → v4 path → span-assembly-v4 → KenLM
- Vote / FineSpanDomainSet / retainedDomains / budget / merge
- 失败样本：`acc-taxi-01` · `acc-hotel-02` · `acc-travel-asr-03`
- Lexicon v10 `term_domain_tags` 只读查询
- Runtime Domain 文档索引与冻结合同编码
- **禁止**：改代码 / 配置 / 词库 / 测试数据 / 冻结文档 / 索引

---

## 4. 正式 Runtime 入口

```text
pipeline/steps/fw-detector-step.ts::runFwDetectorStep
  → fw-detector-orchestrator.ts::runFwDetectorOrchestrator
    → resolveKenlmRuntime (enableKenLMGate；可被 job override)
    → fw-detector-v4-path.ts::runFwDetectorV4Path
      → createKenlmBatchScorer() 当 enableKenLMGate
      → span-assembly-v4-orchestrator.ts::runSpanAssemblyV4Orchestrator
      → kenlm/run-fw-sentence-rerank-from-prefilled.ts
        → rerank-fw-sentences.ts::rerankFwSentences
```

Feature flag：`features.fwDetector` / `enableKenLMGate`（默认 true，可 override）。  
Fallback：无 span → 不 rerank；`scorer=null` → 保持 raw、不替换。

---

## 5. 完整调用链

```text
runFwDetectorStep
  └─ runFwDetectorOrchestrator
       └─ runFwDetectorV4Path
            ├─ runSpanAssemblyV4Orchestrator
            │    ├─ partition / windows / recallTopKForWindows
            │    │    └─ Hotword.domains[] → WindowCandidate.domains[]
            │    ├─ resolveCompatibilityRelations
            │    ├─ runDomainAwareAssembly
            │    │    ├─ buildFineSpanCandidatePool (按 coarse/fine span 归属)
            │    │    ├─ voteUtteranceDomainFromPool
            │    │    │    └─ buildFineSpanDomainSet → accumulateSpanDomainSets
            │    │    │         → selectRetainedDomains (0.75 / tie)
            │    │    └─ per retainedDomain: filterDomainCandidatesPerSpan
            │    │         + Base → assembleDomainAwareSpanSets
            │    ├─ allocateDomainBucketSentenceBudget(floor(16/n))
            │    ├─ per bucket: buildSentenceCandidates(..., perBucketCap)
            │    └─ mergeByText → sort candidateScore → slice(0,16)
            │         = kenlmSentenceCandidates（跨桶单池）
            └─ runFwSentenceRerankFromPrefilled(kenlmScorer)
                 └─ rerankFwSentences：scoreBatch([raw,...texts])
                      选 max raw_log_delta ≥ minDeltaToReplace
```

验收 harness（`run-fine-span-domain-bucket-acceptance.cjs`）**只调用** `runSpanAssemblyV4Orchestrator`，**不**创建 KenLM scorer。

---

## 6. 唯一 Vote 检查

全仓生产路径仅：

| 符号 | 分类 |
|------|------|
| `voteUtteranceDomainFromPool` / `buildFineSpanDomainSet` | **正式主链** |
| `fine-span-domain-presence-vote.test.ts` 等 | 测试 |
| metrics `domainScores` / `retainedDomains` | 日志/诊断 |
| `tests/experiments/run-domain-vote-accuracy-revalidation.*` 中 `SOURCE_WEIGHT`/`VoteMass` | **实验脚本（非生产）** |
| 已删 `domain-rerank.ts` / graph `voteUtteranceDomain` | 死代码已移除 |
| `CompatibilityGraphEdge` | **非领域同名**（候选兼容图） |

确认：无第二套正式领域决策；无单 winner Assembly fallback；无 context prior 改 Vote；无 graph/parent 辅助领域决策进生产。

**FORMAL DOMAIN VOTE CHAINS: 1**

---

## 7. FineSpanDomainSet 实现

文件：`span-assembly-shared/utterance-domain-vote.ts`

1. 输入：每个 fine/coarse span 池内的 `PoolVoteCandidate[]`（来自 `buildFineSpanCandidatePool`）。
2. Span identity：orchestrator 按 coarse span 分桶；一池 = 一票集合。
3. 汇总：`buildFineSpanDomainSet` → `Set` 并集。
4. `domains[]`：`addDomainsToSet`，跳过空 / `general` / `base_term`。
5. Base：`isDomainVoteSource` 仅 `domain_term` | `passive_domain_weak`。
6. `isCovered`：跳过。
7. `passive_domain_weak`：可投票（与 domain_term 同等 presence）。
8. `parent_fragment`：见去重键。
9. `candidateId`：exact 去重键。
10. 同 `parentTermId`：见 §8。

---

## 8. 去重键分析

```text
parent_fragment + parentTermId → parent:{parentTermId}
else candidateId → id:{candidateId}
else exact:{syllableStart}:{syllableEnd}:{score}
```

- 不同自然语言 exact 候选（不同 `candidateId`）→ **保留**。
- 共享 `parentTermId` 的多个 parent_fragment → **只取第一个的 domains 并集贡献**（同 span 同领域仍最多 1 票；若后者 domains 更广，理论上可能丢标签 — 边缘风险，非本轮失败主因）。

**MULTIPLE CANDIDATES PER SPAN: PRESERVED**（exact 路径）；parent 路径为结构性去重。

---

## 9. 每 span 每 domain 一票证明

```text
Set 创建: buildFineSpanDomainSet → domainSet = new Set()
union: addDomainsToSet(domainSet, candidate.domains)  // Set 去重
累加: accumulateSpanDomainSets — 对每个 span 的 Set，每个 domain +1
span 边界: voteUtteranceDomainFromPool 的 for (spanPool of pool)
```

**不存在** Candidate 循环内直接 `domainScores++`。

**ONE SPAN ONE DOMAIN VOTE: PASS**

---

## 10. Base 排除

| 层 | 机制 |
|----|------|
| 数据 | `resolveGraphSource`：无 fine domains → `base_term` |
| 代码 Vote | `isDomainVoteSource` 排除非 domain/passive |
| Assembly | `isBaseCandidate`；Base 进入每桶但不进 Vote |

`source` 未设置 / `general` / literal：无 fine domains 时归 Base；有 tags 才 Vote。

**BASE VOTE EXCLUSION: PASS**（数据 + 代码双重）

---

## 11. retainedDomains 规则

```text
并列最高 → 保留全部 atMax
唯一最高 → count >= maxCount * 0.75
无票 → retained=[] / insufficientEvidence
```

`localeCompare` 仅排序，不删并列。`runnerUpCount` 缺省为 0。整数票 × 0.75 边界：用 `>=`。

**RETENTION RATIO IMPLEMENTATION: 0.75**  
**TIED MAX DOMAINS: ALL RETAINED**

---

## 12. 离散票型表（ratio=0.75）

| 票型 | 阈值 | retained |
|------|------|----------|
| 0 | — | [] |
| 1 vs 1 | tie | 两者 |
| 1 vs 1 vs 1 | tie | 三者 |
| 2 vs 1 | 1.5 | 仅 2 |
| 2 vs 2 | tie | 两者 |
| 3 vs 1 | 2.25 | 仅 3 |
| 3 vs 2 | 2.25 | 仅 3（2&lt;2.25） |
| 3 vs 3 | tie | 两者 |
| 4 vs 2 | 3 | 仅 4 |
| 4 vs 3 | 3 | 4 与 3 |
| 5 vs 3 | 3.75 | 仅 5 |
| 5 vs 4 | 3.75 | 5 与 4 |

`acc-taxi-01`：`2 vs 1` → 仅 `tourism_hotel` — **规则执行正确**。

---

## 13. DOMAIN_VOTE_DROP 证据链（acc-taxi-01）

| 项 | 值 |
|----|-----|
| asrRaw / expected | `师傅，去中关村软件园，走机场高速。我赶九点半的会，要是堵车您提前跟我说。` |
| expectedDomains | `tourism_transport`, `transport` |
| Lexicon checksum | 与报告一致 v10 |
| domainScores | `tourism_hotel:2`, `tourism_transport:1`, `transport:1`, `tech_ai:1` |
| retainedDomains | `["tourism_hotel"]` |
| domainVoteDrop | true |
| 正确句在池 | **true**（排名靠后，pre-LM Top 为「酒店半」） |

粗/细 span（复现）：`九点` 独立成 span；候选句出现 **「酒店半」** ← 拼音近音 `jiu|dian` 召回 **酒店**（`tourism_hotel`）。

词库：

| term | term_domain_tags |
|------|------------------|
| 九点半 | **无 term 行** |
| 酒店 | `tourism_hotel`（正确标签） |
| 机场 | `tourism_transport`, `transport` |
| 高速 | `tourism_transport` |
| 明天/早上 | tier=domain 但 **tags 空** → 运行时 Base |

**根因分类：`PINYIN_RECALL_NOISE`**（九点→酒店）  
叠加：错误领域票在 0.75 下合法淘汰正确域（**非** `VOTE_RULE_ERROR`）。  
`tourism_hotel=2`：至少一个 span 为「九点」上的酒店召回；第二票来自另一 fine span 的 hotel-tagged 召回（装配句面未必写出第二处「酒店」，但 Vote 计 presence）。非通用时间词 tags 污染（九点半无 tags）。

**DOMAIN_VOTE_DROP ROOT CAUSE: PINYIN_RECALL_NOISE**

---

## 14. 词库领域标签证据（摘要）

| term | tags | 备注 |
|------|------|------|
| 预订 | food_order, tourism_hotel, tourism_route, transport | **过宽多域** |
| 接送 | tourism_pickup, tourism_transport | 多域 |
| 早餐 | food_order, tourism_hotel | 双域 |
| 退房/酒店 | tourism_hotel | 合理 |
| 明天/早上/下午/通知/修改/安排 | tags 空 | 不进 Vote |
| 九点半/几点/确认/师傅 | 无 term 或不在 domain 表 | — |

原则：通用时间词当前多数无 tags；失败主因是 **近音领域词召回** 与 **预订类多标签**，不是「明天」误标。

---

## 15. BUCKET_BUDGET_DROP 样本一（acc-hotel-02）

| 项 | 值 |
|----|-----|
| expected | `早餐几点开始？退房可以延迟到下午两点吗？` |
| domainScores | food_order=1, tourism_hotel=1, medical=1, tech_ai=1（**四域并列**） |
| retained | 4 桶 |
| perBucketCap | floor(16/4)=**4** |
| bucket prod | 6+4+4+6=**20** |
| 池内句 | 5 条，**无** exact expected |
| 典型错误 | 机电/残疾/延赤道 |

根因组合：

- **B/C** 并列域过多（含 medical/tech_ai 噪声）
- **F** `floor(16/n)` 过小
- **E/H** 桶内按 `candidateScore` 偏好近音错误替换；正确句未进最终池
- **SPAN_BOUNDARY_ERROR**：粗 span `早餐几点开始？退` 等切分异常
- Harness 用 `prod>16 && !entered` 标记 BUDGET_DROP — **近似启发式**，不能单独证明「正确句被 cap 截掉」 vs 「从未生成」

---

## 16. BUCKET_BUDGET_DROP 样本二（acc-travel-asr-03）

| 项 | 值 |
|----|-----|
| expected | `我想改一下明天早上的预订时间然后确认接送` |
| domainScores | 7 域全 1（含 coffee 噪声） |
| retained | 7 桶 |
| perBucketCap | floor(16/7)=**2** |
| 池内 | 仅 2 句，均为错误替换（以下/世间/始建） |
| 词库 | **预订** 四域 tags → 强推并列 |

根因：**C LEXICON_MULTI_DOMAIN_TOO_BROAD** + **B 并列过多** + **F 配额过小** + 装配近音噪声。

**BUCKET_BUDGET_DROP ROOT CAUSE: MULTI_TIED_DOMAINS + FLOOR_16_N_CAP + LEXICON_MULTI_DOMAIN_TOO_BROAD (+ RANKING/SPAN NOISE)**

---

## 17. 每桶截断顺序

```text
for each bucket:
  buildSentenceCandidates(..., perBucketCap)  // 桶内 sort → dedup text → slice(cap)
then:
  mergeByText (保留更高 candidateScore)
  global sort → slice(0, 16)
```

---

## 18. merge 去重顺序

**先每桶截断，再跨桶 merge 去重。**  
多桶生成相同/近文本时，会在 **占用 per-bucket cap 之后** 才合并 → **浪费预算**。

**DUPLICATE TEXTS CONSUME PER-BUCKET BUDGET: YES**

---

## 19. KenLM 正式启动链

| 步骤 | 证据 |
|------|------|
| 创建 | `enableKenLMGate ? createKenlmBatchScorer() : null` |
| 模型 | `resolveCharLmModelPath` → 本机可解析到 `electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin` |
| query | Win 缺 `query.exe` 时走 **WSL** `kenLM/.../bin/query`（`shouldRunKenlmQueryViaWsl`） |
| IPC | stdin 批量 token 行 → `runKenlmQueryBatch` |
| 输入 | **纯句子字符串**（raw + candidates） |
| 失败 | `scoreAllZero` + fail-open；`scorer=null` 不替换 |

生产接线：**ACTIVE**（模型可解析、scorer 可创建；实际 spawn 依赖 WSL/query 可用性，fail-open）。

---

## 20. KenLM 测试缺口

Harness 明确：

```text
kenlmModel: NOT_INVOKED_IN_HARNESS
kenlmNote: Harness ranks pre-KenLM candidateScore pool
thisKenlmRan = false
```

上一轮报告写 INCONCLUSIVE 后仍标 **REAL DIALOGUE QUALITY: PASS** → **验收语义错误**。

**REAL KENLM ACCEPTANCE HARNESS: BYPASSED**  
**REAL KENLM TEST COVERAGE: FAIL**

---

## 21. 最终排序公式

```text
Assembly 池内预排序: candidateScore（组合分）
正式 KenLM:
  sentences = [rawText, ...candidateTexts]
  scoreBatch → raw log scores
  delta_i = score(candidate_i) - score(raw)
  pick = argmax delta_i  if delta_i >= minDeltaToReplace else raw
  scoreMode = raw_log_delta
```

无 domain / bucket priority 进入 KenLM。  
`normalizedScore` 仅诊断；Pick 用 raw delta。

**KENLM INPUT CONTAINS DOMAIN METADATA: NO**

---

## 22. 性能计时边界

验收 `ms`：仅包住 `runSpanAssemblyV4Orchestrator`（召回+Vote+Assembly+merge）。

**CURRENT LATENCY METRIC: PRE-KENLM**  
P50/P95/MAX 42/121/187 ms **不得**称为 end-to-end / total latency。

---

## 23. 残留类型和 stub

| 项 | 判定 |
|----|------|
| `ParentTermEvidence` / `ParentSpanCandidate` / `GraphEdge` / `CoarseSpanPath` in `types.ts` | **DELETE — DEAD TYPE**（生产不再构造；诊断 mapper 仍 import） |
| `v4-diagnostics-types` Graph/Parent trace | **KEEP — ACTIVE DIAGNOSTIC CONTRACT**（或随后收敛） |
| `context-prior.ts` stub · `applied:false` | **KEEP — ACTIVE DIAGNOSTIC CONTRACT** |
| `computeContextPriorMultiplier` | **DELETE — DEAD STUB**（已删决策实现） |
| `CompatibilityGraphEdge` | **KEEP — ACTIVE NON-DOMAIN FUNCTION** |
| 实验脚本 VoteMass | 非生产；可归档 |

建议删除清单（本轮不执行）：`types.ts` 中旧 Graph/Parent 生产类型（若诊断不再需要）；清理 `CONTEXT_PRIOR.md` 对已删 `domain-rerank.ts` 的引用。

---

## 24. 文档文件清单

| 文件 | 状态 |
|------|------|
| `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` | 未跟踪 · **编码损坏** |
| `Runtime_SSOT_Contract_Freeze(2).md` | **不存在** |
| `RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | 未跟踪 · UTF-8 正常 · 指向上述 Freeze |
| `Lexicon_Domain_Contract_Freeze_V1.md` | 可读 · 职责正确 |
| `DOMAIN_SOURCE_UNIFICATION.md` | 已修改 |
| `DOMAIN_RECALL.md` | 已修改 |
| `FROZEN_V1_2.md` | 已修改 |
| `CONTEXT_PRIOR.md` | **过时**（仍写 Domain ReRank / 已删路径） |
| Legacy Acceptance Report | 可读 · 含错误 PASS |

---

## 25. 编码检测

`Runtime_SSOT_Contract_Freeze.md`：

| 检测 | 结果 |
|------|------|
| UTF-8 严格解码 | **失败**（byte `0xB7` at pos 235，非法 UTF-8） |
| UTF-8 BOM | 无 |
| U+FFFD（replace 解码） | 有 |
| CJK 汉字数 | **0**（中文被写成 `??`） |
| 连续 `?` | 大量写入文件（非终端显示） |

**结论：仓库工作区文件本身损坏**（复制/错误转码写入），不是「仅导出乱码」。  
Git 无历史版本可恢复（文件从未 commit）。

**RUNTIME SSOT FILE ENCODING: CORRUPTED**  
**U+FFFD OR WRITTEN QUESTION-MARK CORRUPTION: PRESENT**

---

## 26. 权威文件唯一性

```text
AUTHORITATIVE FILE:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

- 索引唯一指向该路径  
- 无 `(2)` / Copy / Final / Latest 并行文件  
- **内容不可用** → 权威性在合同意义上 **FAIL**（路径唯一但正文损坏）

**DOCUMENT AUTHORITY UNIQUENESS: PASS**（路径层）  
**DOCUMENT CONTRACT CONSISTENCY: FAIL**（正文损坏 + CONTEXT_PRIOR 过时 + 验收 PASS 语义错误）

---

## 27. 文档职责冲突

| 文档 | 应有职责 | 现状 |
|------|----------|------|
| RUNTIME_DOMAIN_DOCUMENT_INDEX | 唯一索引 | OK |
| Runtime_SSOT_Contract_Freeze | Runtime 主链合同 | **损坏 · 缺完整章节** |
| Lexicon_Domain_Contract_Freeze_V1 | 词库合同 | OK |
| DSU / DOMAIN_RECALL / FROZEN_V1_2 | 来源/召回/装配 | 需与 Presence Vote 对齐引用 |
| CONTEXT_PRIOR | 边界：diagnostics-only | **仍描述已删 Rerank** |
| Development/Acceptance Reports | 执行记录 | Legacy 报告 **伪 PASS** |

建议：重复合同改为短引用 + Owner 链接；**禁止**新建 Runtime SSOT V2/Final/Latest。

---

## 28. 文档修复方案（本轮不执行）

1. **唯一权威**：继续使用 `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`（重建正文）。  
2. **删除**：无 `(2)` 可删；若上传副本损坏，勿回写仓库。  
3. **Git 历史恢复**：不可用（从未入库）。  
4. **重建来源：MIXED** — 当前源码（`utterance-domain-vote.ts` / orchestrator）+ `Fine_Span_Domain_Presence_Vote_*` 报告 + 本审计 + Lexicon Domain Contract。  
5. **必须重写**：状态表、主链、Vote/0.75、多桶、≤16、KenLM、已删除项、禁止恢复、验收命令、**未完成风险**（诚实写 INCONCLUSIVE / DROP）。  
6. **PASS→INCONCLUSIVE**：Legacy 报告 `REAL DIALOGUE QUALITY`、任何声称完整 KenLM 质量 PASS 的段落。  
7. **索引**：保持路径；Status 注明 Freeze 待重建；CONTEXT_PRIOR 标 SUPERSEDED/更新为 stub。  
8. **freeze-contract.test.ts 门禁**：见 §29。

---

## 29. 文档完整性测试建议（最小门禁）

当前 **无** 对 Freeze 文件 UTF-8/章节的完整性门禁。建议新增（非整篇 snapshot）：

- 权威路径存在  
- 禁止同目录 `*Freeze*(2)*` / `*Copy*` / `*Final*` / `*Latest*`  
- 文件可 `utf-8` 严格解码  
- 禁止 U+FFFD；禁止长串 `???`  
- 必须含子串：`DOMAIN_BUCKET_RETENTION_RATIO = 0.75`、`Shadow Beam`+`REMOVED`、`Domain Rerank`+`REMOVED`、`KenLM`+跨桶、正式主链文本块  
- 必须含风险句：真实 KenLM 质量未完成 / DOMAIN_VOTE_DROP / BUCKET_BUDGET_DROP

---

## 30. Target List（供负责人确认后开发）

1. 重建 `Runtime_SSOT_Contract_Freeze.md`（UTF-8）并修正 Legacy 报告伪 PASS。  
2. 更新 `CONTEXT_PRIOR.md` 与索引状态。  
3. 词库：收紧 `预订` 等多域；评估近音冲突（九点/酒店）召回侧。  
4. Budget：评估「先全局生成再 dedup 再 cap」；不默认改加权配额。  
5. Acceptance：接入真实 `createKenlmBatchScorer`；延迟分 PRE-KENLM / E2E。  
6. 清理死类型 / 过时诊断字段（可选）。

---

## 31. Check List

| 问题 | 结论 |
|------|------|
| A 唯一 Vote | **是** |
| B FineSpanDomainSet | **合规** |
| C 同 span 同域一票 | **是** |
| D 跨 span 累加 | **是** |
| E Base 不参与 Vote | **是** |
| F retained 0.75 | **是** |
| G 多桶正式运行 | **是**（非仅测试） |
| H BUDGET_DROP 原因 | 并列域+floor(16/n)+排序/切分噪声；先桶截断再 merge |
| I DOMAIN_VOTE_DROP | 拼音召回噪声（九点→酒店）；规则正确 |
| J KenLM 收跨桶池 | **是**（生产）；harness 未跑 KenLM |
| K 正式 KenLM 子进程 | **接线 ACTIVE**；harness **BYPASSED** |
| L 乱码来源 | **仓库文件损坏**（非法 UTF-8 + `??`） |
| M 索引唯一可读权威 | 路径唯一；**正文不可读** |
| N 修复 vs superseded | Freeze 重建；CONTEXT_PRIOR/错误 PASS 报告修订或标 superseded |

---

## 32. Final Verdict（分项）

```text
RUNTIME CODE COMPLIANCE: PASS
UNIQUE DOMAIN VOTE: PASS
FINE-SPAN PRESENCE SEMANTICS: PASS
BASE EXCLUSION: PASS
MULTI-BUCKET ASSEMBLY: PASS
BUCKET BUDGET SAFETY: NEEDS REPAIR
DOMAIN VOTE DROP ROOT CAUSE: PINYIN_RECALL_NOISE
REAL KENLM PRODUCTION WIRING: PASS
REAL KENLM TEST COVERAGE: FAIL
DOCUMENT AUTHORITY UNIQUENESS: PASS
RUNTIME SSOT DOCUMENT ENCODING: FAIL
DOCUMENT CONTRACT CONSISTENCY: FAIL
FINAL AUDIT VERDICT: PARTIAL PASS
```

---

## 强制输出块

```text
FORMAL DOMAIN VOTE CHAINS:
1
```

```text
FINE-SPAN DOMAIN SET IMPLEMENTATION:
COMPLIANT
```

```text
ONE SPAN ONE DOMAIN VOTE:
PASS
```

```text
MULTIPLE CANDIDATES PER SPAN:
PRESERVED
```

```text
BASE VOTE EXCLUSION:
PASS
```

```text
RETENTION RATIO IMPLEMENTATION:
0.75
```

```text
TIED MAX DOMAINS:
ALL RETAINED
```

```text
DOMAIN_VOTE_DROP ROOT CAUSE:
PINYIN_RECALL_NOISE
```

```text
BUCKET_BUDGET_DROP ROOT CAUSE:
MULTI_TIED_DOMAINS + FLOOR_16_N_CAP + LEXICON_MULTI_DOMAIN_TOO_BROAD
```

```text
DUPLICATE TEXTS CONSUME PER-BUCKET BUDGET:
YES
```

```text
REAL KENLM PRODUCTION PATH:
ACTIVE
```

```text
REAL KENLM ACCEPTANCE HARNESS:
BYPASSED
```

```text
KENLM INPUT CONTAINS DOMAIN METADATA:
NO
```

```text
CURRENT LATENCY METRIC:
PRE-KENLM
```

```text
DEAD LEGACY TYPES:
4 — ParentTermEvidence, ParentSpanCandidate, GraphEdge, CoarseSpanPath (types.ts; production construction removed)
```

```text
DEAD DIAGNOSTIC STUBS:
1 — computeContextPriorMultiplier (decision removed; context-prior.ts diagnostics-only kept)
```

```text
AUTHORITATIVE RUNTIME SSOT FILE:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

```text
DUPLICATE RUNTIME SSOT FILES:
0
```

```text
RUNTIME SSOT FILE ENCODING:
CORRUPTED
```

```text
U+FFFD OR WRITTEN QUESTION-MARK CORRUPTION:
PRESENT
```

```text
DOCUMENT INDEX TARGET VALID:
YES
```

```text
DOCUMENT REPAIR SOURCE:
MIXED
```

```text
RUNTIME CODE COMPLIANCE:
PASS
```

```text
DOCUMENT REPAIR READINESS:
READY
```

```text
FINAL AUDIT VERDICT:
PARTIAL PASS
```

---

FINE-SPAN PRESENCE RUNTIME COMPLIANCE AND SSOT DOCUMENT REPAIR AUDIT COMPLETE — STOP
