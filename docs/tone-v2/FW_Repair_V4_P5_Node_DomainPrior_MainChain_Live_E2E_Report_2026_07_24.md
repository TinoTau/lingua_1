# FW Repair V4 — P5 Node DomainPrior Main-Chain Live E2E Report

**Date:** 2026-07-24  
**Task:** 启动节点端 → 完成 prior 主链测试 → 出具报告  
**Runtime:** Electron Node `:5020` + FW ASR `:6007`（本轮未依赖 Scheduler / Model Hub / Web）

---

## 1. Runtime Bring-up

| Step | Result |
|------|--------|
| `scripts/start_electron_node.ps1` | 已启动 |
| `GET http://127.0.0.1:5020/health` | `ok` |
| `GET http://127.0.0.1:6007/health` | OK |
| WAV | `test wav/dialog_200/dialog_d001.wav` |
| Entry | `POST /run-pipeline-with-audio` |

Artifacts dir:

```text
docs/tone-v2/_e2e_artifacts/live_20260724_061843/
```

---

## 2. Gate Results

| Gate | Result |
|------|--------|
| Node test server ready | **PASS** |
| ASR ready | **PASS** |
| Scheduler / Web | **N/A**（按既定范围只测节点） |

---

## 3. Scenario Results

### A — Non-empty `coffee`

| Field | Value |
|-------|-------|
| Request | `domainPriors:[{domain:coffee,weight:1}]` |
| HTTP | 200 |
| `domainPriorsFieldPresentOnJob` | `true` |
| `domainPriorsBound` | `{"domain":"coffee","weight":1}` |
| `fineSpanPriorSource` | `domainPriors` |
| Artifact | `live_20260724_061843/A_nonempty.json` |

**PASS**

### B — Next job `tourism_transport`（相对 A 切换，无串用）

| Field | Value |
|-------|-------|
| Request | `domainPriors:[{domain:tourism_transport,weight:1}]` |
| HTTP | 200 |
| `domainPriorsBound` | `{"domain":"tourism_transport","weight":1}` |
| `fineSpanPriorSource` | `domainPriors` |
| Artifact | `live_20260724_061843/B_next_job_domain_b.json` |

**PASS**

### C — Explicit empty `[]`

| Field | Value |
|-------|-------|
| Request | `domainPriors:[]` |
| HTTP | 200 |
| `domainPriorsFieldPresentOnJob` | `true` |
| `domainPriorsBound` | `[]` |
| `fineSpanPriorSource` | `none` |
| Artifact | `live_20260724_061843/C_explicit_empty.json` |

**PASS**

### D — Missing field

| Field | Value |
|-------|-------|
| Request | 无 `domainPriors` |
| HTTP | 200 |
| `domainPriorsFieldPresentOnJob` | `false` |
| `domainPriorsBound` | `[]` |
| `fineSpanPriorSource` | `none` |
| Artifact | `live_20260724_061843/D_missing.json` |

**PASS**

---

## 4. Runtime Evidence Matrix

| Scenario | Job field | ctx bound | fineSpanPriorSource | HTTP |
|----------|-----------|-----------|---------------------|------|
| A coffee | present | coffee@1 | domainPriors | 200 |
| B tourism_transport | present | tourism_transport@1 | domainPriors | 200 |
| C [] | present | [] | none | 200 |
| D missing | absent | [] | none | 200 |

Verified chain:

```text
HTTP body.domainPriors
→ JobAssign.domainPriors
→ applyDomainPriorsFromJob / sanitizeDomainPriors
→ ctx.domainPriors (= extra.domainPriorsBound)
→ spanAssembly fineSpanPriorSource
```

---

## 5. First Failure Boundary

无。四场景全部 HTTP 200 且 prior 绑定符合契约。

---

## 6. Audio Payload Ordering Observation

单 Job / 单 WAV 入口，本轮无多 chunk ordering 观测。P1 仍独立。

---

## 7. Final Verdict

```text
Node DomainPrior Main-Chain E2E
PASS
```

```text
Production AudioChunk Dual-Turn E2E（Web → Scheduler → Node）
INCOMPLETE
```

（全链仍未跑；本报告仅关闭节点段。）

---

## 8. Next Step

- 节点 soft prior 消费链：可视为验收通过。  
- 若需 Dual-Turn 全链 PASS：另开可达的 Web→Scheduler 联调窗口（不强制复活过时接口）。  
- 全链通过后才进入 P5 Final Compliance / Freeze Audit。
