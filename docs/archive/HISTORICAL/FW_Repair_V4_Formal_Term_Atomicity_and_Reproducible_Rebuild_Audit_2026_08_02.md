<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Formal_Term_Atomicity_and_Reproducible_Rebuild_Audit_2026_08_02.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Formal Term Atomicity & Reproducible Rebuild Audit

**Date:** 2026-08-02  
**Nature:** READ ONLY · PRE-DEVELOPMENT AUDIT · FORMAL TERM ATOMICITY · SOURCE-TO-RUNTIME REPRODUCIBILITY  
**Verdict:** **READY_AFTER_REPRODUCIBILITY_FIX**

**Artifacts (read-only probes):**

| Artifact | Path |
|----------|------|
| Summary | `docs/tone-v2/_audit_scratch/formal_term_atomicity_audit/summary.json` |
| All terms export | `.../formal_terms_export.csv` |
| Atomicity candidates | `.../formal_term_atomicity_candidates.csv` |
| Split counterfactual | `.../atomic_split_counterfactual.json` |

**Prohibitions observed:** no code/DB/rebuild/term delete/config/dialog_200/KenLM/JobResult changes.

---

## 1. Executive Conclusion

```text
READY_AFTER_REPRODUCIBILITY_FIX

原子化规则和违规词范围已明确，
但标准 Build 尚不能从声明 Source 完整复现生产词库。

必须先补齐 Source-to-Runtime 可重复构建，
再执行正式 term 清理。
```

| Question | Answer |
|----------|--------|
| 违规组合词是否明确？ | **是** — 至少 `上线计划`/`接口文档` 等；4+ 字候选 **810**，启发式 `DELETE_COMPOSITE` **333** |
| Source 是否可追溯？ | **是（对 CSV）** — 10061/10061 映射到 `tmp/..._extract` 三 CSV；**否（对声明 seedInputs）** |
| 统一 Atomicity Validator？ | **不存在于 Full Rebuild 写路径** |
| 标准 build 可重复？ | **`NOT_REPRODUCIBLE`** — `run-lexicon-full-rebuild.mjs` 缺失；seed shadow ≠ production |
| 删除组合词后 Lattice？ | **上线+计划 / 接口+文档 exact 可召回**；Raw/canonical 保底；无证据需恢复 fragment |
| 能否立刻开发删词？ | **否** — 先修可重复 Build，再 Source 层清理 + 统一门禁 + clean rebuild |

---

## 2. Audit Scope

- Production SSOT: `node_runtime/lexicon/v3`（`lexicon-v3-runtime-v3` / bundle **11**）
- Formal terms = enabled rows in `term`（+ presence in base/domain for materialization）
- Parent fragment / ngrams：**已退休，本轮不审计恢复**
- Runtime algorithms（Recall/Lattice/Vote/KenLM）：只读 Counterfactual，不修改

---

## 3. Frozen Atomicity Contract

| Class | Rule |
|-------|------|
| Prefer | 2–3 字可独立成立原子词 |
| Allow 4–5 | 成语 / 专名 / 品牌 / 机构 / 不可拆专业术语 / 拆分后语义不等价固定表达 — 需 `exceptionReason` |
| Forbid | 可拆业务短语、句段、槽位模板、动作+对象短语、仅为 Case 召回加入的组合词 |
| Forbidden fixes | SQLite 手工 DELETE、黑名单、Recall 长度过滤、KenLM 压分、旧 DB copy、恢复 fragment |

---

## 4. Production Lexicon Identity

| Field | Value |
|-------|-------|
| path | `node_runtime/lexicon/v3/lexicon.sqlite` |
| schemaVersion | `lexicon-v3-runtime-v3` |
| bundleVersion | 11 |
| checksum | `sha256:d6e77ce9139a489cf17ad0bec83814aa7685d02037bc3870187a80bf47abf34a` |
| term / base / idiom / domain | 10061 / 10061 / 22192 / 1033 |
| lastPatchId | `lexicon-domain-hierarchy-completion-v1`（hierarchy only） |
| rebuild.mode | `FULL_REBUILD` / `lexicon-full-rebuild-v1` / `no_merge:true` |
| rebuild.sources | `lexicon_full_corrected_review.csv` + `term_domain_tags_corrected.csv` + `supplemental_terms.csv` |
| seedInputs | 仍列 p1_3 JSONL（**与真实 term 血统不一致**） |
| termType column | **不存在** |
| all term.tier | **`domain`**（10061） |

