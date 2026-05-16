# Semantic Repair Main-Chain Decoupling Plan (Revised)

Date: 2026-05-16  
Status: Execution Plan  
Scope: Node-side JobPipeline semantic repair hot-plug cleanup

---

# 0. References & Current Baseline

## Related Audit

Associated readonly audit:

```text
docs/MainChain_SemanticRepair_Readonly_Audit_2026-05-16.md
```

---

## Current Overall Status

Current audit result:

```text
NOT PASSING
```

Primary root causes:

1. `use_semantic` is read but not wired into actual step execution.
2. `ctx.shouldSendToSemanticRepair` simultaneously gates:
   - 5016 phonetic correction
   - 5017 punctuation restore
   - 5015 semantic repair
   - NMT translation
3. `semantic-repair-step.ts`
   may set:
   ```text
   ctx.shouldSend = false
   ```
   when initializer/stage unavailable.

This is currently more severe than:
"semantic repair skipped".

---

## Current Verified Production Facts

### Real 5015 HTTP entry

```text
task-router-semantic-repair.ts
→ POST /repair
(service id: semantic-repair-en-zh)
```

### candidate-rank-zh.ts

Confirmed:

```text
NO SUCH FILE in current repository
```

Do NOT include it in cleanup scope.

---

# 0.1 Must-Fix Paths

In addition to semantic repair skip logic:

## semantic-repair-step.ts

Forbidden:

```text
initializer/stage missing
→ ctx.shouldSend=false
```

Must become:

```text
skip semantic repair only
```

---

## aggregation-step.ts

Forbidden:

```text
semantic repair disabled
→ repairedText=''
```

Must distinguish:

### A. HOLD / deferred translation

Legitimate:

```text
turn not finalized
```

### B. semantic repair disabled

Must NOT block translation.

---

# 0.2 New Config Fields

The following fields do NOT currently exist and must be added explicitly:

```text
features.semanticRepair.enabled
job.pipeline.use_phonetic (optional)
features.punctuationRestore.enabled
```

---

## Default Policy

Must define:

```text
when job.pipeline.use_semantic omitted
```

Recommended default:

```text
true
```

for backward compatibility.

---

# 1. Goal

Current pipeline behavior still contains implicit coupling between:

```text
SEMANTIC_REPAIR
PUNCTUATION_RESTORE
PHONETIC_CORRECTION
TRANSLATION
```

through shared flags such as:

```text
ctx.shouldSendToSemanticRepair
```

This creates the risk that:

```text
semantic repair unavailable
→ translation chain blocked
```

The goal of this cleanup is:

```text
Make semantic repair a true hot-pluggable optional service.
```

---

# 2. Hard Requirements

## 2.1 Required Behavior

The following chain MUST continue working:

```text
ASR
→ aggregation
→ translation
→ TTS
```

even if semantic repair is unavailable.

---

## 2.2 Forbidden Behavior

Forbidden:

```text
semantic repair unavailable
→ translation skipped
→ TTS skipped
→ final text empty
```

Forbidden:

```text
5015 disabled
→ still POST /repair
```

Forbidden:

```text
semantic_repair_applied=true
```

when no real semantic repair HTTP call occurred.

---

# 3. Target Architecture

## 3.1 Service Independence

The following services must become independently gated:

| Service | Gate |
|---|---|
| PHONETIC_CORRECTION | use_phonetic + service running |
| PUNCTUATION_RESTORE | punctuationRestore.enabled + service running |
| SEMANTIC_REPAIR | use_semantic + semanticRepair.enabled + service running |
| TRANSLATION | use_nmt + text exists |
| TTS | use_tts + translated text exists |

---

## 3.2 Semantic Repair Hot-Plug

Target behavior:

```text
5015 available
→ semantic repair executes
```

```text
5015 unavailable
→ semantic repair skipped
→ main chain continues
```

---

# 4. Target List

