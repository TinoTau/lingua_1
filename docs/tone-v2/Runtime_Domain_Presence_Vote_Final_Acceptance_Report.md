# Runtime Domain Presence Vote Final Acceptance Report

| Field | Value |
|------|-------|
| Status | **ACCEPTANCE PASS** |
| Date | 2026-07-20 |
| Basis | [`Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md`](./Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md) |
| Sole Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |

---

## 1. Executive Verdict

**ACCEPTANCE PASS.**

Presence Vote 主链可正式验收并冻结。本轮未改 Vote 算法 / 0.75 / 候选上限 16 / KenLM delta。仅对审计证实的边界缺陷做了三处最小修复，并补齐 T1–T11 专项测试；全部 Gate 通过。

```text
功能验收 PASS
≠
KenLM / 词库 / dialog_200 质量验收（明确不在本轮）
```

---

## 2. Git Status

- Branch: `main`（工作树在本轮前已脏）
- 本轮触及：
  - `lexicon-runtime-v2.ts`（SQL term-domain 原子查询）
  - `recall-span-topkv3.ts`（parent fragment domains  enrichment）
  - `run-fw-sentence-rerank-from-prefilled.ts` + `fw-detector-v4-path.ts`（prefilled 空数组边界）
  - `domain-presence-vote-acceptance.test.ts`（新建 T1–T11）
  - `freeze-contract.test.ts`（原子查询 / prefilled 门禁）
  - 本报告
- 未 `reset --hard` / 未提交 / 未覆盖无关 tone/wav/lexicon 产物

---

## 3. Scope

边界审计 → 专项测试 → 仅修复测试证明的缺陷 → 完整验收 → 冻结报告。

禁止项均遵守：未改 Presence Vote 公式、未改 0.75、未恢复 Shadow/Rerank、未大规模改词库。

---

## 4. Frozen Contract

端到端审计已确认的 25 条基线保持不变（见任务第三节）。`DOMAIN_BUCKET_RETENTION_RATIO = 0.75`；全局候选 ≤16；Multi-Bucket 唯一正式路径。

---

## 5. Previous Gaps

来自 Completeness Audit 的剩余缺口：

| Gap | 本轮处置 |
|-----|----------|
| passive_domain_weak 无专项测试 | T1 补齐；实现正确，未改代码 |
| Base 入每桶无专项测试 | T2 补齐 |
| same-text multi-domain | T3/T4；Hotword union 前提成立 |
| SQL LIMIT partial tags | **证实缺陷 → 最小修复** |
| Recall scope 完整性 | T6 |
| Parent fragment 单 domain_id 可投票 | **证实非法状态 → 最小修复** |
| Prefilled 空数组回退 primary 桶 | **证实缺陷 → 最小修复** |
| Vote call count | T8 |
| KenLM merged pool | T9/T10 |
| Deterministic ordering | T11 |

---

## 6. passive_domain_weak Verification

实现：`isDomainVoteSource` 含 `passive_domain_weak`；与 `domain_term` 同等 presence；无额外权重。

测试：T1a/T1b/T1c **PASS**。

```text
PASSIVE_DOMAIN_WEAK CONTRACT: PASS
```

---

## 7. Base Every-Bucket Verification

`filterDomainCandidatesPerSpan`：`isBaseCandidate` → 每桶 `baseCandidates`；`domains.includes(bucketDomain)` 过滤同域。

测试：T2 **PASS**（coffee / milk_tea 两桶；Base 不进 domainScores）。

```text
BASE ENTERS EVERY RETAINED BUCKET: PASS
```

---

## 8. Same-Text Multi-Domain Verification

- Lexicon：`mergeDomainTierRows` 并集 + 原子查询保证 scope 内 tags 完整。
- WindowCandidate：整表 `freeze([...domains])`。
- Vote：T3/T4 验证 ≥3 域进入 FineSpanDomainSet。

```text
SAME-TEXT MULTI-DOMAIN PRESERVATION: PASS
```

---

## 9. SQL LIMIT Atomicity

**缺陷：** 旧实现对 JOIN 行 `LIMIT`，再 `merge.slice(0, limit)`，可在 LIMIT 边界返回 **partial-domain term**。