---

## 5. Formal Term Length Distribution

| Length | Count | Notes |
|--------|------:|-------|
| 1 | 0 | — |
| 2 | **7553** | 主原子层 |
| 3 | **1698** | 含 `大床房` 等产品词 |
| 4 | **731** | 原子化主战场 |
| 5 | **79** | |
| 6+ | 0 | |
| **4+ total** | **810** | candidates CSV |

`idiom_lexicon` 另有 **22192** 成语行（不计入 `term` 表长度分布，但 4+ term 中有 81 同时出现在 idiom 表 → `KEEP_IDIOM`）。

---

## 6. Atomicity Candidate Inventory

File: `formal_term_atomicity_candidates.csv`（全部 4+ 字 enabled terms）

| Classification | Count | Meaning |
|----------------|------:|---------|
| DELETE_COMPOSITE | **333** | 可拆且子词均已是正式 term（启发式） |
| INVESTIGATE | **379** | 需人工语义复核（含部分专名/菜单/机构） |
| KEEP_IDIOM | **81** | 亦在 `idiom_lexicon` |
| KEEP_PROPER_NOUN | **16** | 弱启发式专名且不可完全拆到现有原子 |
| KEEP_FIXED_TECHNICAL_TERM | **1** | `蓝莓马芬`（菜单/产品固定表达） |

**重要：** DELETE_COMPOSITE **不是**最终删除清单。例如 `国家博物馆`、`焦糖玛奇朵` 可能应升格为 KEEP_PROPER_NOUN / KEEP_FIXED_TECHNICAL_TERM。开发前应对 333 做人工复核批次。

---

## 7. Key Compound Term Traces

| Surface | Formal? | Classification | Atoms exist? | Source / Batch |
|---------|---------|----------------|--------------|----------------|
| **上线计划** | YES | **DELETE_COMPOSITE** | 上线✓ 计划✓ | `supplemental_terms.csv` row **41** · `external_full_review_supplement_v1` |
| **接口文档** | YES | **DELETE_COMPOSITE** | 接口✓ 文档✓ | `supplemental_terms.csv` row **40** · same |
| 订单中台 | NO | ABSENT | 订单? 中台? incomplete | — |
| 候选生成 | NO | ABSENT | 候选✓ 生成✓ | — |
| 翻译引擎 | NO | ABSENT | incomplete | — |
| 会员系统 | NO | ABSENT | 会员✓ 系统✓ | — |
| 收货地址 | NO | ABSENT | incomplete | — |
| 血常规 | NO | ABSENT | — | — |
| 机场高速 | NO | ABSENT | 机场✓ 高速✓ | — |
| 软件园 | NO | ABSENT | incomplete | — |
| **蓝莓马芬** | YES | **KEEP_FIXED_TECHNICAL_TERM** | 蓝莓✓ 马芬✓ | review row 8279 · `domain_seed_v1` |
| **内科医生** | YES | DELETE_COMPOSITE → **建议 INVESTIGATE** | 内科✓ 医生✓ | review · `industry_pack_v1` |
| **大床房** | YES | **KEEP_ATOMIC** (len=3) | 大床✓ 房✗ | review · `industry_pack_v1` |

对每个重点词的 9 问答案（压缩）：

1. 正式 term？见上表  
2. 表：`term` + `base_lexicon` + `domain_lexicon`（有 domain 时）  
3. source/importBatch：见上  
4. 完整 pinyin exact：上线计划/接口文档/蓝莓马芬/内科医生/大床房 **均可**（counterfactual）  
5–6. 拆分与原子存在性：见上  
7. Lattice：原子均可 exact 时，窗口覆盖 `[0,2)+[2,4)` + Raw/canonical → **不应 uncovered**  
8. 不可拆语义：蓝莓马芬=菜单 SKU；大床房=酒店房型；内科医生=职称短语（可拆但语义略强）  
9. KEEP/DELETE/INVESTIGATE：见上  

---

## 8. 上线计划 Trace

