# FW Repair V4 — Candidate Generation Failure Audit (Pre-KenLM)

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** · Pre-KenLM · Candidate Generation Failure |
| Freeze Baseline | **FW_V4_FREEZE_2026_08_03** |
| Unchanged | Tone / Recall / Assembly / CrossPath / KenLM / Caps |
| Cases | 7 noise inventory（未改文本） |
| Evidence | A-class upstream traces + orchestrator exports |
| Artifacts | [`candidate_generation_failure_2026_08_03/`](./candidate_generation_failure_2026_08_03/) |
| Verdict | **FIRST_FAILURE_AT_RECALL_CANDIDATE** |

---

## 1. Question Answered

本轮只回答：

```text
为什么 Candidate 没有生成？
```

不回答：

```text
为什么 Tone 没有工作？
```

「Candidate」指进入 Assembly → CrossPath → KenLM 池的**句子级候选**，不是仅 Recall hit。

---

## 2. Pipeline Contract

对每个 Case，正确目标句逐步检查 YES/NO：

```text
Expected Candidate
→ Recall Candidate
→ LexicalEdge
→ SegmentationPath
→ Assembly Sentence
→ CrossPath Sentence
→ KenLM Candidate
```

FIRST FAILURE = 第一个 NO（唯一）。  
下游为空视为**级联后果**，不是独立根因，但必须写明因果链。

---

## 3. Aggregate Pipeline Matrix

| caseId | Expected | Recall | Edge | Path | Assembly | CrossPath | KenLM | FIRST FAILURE |
|--------|----------|--------|------|------|----------|-----------|-------|---------------|
| nn-train-01 | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |
| nn-train-01b | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |
| center-01 | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |
| snack-01 | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |
| sync-01 | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |
| trigger-01 | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |
| threshold-01 | YES | **NO** | NO | NO | NO | NO | NO | **RecallCandidate** |

```text
7 / 7 FIRST_FAILURE = RecallCandidate
correctCandidateGenerated = false（7/7）
```

---

## 4. Cascade（禁止停在 Recall=0）

观测事实：`observedRecallCandidateCount=0`，`observedEdgeCount=0`。

| Stage | YES/NO | 为何为空（级联说明） |
|-------|--------|----------------------|
| Recall Candidate | **NO** | 正确原子未进入观测 Recall hits（见 §5） |
| LexicalEdge | NO | 无 expected Recall Candidate 可 bind → Edge 无法承载正确 surface |
| SegmentationPath | NO | 无 expected LexicalEdge → Path 无正确替换边 |
| Assembly Sentence | NO | 无 expected Path 材料；仅产出 **Raw canonical/fallback** 句（非修复异文） |
| CrossPath Sentence | NO | 无正确 Assembly 句进入 merge；**不是** Dedupe/Budget/Limit 删掉正确句 |
| KenLM Candidate | NO | CrossPath 池无正确句；Raw binding 正常（非 KenLM 丢候选） |

结论：

```text
正确 Candidate 从未被生成。
CrossPath / KenLM 没有“删掉已生成的正确 Candidate”。
```

---

## 5. Why RecallCandidate = NO（按 Case，仅记录）

| caseId | requiredAtoms | atomsFormalExist | recallNoReason（事实） |
|--------|---------------|------------------|------------------------|
| snack-01 | 小食 | false | expected_atom_absent_from_lexicon:小食 |
| trigger-01 | 触发 | false | expected_atom_absent_from_lexicon:触发 |
| threshold-01 | 阈值 | false | expected_atom_absent_from_lexicon:阈值 |
| nn-train-01 | 我们+正在 | true | 我们 在当前 Exact 合同下不可召回（tone key=wo3\|men0） |
| nn-train-01b | 正在 | true | 噪声窗拼音 men\|zheng ≠ 正在 zheng\|zai |
| center-01 | 中心 | true | 观测 Recall hits 中 expected=0 |
| sync-01 | 已经+同步 | true | 观测 Recall hits 中 expected=0 |

本轮**不**建议恢复 Plain Fallback、改 Tone、改 Recall、加白名单。只定位 FIRST FAILURE。

---

## 6. Assembly：多原子组合

目标检查：`已经 + 同步` → 句面「已经同步」；`我们 + 正在` → 「我们正在」。

| 检查 | 结果 |
|------|------|
| Assembly 是否产出含全部正确原子的异文句 | **NO**（7/7） |
| 是否因 Assembly 组合算法拒绝共存 | **不可观测** |
| 原因 | 上游 Recall/Edge/Path 无正确原子材料；Assembly 仅 Raw canonical |

因此：**不能**把 FIRST FAILURE 标成 Assembly——Assembly 从未收到可组合的正确边。

---

## 7. CrossPath

| 检查 | 结果 |
|------|------|
| 正确句是否进入 CrossPath 前池 | NO |
| 是否被 exact-text dedupe 删除 | **否**（无正确句可删） |
| 是否被 ≤16 cap 截断 | **否**（池仅 1 条 Raw） |
| Filter/Budget 删除正确句 | **否** |

FIRST FAILURE 不是 CrossPath。

---

## 8. Candidate Export（每 Case）

每案实际进入 CrossPath/KenLM 的列表：

### nn-train-01
1. `我闷蒸在升级公司内部的专家系统平台。`（Raw）  
正确 Candidate：**不存在**

### nn-train-01b
1. `我闷蒸在训练神经网络模型。`（Raw）  
正确 Candidate：**不存在**

### center-01
1. `微服务会定时向注册忠心上报健康状态。`（Raw）  
正确 Candidate：**不存在**

### snack-01
1. `客房里的迷你吧提供饮料和消失。`（Raw）  
正确 Candidate：**不存在**

### sync-01
1. `回归测试报告已精通步给质量保障团队。`（Raw）  
正确 Candidate：**不存在**

### trigger-01
1. `调用下游超时后会出发熔断策略保护。`（Raw）  
正确 Candidate：**不存在**

### threshold-01
1. `熔断策略阈之一按错误率重新校准。`（Raw）  
正确 Candidate：**不存在**

（离线 expected 文本仅出现在评估标记行 `EXPECTED_ABSENT`，未进入生产池。）

---

## 9. Case FIRST FAILURE（唯一）

| caseId | FIRST FAILURE |
|--------|---------------|
| nn-train-01 | RecallCandidate |
| nn-train-01b | RecallCandidate |
| center-01 | RecallCandidate |
| snack-01 | RecallCandidate |
| sync-01 | RecallCandidate |
| trigger-01 | RecallCandidate |
| threshold-01 | RecallCandidate |

---

## 10. Artifacts

| File | Path |
|------|------|
| `candidate_generation_pipeline.csv` | `docs/acceptance/Freeze/candidate_generation_failure_2026_08_03/` |
| `candidate_generation_failures.csv` | 同上 |
| `candidate_generation_candidates.csv` | 同上 |
| 副本 | `docs/tone-v2/_audit_scratch/candidate_generation_failure_2026_08_03/` |
| 本报告 | `docs/acceptance/Freeze/` + `docs/tone-v2/` |

---

## 11. Final Verdict

```text
FIRST_FAILURE_AT_RECALL_CANDIDATE
```

7/7 正确句子级 Candidate 在 **Recall Candidate** 阶段首次缺失；  
LexicalEdge / Path / Assembly / CrossPath / KenLM 为空均为级联，  
其中 CrossPath 与 KenLM **未删除**已生成的正确 Candidate（因其从未生成）。
