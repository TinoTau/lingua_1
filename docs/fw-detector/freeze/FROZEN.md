# FW Repair V4 — Framework Freeze（SSOT）

**版本：** 2026-06-25 · Ranking Repair V1.2  
**状态：** FROZEN · Maintenance Mode  
**门禁：** `freeze-contract.test.ts` · `freeze-config-ssot.test.ts`

---

## 1. 冻结裁决

```text
Framework Frozen · Lexicon Continues
```

| 子合约 | 版本 |
|--------|------|
| Tone-First Recall | V1.0.1 |
| Ranking / Assembly | **V1.2**（rank→filter→toneGuard→select） |
| Diagnostics / Trace | V1.0.2 |
| KenLM Runtime | Batch-Only V1.0.0 |
| Raw Log Delta / Apply Gate | V1.0.0 · Gate **3.0** |
| Domain Source Unification | 2026-06-23 |
| Context Prior | 2026-06-23 |

**架构详述：** [ARCHITECTURE.md](../ARCHITECTURE.md)

---

## 2. 主链（唯一合法路径）

```text
FW Top1 → Fine Span → Pinyin Recall → Tone First → Candidate Ranking
→ Domain Vote → Domain Filter → Tone Guard → Select → Assembly
→ KenLM → Apply Gate (≥3.0) → Writeback → Final Text
```

**已移除：** V3 assembly · legacy ASR repair 主链 · serial KenLM · normalized delta Gate (0.03) · Recall domainBoost 主分 · Beam→KenLM/Apply

**入口：** `runFwDetectorOrchestrator` → `runFwDetectorV4Path` · `pipelinePath: 'v4'`

---

## 3. 冻结合约矩阵

| Contract | 核心规则 | 文档 |
|----------|----------|------|
| Tone | timestamp-only · score penalty · 非 hard drop | [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](../recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) |
| Recall | Tone-First · TopK · **domainBoost=0** | [recall/DOMAIN_RECALL.md](../recall/DOMAIN_RECALL.md) |
| Ranking | ED 仅 tie-break · 全路径一套评分 | [assembly/RANKING_V1_2.md](../assembly/RANKING_V1_2.md) |
| Assembly | rank→filter→toneGuard→select | [assembly/FROZEN_V1_2.md](../assembly/FROZEN_V1_2.md) |
| Domain | RuntimeDomainRegistry · RS-03A | [DOMAIN_SOURCE_UNIFICATION.md](../DOMAIN_SOURCE_UNIFICATION.md) |
| KenLM Runtime | batch-only subprocess | [kenlm/KENLM_RUNTIME.md](../kenlm/KENLM_RUNTIME.md) |
| KenLM Score / Apply | rawDelta pick · Gate 3.0 | [kenlm/SCORE_CONTRACT.md](../kenlm/SCORE_CONTRACT.md) |
| Writeback | 唯一 `applyFwSpanReplacements` | [ARCHITECTURE.md](../ARCHITECTURE.md) §5 |
| Diagnostics | selected ≠ applied ≠ approved | [diagnostics/FROZEN.md](../diagnostics/FROZEN.md) |
| Context Prior | bounded multiplier only | [CONTEXT_PRIOR.md](../CONTEXT_PRIOR.md) |

**冲突优先级：** DSU **>** Context Prior **>** CONFIG / DOMAIN_RECALL 中的域描述

---

## 4. 职责边界（禁止重叠）

| 模块 | 负责 | 不负责 |
|------|------|--------|
| Recall | TopK · pinyin/tone SQL | 域硬约束 · 句级 apply |
| Ranking | 主分 · ED tie-break | domain boost |
| Domain Vote | utterance domain | per-span 选词 |
| Filter / Tone Guard / Select | 分桶 · block · 桶优先级 | 句级写回 |
| Assembly | spanSets · 句组合 | Apply 裁决 |
| KenLM | fluent score · rawDelta | 域分桶 |
| Apply Gate | pick iff Δ≥3.0 | per-span 独立写回 |
| Writeback | final text | 候选生成 |

| 决策 | 唯一 Owner |
|------|------------|
| per-span 桶归属 | Domain Filter |
| 烧饼是否进 select | Tone Guard + Select |
| 句级是否替换 | **Apply Gate** |
| final text | **Writeback** |

---

## 5. 回归冻结集

| case | 预期 |
|------|------|
| **d003** | 少冰+小杯 · 无烧饼 · `fw_applied≥1` |
| **d048/d138** | Assembly 少冰 · 无烧饼 · apply 视 Δ（可 `fw_applied=0`） |
| **d001/d002/d047** | cafe repair |
| **d082** | restaurant partial |

**全批不变量：** Dialog200 200/200 · final **0 次「烧饼」** · `minDeltaToReplace=3.0`

### GATE（单元）

| GATE | 断言 |
|------|------|
| GATE-1 | batch-only KenLM |
| GATE-2 | raw delta pick |
| GATE-RANK-01~04 | 分桶 · select · ED · Tone Guard |

语义 manifest：`tests/fw-ranking-semantics-frozen.json` · `node tests/run-fw-ranking-semantics-test.mjs`

---

## 6. 验证命令

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot|ranking-repair"
node tests/run-fw-ranking-semantics-test.mjs
```

| 检查 | 状态 |
|------|------|
| 冻结合约测试 | ✅ |
| GATE-1 / GATE-2 | ✅ |
| Ranking V1.2 语义 | ✅ |
| Dialog200 200/200 | ✅ |

---

## 7. 再冻结触发

改主链顺序 · 改 Gate 3.0 · 恢复 domainBoost · 新 writeback 路径 · 删 GATE 测试 · 静默改 diagnostics 核心字段语义

---

## 8. 词库迭代

质量杠杆在 **Lexicon** 层 — 见 [lexicon-v3/LEXICON_OPERATIONS.md](../../lexicon-v3/LEXICON_OPERATIONS.md)

---

## 9. 子模块文档

| 模块 | 路径 |
|------|------|
| Assembly | `assembly/` |
| Recall | `recall/` |
| KenLM | `kenlm/` |
| Diagnostics | `diagnostics/` |
| Compatibility | `compatibility/` |
| 接口类型 | [INTERFACE_FREEZE.md](../INTERFACE_FREEZE.md) |
| 配置 | [CONFIG.md](../CONFIG.md) |

*Supersede 2026-06-17 模块级冻结摘要与历史 FINAL_FREEZE 审计稿。*