```text
Source File
  tmp/lexicon_corrected_review_20260718_extract/supplemental_terms.csv
Source Row
  line 41: 上线计划,tech_ai,1.0,external_full_review_supplement_v1,missing_core_business_term
Normalizer / Validator
  Full Rebuild 脚本缺失 → 无可审计的统一 Normalizer/Atomicity Validator
  industry rejectPhraseLike(上线计划) = false（不会拦）
Import DTO → SQLite
  FULL_REBUILD 写入 term + base materialize + domain_lexicon(tech_ai) + term_domain_tags
Exact Recall → WindowCandidate → LexicalEdge
  recallSpanTopKV2 exact on shang|xian|ji|hua → term-e4b88ae7babfe8ae
```

**本应拦截的门禁：** 统一 Atomicity Validator（写入 SQLite 前）— **当前不存在于该路径**。  
**绕过原因：** supplement 以 “missing_core_business_term” 名义直写；无 composite 检查；`rejectPhraseLike` 未接入且规则也不覆盖该词。

---

## 9. 接口文档 Trace

同 §8，`supplemental_terms.csv` **row 40**，`term-e68ea5e58fa3e696`，domains=`tech_ai`。  
原子：`接口`(tech_ai) + `文档`(domains=[])。

---

## 10. Source Inventory

| Source | Path | Exists | Records | In standard `lexicon:build:v2-shadow`? | 4+ compounds | Bypass atomicity? |
|--------|------|--------|--------:|----------------------------------------|--------------|-------------------|
| Full review CSV | `tmp/.../lexicon_full_corrected_review.csv` | YES | 10000 | **NO** | 789 | YES — rebuild 无门禁 |
| Tags CSV | `tmp/.../term_domain_tags_corrected.csv` | YES | 970 | **NO** | n/a | n/a |
| Supplemental CSV | `tmp/.../supplemental_terms.csv` | YES | 73 | **NO** | **33** | **YES — 上线计划入口** |
| Remove list | `tmp/.../terms_to_remove_or_rebuild.csv` | YES | 12 | **NO** | — | exclude list |
| Zip archive | `tmp/lexicon_corrected_review_20260718.zip` | YES | — | NO | — | — |
| p1_3 base/common5/domain/idiom JSONL | `electron_node/docs/lexicon-assets/p1_3_...` | YES | seed | **YES** | classifier limits | shadow only |
| domain_patch_multidomain_v1 | listed in production seedInputs | **EMPTY/MISSING** | 0 | no | — | stale manifest |
| industry_pack_v1 entries | `docs/lexicon-assets/industry_pack_v1/` | YES | packs | via patch builder | filtered by rejectPhraseLike at **generate** | not on Full Rebuild |
| Full rebuild script | `run-lexicon-full-rebuild.mjs` | **NO** | — | — | — | historical only |

`external_full_review_supplement_v1` = **source 列标签**，不是独立文件。

---

## 11. Standard Build Pipeline

```text
npm run lexicon:build:v2-shadow
  → p1_3 JSONL only → v2_shadow (term≈9, domain≈25, base≈50000)
npm run lexicon:prepare:v3-runtime -- --force
  → copies shadow → would DESTROY production Full Rebuild content
npm run lexicon:retire:parent-fragment-schema
  → copies existing production tables (no ngrams) — content-preserving schema tool
npm run lexicon:gate:v3-runtime
  → validates current v3 bundle
```

**Production term 血统：** Full Rebuild CSV（2026-07-18）→ hierarchy patch → PF schema retirement。  
**不是** seed shadow。

---

## 12. Production Reproducibility

| # | Question | Answer |
|---|----------|--------|
| 1 | 标准 build 读哪些 Source？ | p1_3 JSONL only |
| 2 | 10061 terms 来自？ | review CSV 9988 + supplemental 73（排除 remove 12） |
| 3 | 哪些 Source 未进标准 build？ | **全部 Full Rebuild CSV** |
| 4 | 依赖历史 SQLite 复制？ | **是（当前可运行态）** — PF retirement 从旧库 copy 表；无脚本从 CSV 重建 |
| 5 | 无法由声明源重建的 term？ | 相对 `seedInputs`：**几乎全部**；相对 `tmp` CSV：**0 unmapped** |
| 6 | manifest.seedInputs 完整？ | **否** — 误导为 p1_3；缺 CSV；含缺失 multidomain 路径 |
| 7 | lastPatchId 必要数据？ | hierarchy pairs only；**不是** term 内容 SSOT |
| 8 | patch history 是内容 SSOT？ | **否**（term 来自 FULL_REBUILD） |
| 9 | 删 SQLite 后仅靠仓库 Source？ | **不能**（脚本缺失 + CSV 在 tmp 非正式 assets） |
| 10 | 缺失在哪？ | rebuild 脚本；CSV 正式化入库；统一 validator；manifest 真相 |