# T0 — Preserve Minimal Main Chain

Mandatory working chain:

```text
ASR → NMT → TTS
```

must always work independently of semantic repair.

---

# T1 — Connect use_semantic

Modify:

```text
pipeline-mode-config.ts
loadNodeConfig()
node-config-types.ts
```

Requirements:

```text
job.pipeline.use_semantic=false
→ SEMANTIC_REPAIR not executed
```

and:

```text
features.semanticRepair.enabled=false
→ SEMANTIC_REPAIR not executed
```

Must explicitly define:

```text
default policy when omitted
```

---

# T2 — Split shouldSendToSemanticRepair

Current:

```text
ctx.shouldSendToSemanticRepair
```

must no longer control multiple unrelated services.

Replace/split into:

```ts
ctx.shouldRunPhoneticCorrection
ctx.shouldRunPunctuationRestore
ctx.shouldRunSemanticRepairHttp
ctx.shouldAllowTranslation
ctx.shouldDeferTranslation
```

---

# T3 — Skip Instead of Blocking

When 5015 unavailable:

```text
skip SEMANTIC_REPAIR
retain original text
continue translation
continue TTS
```

Expected state:

```json
{
  "semantic_repair_applied": false,
  "semantic_repair_skipped": true,
  "semantic_repair_skip_reason": "SERVICE_NOT_RUNNING"
}
```

---

# T3b — MUST NOT set shouldSend=false

Current blocker:

```text
initializer/stage missing
→ ctx.shouldSend=false
```

Forbidden after cleanup.

Required behavior:

```text
semantic repair disabled/unavailable
→ repairedText fallback
→ translation still allowed
```

---

# T4 — Remove EN Silent PASS

Current EN behavior:

```text
catch → PASS → original text
```

must become explicit degraded/skip behavior.

Recommended:

```json
{
  "semantic_repair_applied": false,
  "semantic_repair_degraded": true,
  "semantic_repair_skip_reason": "SERVICE_ERROR"
}
```

---

# T4b — ZH Path / Router Boundaries

Must audit and constrain:

```text
semantic-repair-stage-zh.ts
withGpuLease('SEMANTIC_REPAIR')
```

Requirements:

```text
disabled → step not entered
```

and:

```text
task-router-semantic-repair.ts
```

Production behavior:

```text
no isServiceRunningCallback
→ no HTTP allowed
```

Test-only synthetic behavior must not leak into production.

---

# T5 — Redefine Semantic Repair Fields

Recommended fields:

```json
{
  "semantic_repair_http_called": false,
  "semantic_repair_http_applied": false,
  "semantic_repair_skipped": true,
  "semantic_repair_skip_reason": "DISABLED_OR_NOT_RUNNING"
}
```

Rule:

```text
semantic_repair_applied=true
ONLY when real 5015 HTTP semantic repair succeeded.
```

---

## EN Normalize Clarification

Forbidden:

```text
normalize only
→ semantic_repair_applied=true
```

Instead:

```json
{
  "en_normalize_applied": true,
  "semantic_repair_http_applied": false
}
```

---

# T6 — Translation Must Not Depend on Semantic Repair

Modify:

```text
translation-step.ts
aggregation-step.ts
```

Forbidden:

```text
shouldSendToSemanticRepair=false
→ translation skipped
```

Target:

```text
translation executes whenever:
use_nmt=true
and valid text exists
```

Translation input priority:

```text
ctx.repairedText
→ ctx.segmentForJobResult
→ ctx.asrText
```

---

## aggregation-step Clarification

Must distinguish:

### semantic disabled

Allowed:

```text
translation continues
repairedText retained
```

### defer translation / hold

Allowed:

```text
translation intentionally delayed
```

These are NOT the same state.

---

# T7 — Keep 5016/5017 Independent

5016 and 5017 must not depend on semantic repair flags.

Independent gating required.

Must define whether:

```text
fail-open
(skip)
```