**修复：** `queryDomainMultiRowsAtomic`：

1. `GROUP BY d.id` 选 top-N **term**
2. 再 JOIN 这些 term 的 **全部** in-scope `term_domain_tags`

测试：T5 纯算法断言 + freeze `GATE-DOC-DOMAIN-ATOMIC`；Electron smoke 仍验证真实多标签。

```text
SQL LIMIT DOMAIN ATOMICITY: PASS
```

---

## 10. Recall Scope Semantics

合同：`Hotword.domains[]` = active recall scope 内全部 tags；不加载 scope 外。

T6 + 原子查询 `domain_id IN (scope)` **PASS**。

```text
ACTIVE RECALL SCOPE DOMAIN COMPLETENESS: PASS
```

---

## 11. Parent Fragment Semantics

**非法状态（修复前）：** fragment 可投票但只带单 `domain_id`；同 `parentTermId` 结构键只采纳首次 domains。

**合法状态 A（修复后）：** `lookupTermDomainTagsInScope(parentTermId, domainIds)` 注入完整 scope domains[]。

测试：T7 **PASS**。

```text
PARENT FRAGMENT VOTE SEMANTICS: PASS
```

---

## 12. Prefilled Fallback Boundary

**缺陷：** `prefilledCombinations.length > 0` 判断使空数组 `[]` 回退到 primary `spanSets` 重建。

**修复：**

- `prefilledCombinations !== undefined` → 使用（含空数组 = 无候选 fail-open）
- `undefined` → 保留 legacy rebuild
- V4 path 始终传 `combinations ?? []`

测试：T9 / T10 / T10b **PASS**。

```text
NORMAL MULTI-BUCKET PREFILLED FALLBACK: NOT TRIGGERED
```

---

## 13. Production Vote Call Count

T8：`jest.spyOn(voteUtteranceDomainFromPool)` + `runDomainAwareAssembly` → **calledTimes = 1**。

生产链：orchestrator → 一次 `runDomainAwareAssembly` → 一次 Vote。

```text
PRODUCTION VOTE COUNT: 1
PARALLEL VOTE CHAINS: 0
```

---

## 14. Multi-Bucket KenLM Input

T9：跨桶 merge 文本进入 `scoreBatch`；combination 无 domainScores / retainedDomains / bucketDomain。

```text
KENLM RECEIVES ALL MERGED BUCKETS: YES
KENLM DOMAIN METADATA: ABSENT
FINAL SENTENCE CANDIDATE LIMIT: 16
```

---

## 15. Deterministic Ordering

T11：重复 Vote 与 merge 结果稳定；retained 排序 = 票数降序 + `localeCompare`。

---

## 16. Test Coverage

| ID | Result |
|----|--------|
| T1 | PASS |
| T2 | PASS |
| T3 | PASS |
| T4 | PASS |
| T5 | PASS |
| T6 | PASS |
| T7 | PASS |
| T8 | PASS |
| T9 | PASS |
| T10 | PASS |
| T11 | PASS |

文件：`domain-presence-vote-acceptance.test.ts` + 既有 `fine-span-domain-presence-vote.test.ts`。

```text
TESTS T1–T11: PASS
```

---

## 17. Real Lexicon Read-Only Findings

| term | 长度(字) | domains | 多领域 | 备注 |
|------|----------|---------|--------|------|
| 订单 | 2 | food_order | 否 | OK |
| 预订 | 2 | food_order, tourism_hotel, tourism_route, transport | **是** | OK |
| 前台 | 2 | tourism_hotel | 否 | OK |
| 联调 | 2 | tech_ai | 否 | OK |
| 上线计划 | 4 | tech_ai | 否 | 建议 Lexicon 维护复核长度策略 |
| 接口文档 | 4 | tech_ai | 否 | 同上 |

`Lexicon_Domain_Contract_Freeze_V1` 未在本轮将“4 字禁止”写成硬冻结条款；记为 follow-up，**不阻塞** Presence Vote 验收。

```text
LEXICON DATA FOLLOW-UP: REQUIRED
```