**Verdict: `NOT_REPRODUCIBLE`**（相对声明的标准 npm build + seedInputs）

---

## 13. Source-to-Term Reconciliation

| Metric | Value |
|--------|------:|
| totalTerms | 10061 |
| termsWithUniqueSource (CSV surface) | **10061** |
| termsWithMultipleSources | 0 |
| termsWithoutSourceFile (vs tmp CSV) | **0** |
| termsOnlyFromReview | 9988 |
| termsOnlyFromSupplemental | **73** |
| termsOnlyFromHistoricalDB (no CSV) | **0** |
| termsNotReproducible via npm seed build | **≈10061** |

CSV 内 `source` 字段保留血统标签（`industry_pack_v1` / `domain_seed_v1` / `external_full_review_supplement_v1` 等）— 这是 **review 合并导出**，不是运行时再读 industry pack。

---

## 14. Import Order and Deduplication

据 manifest `rebuild.no_merge:true` 与 Full Rebuild 报告：

```text
1) lexicon_full_corrected_review.csv → term SSOT (~9988 after REMOVE)
2) supplemental_terms.csv → +73 terms / tags
3) term_domain_tags_corrected.csv → tags
4) materialize base/domain/routing from term+tags
5) idiom_lexicon untouched from prior idiom corpus
```

同一 surface：supplement **后加载追加**；上线计划/接口文档 **不在 review**，由 supplement **直接新增**。  
domains/source：以 CSV 行为准；无原子化覆盖检查。

---

## 15. Existing Validator Audit

| Validator | File | Rules | Called on Full Rebuild? | Called on V4 patch? | Called on shadow? |
|-----------|------|-------|-------------------------|---------------------|-------------------|
| `rejectPhraseLike` | `industry_pack_v1/lib/reject-phrase-like.mjs` | 黑名单/后缀启发式（**非**通用原子化） | **NO** | NO | NO（仅 pack generate） |
| `validateIndustryEntry` | industry pack | phrase + CJK≤5 | NO | via pack build | NO |
| `validateGranularity` | `patch-validator-v4.ts` | denylist + **max len 5** | NO | **YES** | NO |
| `validateLexiconPatchV3` | patch-validator.ts | version/hash/tags | NO | V3 apply | NO |
| `classifyLexiconV2Row` | v2-classify-row.mjs | base 2–3 / idiom 4 / domain≤5 | NO | NO | **YES** |
| `validateSeedFiles` | validate-seed.mjs | max len 8 | NO | optional | optional |
| termType / properNoun gate | — | **不存在** | — | — | — |

**结论：不存在统一 Atomicity Validator；多 Source 多规则；Full Rebuild / supplement 无门禁。**

---

## 16. Validator Bypass Paths

1. **Full Rebuild CSV / supplemental 直写**（主路径）  
2. `rejectPhraseLike` 未覆盖「名词+名词」业务短语（上线计划=false）  
3. V4 仅 `len≤5` + 小 denylist — **允许** 4 字组合  
4. V3 patch 无短语检查  
5. 生产 manifest seedInputs 与真实 CSV 脱节 → 审计盲区  

---

## 17. Target Unified Atomicity Gate

**唯一入口（建议）：**

```text
所有正式 term 在写入 SQLite 之前
（Full Rebuild / Patch V3 / Patch V4 / Industry import 共用）
→ AtomicityValidator.validate(termDraft) → ACCEPT | REJECT_COMPOSITE | ACCEPT_EXCEPTION
```

建议物理位置（实施时，本轮不写代码）：

```text
electron_node/.../lexicon-build/atomicity-validator.ts  (或 scripts/lexicon/lib/)
被以下强制调用：
  - full-rebuild importer
  - patch-validator-v3 / v4
  - industry pack → patch builder
禁止：
  - Runtime Recall 过滤
  - 组合词字符串黑名单主机制
  - LLM 在线判断
```

输入：`surface, termType/exceptionReason, source, domains[], explicitException`  
输出：三态如上。

---

## 18. Legal Exception Contract