or:

```text
fail-closed
(block pipeline)
```

Recommended:

```text
fail-open
```

for punctuation and phonetic correction.

---

# 5. File-Level Change Scope

## Core Files

```text
pipeline-mode-config.ts
semantic-repair-step.ts
translation-step.ts
aggregation-step.ts
job-context.ts
result-builder.ts
job-pipeline.ts
```

---

## Semantic Repair Paths

```text
task-router-semantic-repair.ts
postprocess-semantic-repair-initializer.ts
semantic-repair-stage.ts
semantic-repair-stage-en.ts
semantic-repair-stage-zh.ts
```

---

## Config / Protocol

```text
node-config-types.ts
loadNodeConfig()
inference-service.ts
webapp/shared/protocols/messages.ts
```

---

## Profiling / Reporting

```text
latency_audit
job result extra
profiling scripts
```

---

# 6. Checklist

## Main-Chain Gating

- [ ] use_semantic=false disables SEMANTIC_REPAIR
- [ ] semanticRepair.enabled=false disables SEMANTIC_REPAIR
- [ ] 5015 not running → no HTTP /repair
- [ ] 5015 unavailable → NMT still executes
- [ ] 5015 unavailable → TTS still executes
- [ ] translation-step no longer depends on shouldSendToSemanticRepair
- [ ] semantic disabled does NOT set shouldSend=false

---

## Text Flow

- [ ] semantic disabled → repairedText falls back to original text
- [ ] semantic skipped → final text remains non-empty
- [ ] translation input always valid
- [ ] TTS input always valid
- [ ] text_asr preserved
- [ ] text_translated preserved
- [ ] aggregation-step no longer clears repairedText on semantic-disabled path

---

## HTTP / GPU

- [ ] no POST /repair when disabled
- [ ] no SEMANTIC_REPAIR GPU lease when disabled
- [ ] 5016 independent from semantic repair
- [ ] 5017 independent from semantic repair
- [ ] 5015 HTTP only when enabled and running

---

## Result / Extra Fields

- [ ] semantic_repair_applied only means real HTTP repair
- [ ] semantic_repair_skipped added
- [ ] semantic_repair_skip_reason added
- [ ] semantic_repair_http_called added
- [ ] semantic_repair_http_applied added
- [ ] EN SERVICE_ERROR no longer masquerades as success
- [ ] normalize-only no longer sets semantic_repair_applied=true

---

## Tests

- [ ] zh + semantic disabled → ASR/NMT/TTS works
- [ ] en + semantic disabled → ASR/NMT/TTS works
- [ ] semantic enabled + service not running → skip
- [ ] semantic enabled + service running → real HTTP repair
- [ ] translation still works when semantic skipped
- [ ] no SEMANTIC_REPAIR GPU lease unless actual repair
- [ ] semantic-disabled no longer clears repairedText
- [ ] defer translation still blocks intentionally

---

# 7. Recommended Patch Order

## P0

Decouple translation-step and aggregation-step from semantic repair flags.

---

## P1

Connect:

```text
use_semantic
features.semanticRepair.enabled
```

into shouldExecuteStep.

---

## P2

Implement explicit semantic skip/degraded states.

---

## P3

Update result-builder and profiling fields.

---

## P4

Add smoke/integration tests.

---

# 8. Acceptance Criteria

The cleanup is considered complete only if:

```text
5015 disabled
→ no HTTP repair call
→ no GPU lease
→ translation still executes
→ TTS still executes
→ final output remains valid
```

and:

```text
semantic repair becomes fully optional.
```

---

# 9. Non-Goals

This cleanup MUST NOT:

- reintroduce semantic rewrite
- redesign repair architecture
- add new LLM logic
- modify ASR pipeline
- modify NMT models
- modify TTS models
- expand punctuation into mandatory main chain

The scope is strictly:

```text
semantic repair service boundary cleanup
```