（仅词库运营复核，非 Vote 算法缺陷。）

---

## 18. Runtime Code Changes

| 文件 | 变更 | Vote 算法？ |
|------|------|------------|
| `lexicon-runtime-v2.ts` | term-domain 原子 LIMIT | **NO** |
| `recall-span-topkv3.ts` | parent 完整 domains[] | **NO** |
| `run-fw-sentence-rerank-from-prefilled.ts` | 空 prefilled 不重建 | **NO** |
| `fw-detector-v4-path.ts` | 始终传 `?? []` | **NO** |

```text
PRESENCE VOTE ALGORITHM MODIFIED: NO
DOMAIN_BUCKET_RETENTION_RATIO: 0.75
```

---

## 19. Test Results

| Command | Result |
|---------|--------|
| `npx tsc --project tsconfig.main.json --noEmit` | PASS |
| jest domain-presence / fine-span / assemble / recall-span-topkv3 | PASS |
| `npm run test:fw-detector` | PASS（273） |
| `npm run accept:runtime-ssot` | **ACCEPTANCE_PASS** |

---

## 20. Remaining Non-Blocking Risks

1. KenLM Top1 / MISRANK / cold-start — **质量域，本轮不验收**
2. dialog_200 全量 wav E2E — 未执行
3. Recall 近音噪声
4. 4 字 tech 词 Lexicon 运营复核
5. Jest Node ABI ≠ Electron：原生 sqlite 边界用例在 Jest 可能 skip；算法 + freeze + Electron smoke 已覆盖

---

## 21. Target List

### BLOCKING FUNCTIONAL GAPS

```text
NONE
```

### LEXICON DATA FOLLOW-UP

- 复核「上线计划」「接口文档」等 4 字词是否符合运营长度原则

### KENLM QUALITY / E2E

- 不在本验收范围

---

## 22. Check List

- [x] Gate 1 Domain Fact
- [x] Gate 2 Vote
- [x] Gate 3 Retention
- [x] Gate 4 Consumption
- [x] Gate 5 Candidate Pool
- [x] Gate 6 KenLM
- [x] Gate 7 Legacy
- [x] Gate 8 T1–T11
- [x] accept:runtime-ssot

---

## 23. Final Verdict

```text
PRESENCE VOTE FUNCTIONAL ACCEPTANCE: PASS
PRESENCE VOTE ARCHITECTURE FREEZE: PASS
FINAL VERDICT: ACCEPTANCE PASS
```

---

## Mandatory Output Block

```text
PRESENCE VOTE ALGORITHM MODIFIED:
NO

DOMAIN_BUCKET_RETENTION_RATIO:
0.75

PASSIVE_DOMAIN_WEAK CONTRACT:
PASS

BASE ENTERS EVERY RETAINED BUCKET:
PASS

SAME-TEXT MULTI-DOMAIN PRESERVATION:
PASS

SQL LIMIT DOMAIN ATOMICITY:
PASS

ACTIVE RECALL SCOPE DOMAIN COMPLETENESS:
PASS

PARENT FRAGMENT VOTE SEMANTICS:
PASS

PRODUCTION VOTE COUNT:
1

PARALLEL VOTE CHAINS:
0

NORMAL MULTI-BUCKET PREFILLED FALLBACK:
NOT TRIGGERED

KENLM RECEIVES ALL MERGED BUCKETS:
YES

KENLM DOMAIN METADATA:
ABSENT

FINAL SENTENCE CANDIDATE LIMIT:
16

TESTS T1–T11:
PASS

BLOCKING FUNCTIONAL GAPS:
NONE

LEXICON DATA FOLLOW-UP:
REQUIRED

QUALITY VALIDATION:
NOT PART OF THIS ACCEPTANCE

PRESENCE VOTE FUNCTIONAL ACCEPTANCE:
PASS

PRESENCE VOTE ARCHITECTURE FREEZE:
PASS

FINAL VERDICT:
ACCEPTANCE PASS
```

---

```text
RUNTIME DOMAIN PRESENCE VOTE
FINAL ACCEPTANCE AND ARCHITECTURE FREEZE COMPLETE — STOP
```