| 机制 | 现状 | 建议 |
|------|------|------|
| `termType` 列 | **无** | 可最小新增 build-time 字段或沿用 `source`+显式 `exceptionReason` 列于 Source |
| `idiom_lexicon` | 已有 | 成语 → KEEP_IDIOM |
| proper noun | 无结构化字段 | Source 行 `termType=proper_noun` + reason；Validator 校验非空 reason |
| 手工白名单文件 | 禁止作主机制 | 例外必须进 Source 行 / term 元数据 |

**优先复用：** Source CSV 增加 `termType` + `exceptionReason`（build-time）；runtime 可不消费，仅 Validator 与审计消费。若不愿改 schema，例外只存在于 Source，Validator 拒绝无例外的 4+ 可拆词。

---

## 19. Atomic Split Counterfactual

| Compound | WITH exact | Atoms exact | Coverage claim |
|----------|------------|-------------|----------------|
| 上线计划 | YES | 上线 YES + 计划 YES | 原子边可覆盖；Raw/canonical 保底 |
| 接口文档 | YES | 接口 YES + 文档 YES | 同上 |
| 内科医生 | YES | 内科 YES + 医生 YES | 同上 |

**不会**因删除这三项而产生必然 uncovered；**禁止**用 fragment 补洞。

---

## 20. Domain Tag Impact

| Compound domain | Atom domains |
|-----------------|--------------|
| 上线计划 → tech_ai | 上线=`tech_ai`；**计划=[]** |
| 接口文档 → tech_ai | 接口=`tech_ai`；**文档=[]** |

原则：

```text
原子词本身语义支持的领域才写入；
组合上下文由同句 Domain Vote 聚合；
不得通过组合 term 维持领域识别。
```

**REVIEW_DOMAIN_TAGS（不修改，仅列出）：**

- `计划` — 是否应有 tech_ai / workplace？  
- `文档` — 是否应有 tech_ai？  
- 其他 DELETE_COMPOSITE 中「仅组合词带 domain、原子无 domain」的右侧原子  

删组合词后，tech_ai 仍可从 `上线`/`接口` 得票；若句中只有「计划」可能削弱 — 属标签复核，不是恢复组合词的理由。

---

## 21. Recall / Lattice Counterfactual

```text
WITH compound:  单 Edge 覆盖四音节；多一条 exact Candidate / Path 选项
WITHOUT:       两原子 Edge 拼接；Candidate/Path 可能减少重复整词边
Raw/canonical: 始终保底 → uncovered 不应上升
KenLM:         本轮不改；只接收合法句
```

预期：删除组合词 **减少** 整词重复 Path/Sentence，而非破坏覆盖。

---

## 22. Performance and Duplication Impact

| Item | Observation |
|------|-------------|
| 4+ formal terms | 810 |
| Heuristic deletable | 333 |
| SQLite | 已无 ngram（10.8MB）；再删组合词对体积影响次要 |
| 重复 Path | 整词 Edge + 原子 Edge 双轨 → 删整词可降枚举分支 |
| TopK/caps | **不得**为指标调整 |

---

## 23. DELETE / KEEP / MODIFY Matrix

### DELETE_TERM（高置信，开发时从 Source 删）

- `上线计划`、`接口文档`  
- supplemental 中同类可拆业务短语（部署脚本/测试数据/代码审查/单元测试/… — 需批次复核后确认）  
- 经人工确认的 `DELETE_COMPOSITE` 子集（非全部 333）

### KEEP_TERM

- 全部 2–3 字原子（含 `大床房`）  
- `蓝莓马芬`（菜单固定）  
- idiom_lexicon 成语  
- 经例外合同确认的专名/术语  

### MODIFY_SOURCE

- `supplemental_terms.csv`（移除/改写 4+ 可拆行）  
- `lexicon_full_corrected_review.csv`（清理 industry 带入的可拆短语）  
- 将 CSV **迁入** `docs/lexicon-assets/` 作为声明 SSOT  

### MODIFY_VALIDATOR

- 新增统一 AtomicityValidator；挂到 rebuild + patch V3/V4 + pack  

### MODIFY_BUILD

- 恢复/重写 `run-lexicon-full-rebuild`（或等价）  
- manifest.seedInputs/rebuild.sources 与真实输入一致  
- **禁止** prepare:v3-runtime 用 seed shadow 覆盖 production  
- gate：无统一 validator 拒绝入库存档  

### REVIEW_DOMAIN_TAGS

- `计划`、`文档` 及同类右侧原子  

### KEEP_RUNTIME

