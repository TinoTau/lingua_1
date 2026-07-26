# FW Repair V4 — P5 Node DomainPrior Main-Chain E2E Report

**Date:** 2026-07-24  
**Scope:** 节点端主链（按用户纠正：不依赖过时 Scheduler / Model Hub）  
**Code Change:** 最小透传 — `test-server` / `runPipelineWithAudio` 可选 `domainPriors` → JobAssign；`extra.domainPriorsBound` 观测字段；`ltr_fine_span` 类型补齐（仅为编译通过）

---

## 1. Runtime Bring-up

| Component | Status |
|-----------|--------|
| Electron Node `:5020` | 已用于本轮跑批（跑批后进程已退出） |
| FW ASR `:6007` | 跑批时可用 |
| Scheduler / Model Hub | **未作为验收依赖**（接口过时，按指示跳过） |
| Web AudioChunk | **本轮不测** |

入口：

```text
POST http://127.0.0.1:5020/run-pipeline-with-audio
WAV: test wav/dialog_200/dialog_d001.wav
```

---

## 2. Gate Results

| Gate | Result |
|------|--------|
| Node test server health | PASS（跑批时 `ok`） |
| ASR health `:6007` | PASS（跑批时可用） |
| Scheduler registered | **N/A（本轮不做）** |
| Web SessionInitAck | **N/A（本轮不做）** |

---

## 3. Scenario Results

### A — Non-empty `DOMAIN_A=coffee`

| Layer | Value |
|-------|-------|
| Request `domainPriors` | `[{"domain":"coffee","weight":1}]` |
| JobAssign field present | `true` |
| `extra.domainPriorsBound` | `{"domain":"coffee","weight":1}` |
| `fineSpanPriorSource` | `domainPriors` |
| Artifact | `_e2e_artifacts/A_nonempty.json` |

**PASS**

### B — Next job uses `DOMAIN_B=tourism_transport`（节点侧“下一句新 prior”）

说明：节点不做 Session SSOT；本场景验证**后一 Job**携带新 prior 时，绑定结果切换为 B（对应全链 Turn3 读新状态的节点段）。

| Layer | Value |
|-------|-------|
| Request `domainPriors` | `[{"domain":"tourism_transport","weight":1}]` |
| `extra.domainPriorsBound` | `{"domain":"tourism_transport","weight":1}` |
| `fineSpanPriorSource` | `domainPriors` |
| Artifact | `_e2e_artifacts/B_next_job_domain_b.json` |

**PASS**（相对 A 的 coffee 已切换，无串用）

### C — Explicit empty `[]`

| Layer | Value |
|-------|-------|
| Request `domainPriors` | `[]` |
| JobAssign field present | `true` |
| `extra.domainPriorsBound` | `[]`（count=0） |
| `fineSpanPriorSource` | `none` |
| Artifact | `_e2e_artifacts/C_explicit_empty.json` |

**PASS**

### D — Missing field

| Layer | Value |
|-------|-------|
| Request | 无 `domainPriors` 字段 |
| JobAssign field present | `false` |
| `extra.domainPriorsBound` | `[]`（sanitize no-prior） |
| `fineSpanPriorSource` | `none` |
| Artifact | `_e2e_artifacts/D_missing.json`（session `p5-node-prior-D2`） |

注：首次 D（`p5-node-prior-D`）曾 HTTP 500；重跑 D2 成功。失败未改变 prior 契约结论。

**PASS**

---

## 4. Runtime Evidence Matrix

| Scenario | Job field present | ctx / `domainPriorsBound` | `fineSpanPriorSource` |
|----------|-------------------|---------------------------|------------------------|
| A coffee | true | coffee@1 | domainPriors |
| B tourism_transport | true | tourism_transport@1 | domainPriors |
| C [] | true | [] | none |
| D missing | false | [] | none |

主链（本轮实际验证）：

```text
HTTP domainPriors
→ runPipelineWithAudio JobAssign.domainPriors
→ applyDomainPriorsFromJob / sanitizeDomainPriors
→ ctx.domainPriors（extra.domainPriorsBound）
→ spanAssemblyV4 fineSpanPriorSource
```

---

## 5. First Failure Boundary

无 prior 契约失败。

运维噪声：D 首次 500（后重跑成功）— 非 domainPriors 绑定错误。

---

## 6. Audio Payload Ordering Observation

本轮为单 WAV / 单 Job 入口，**未观察**多 AudioChunk final-overtake。  
P1 仍独立挂起。

---

## 7. Final Verdict

```text
Node DomainPrior Main-Chain E2E
PASS
```

```text
Production AudioChunk Dual-Turn E2E（Web→Scheduler→Node 全链）
INCOMPLETE
```

原因：按指示本轮只完成节点段；Web Snapshot / Wire AudioChunk / Scheduler Actor / Job 固化层未跑。

---

## 8. Next Step

1. **可选：** 在真实 Web AudioChunk 联调窗口再补全 Dual-Turn 全链（不强制复活旧 Scheduler 接口，需另定可达联调方式）。  
2. 若仅关心节点 soft prior 消费：本报告即可作为节点段验收关闭。  
3. 全链 PASS 后才进入 P5 Final Compliance / Freeze Audit；仍勿直接 dialog_200。

---

### Artifacts

- `docs/tone-v2/_e2e_artifacts/A_nonempty.json`
- `docs/tone-v2/_e2e_artifacts/B_next_job_domain_b.json`
- `docs/tone-v2/_e2e_artifacts/C_explicit_empty.json`
- `docs/tone-v2/_e2e_artifacts/D_missing.json`
