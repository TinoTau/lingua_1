# Semantic Repair Main-Chain Decoupling Plan

Date: 2026-05-16

Status: Execution Plan  
Scope: Node-side JobPipeline semantic repair hot-plug cleanup

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

Specifically:

```text
ASR → NMT → TTS
```

must remain functional even when:

```text
5015 semantic repair service is disabled
service not running
use_semantic=false
features.semanticRepair.enabled=false
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
| PUNCTUATION_RESTORE | enablePunctuationRestore + service running |
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

# T6 — Translation Must Not Depend on Semantic Repair

Modify:

```text
translation-step.ts
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

# T7 — Keep 5016/5017 Independent

5016 and 5017 must not depend on semantic repair flags.

Independent gating required.

---

# 5. File-Level Change Scope

## Core Files

```text
pipeline-mode-config.ts
pipeline-step-registry.ts
semantic-repair-step.ts
translation-step.ts
job-context.ts
result-builder.ts
```

---

## Semantic Repair Paths

```text
task-router-semantic-repair.ts
semantic-repair-stage-en.ts
semantic-repair-stage-zh.ts
candidate-rank-zh.ts
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

---

## Text Flow

- [ ] semantic disabled → repairedText falls back to original text
- [ ] semantic skipped → final text remains non-empty
- [ ] translation input always valid
- [ ] TTS input always valid
- [ ] text_asr preserved
- [ ] text_translated preserved

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

---

## Tests

- [ ] zh + semantic disabled → ASR/NMT/TTS works
- [ ] en + semantic disabled → ASR/NMT/TTS works
- [ ] semantic enabled + service not running → skip
- [ ] semantic enabled + service running → real HTTP repair
- [ ] translation still works when semantic skipped
- [ ] no SEMANTIC_REPAIR GPU lease unless actual repair

---

# 7. Recommended Patch Order

## P0

Decouple translation-step from semantic repair flags.

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
- reintroduce punctuation into mandatory main chain

The scope is strictly:

```text
semantic repair service boundary cleanup
```