Exact Recall / Lattice / Vote / Bucket / Assembly / CrossPath / KenLM / JobResult — **默认不改**

---

## 24. Development Target List（后续实施，非本轮）

1. 正式化 CSV SSOT 路径 + 恢复可重复 Full Rebuild  
2. 实现唯一 Atomicity Gate + 例外合同  
3. Source 删除高置信组合词  
4. Domain tag 复核  
5. Clean rebuild + dialog_200 / Lattice 回归  
6. 禁止旧 SQLite copy 作为内容 SSOT  

---

## 25. Regression Check List（实施后）

```text
[ ] Source 可重建相同 term 集合（允许审计差异报告）
[ ] 上线计划/接口文档 absent
[ ] 上线/计划/接口/文档 exact 仍在
[ ] dialog_200 200/200；uncovered=0
[ ] 无 parent_fragment / ngram
[ ] 无 Runtime 过滤/黑名单
[ ] Vote/KenLM/JobResult 未改算法/合同
```

---

## 26. Final Recommendation

```text
READY_AFTER_REPRODUCIBILITY_FIX

原子化规则和违规词范围已明确，
但标准 Build 尚不能从声明 Source 完整复现生产词库。

必须先补齐 Source-to-Runtime 可重复构建，
再执行正式 term 清理。
```

### 推荐实施顺序

```text
A. Reproducibility Fix
   - 将 Full Rebuild CSV 纳入 docs/lexicon-assets SSOT
   - 恢复可重复 rebuild 脚本；修正 manifest 声明
   - 证明：空目录 → Source → 同内容 SQLite（checksum 策略另定）

B. Unified Atomicity Gate
   - 单一 Validator；所有写路径强制

C. Source-level composite cleanup
   - 先删 上线计划/接口文档 + 已确认 DELETE 批次
   - clean rebuild（非手工 DELETE）

D. Domain tag review + dialog_200 / Lattice 回归
```

### Target List T1–T30（压缩）

| ID | Result |
|----|--------|
| T1 | 4+ = **810**（4字731 + 5字79） |
| T2 | idiom∩term 81；proper 启发式16；fixed 1（蓝莓马芬）；其余待分 |
| T3 | DELETE_COMPOSITE 启发式 **333** |
| T4 | supplemental row **41** |
| T5 | supplemental row **40** |
| T6–T7 | Full Rebuild 无 Validator；phraseLike=false |
| T8 | 多套弱规则，**无统一** Atomicity Validator |
| T9 | Full Rebuild CSV/supplement；V3 patch |
| T10 | shadow：p1_3 JSONL |
| T11 | vs tmp CSV：**是**；vs seedInputs：**否** |
| T12 | **否**（脚本缺失） |
| T13 | 血统不同：CSV Full Rebuild vs seed shadow |
| T14 | vs CSV：否；vs seed：几乎全部像“历史 DB” |
| T15 | hierarchy patch 不增 term；term 非 patch-only |
| T16 | review → supplement；no_merge rebuild |
| T17 | 写入 SQLite 前唯一 AtomicityValidator |
| T18–T19 | Source `termType`+`exceptionReason`；可不先加 runtime 列 |
| T20–T21 | **是**（atoms exact） |
| T22 | 可能削弱仅依赖组合词 domain 的句；需复核原子 tags |
| T23 | 计划、文档等 |
| T24 | 预期减少整词重复 Path |
| T25 | 对已证实原子对：**不应** |
| T26 | **需要** clean rebuild（在可重复链上） |
| T27 | Source 删除 + Gate 拒绝再导入 |
| T28 | **当前不能** |
| T29 | **没有正当理由**继续 copy 旧库作内容 SSOT |
| T30 | **否** — 先 Reproducibility Fix，再原子化开发 |

### Check List

```text
[x] 未修改代码/数据库/rebuild
[x] 已导出全部正式 term + 长度/tier 统计
[x] 已生成 atomicity candidate CSV
[x] 已追踪上线计划/接口文档
[x] 已盘点 Source / Build / 对账 / 可重复性
[x] 已审计 import order / validators / 绕过路径
[x] 已设计唯一 Atomicity Gate 与例外合同
[x] 已做原子拆分 Counterfactual
[x] 已审计 Domain 标签影响
[x] 未重新引入 fragment；未改 KenLM/JobResult
[x] 未用黑名单/手工改库作为方案
```
