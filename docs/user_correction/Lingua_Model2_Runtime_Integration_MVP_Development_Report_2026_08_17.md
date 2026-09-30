# Lingua Model2 — Runtime Integration MVP Development Report

**Date:** 2026-08-17  
**Phase:** `MODEL2_RUNTIME_INTEGRATION_MVP_DEVELOPMENT`  
**Label:** `RUNTIME_INTEGRATION_SKELETON` — **not** `MODEL2_RUNTIME_COMPLETE`  
**Baseline:** `Lingua_Model2_Runtime_Integration_MVP_PreDevelopment_Audit_2026_08_17.md`  
**Artifacts:** `training/model2_v3/experiments/v3_runtime_integration_mvp_dev/`

---

## 1. What was built

真实 Node 主链第一次接通：

```
SessionBootstrap UserProfile
  → JobContext.userProfileV1
  → span-assembly-v4-orchestrator (after activeCandidates)
  → Stage P Trainable Model2 (Python sidecar singleton)
  → selected actions
  → Node LexiconRuntimeV2.recallSpanTopKV2
  → WindowCandidate (PROFILE_RETRIEVAL)
  → termId merge
  → existing DomainAwareAssembly
  → KenLM
```

---

## 2. P0-A — Stable feature hash

| Item | Result |
|------|--------|
| Contract | `MODEL2_FEATURE_HASH_V1` (FNV-1a64, seed=`0x4D324841534831`) |
| Python | `training/model2_v3/policy/feature_hash_v1.py` |
| Node | `electron_node/.../model2-runtime/feature-hash-v1.ts` |
| Golden | `model2_feature_golden_vectors.json` (50 vectors) — **PASS** |
| Stage P uses V1? | **NO** |

**CHECKPOINT_COMPATIBILITY_BLOCKER：**  
Stage P 权重用训练时 `hash()` / `pack_batch_inputs`。若把 Stage P 推理切到 V1 而不重训，span feature 语义改变。本轮**未重训**。Stage P skeleton 在 Python sidecar 内继续用 **training feature pack**。Stage J 必须用 V1 训练。

---

## 3. P0-B — Inference host

| Item | Result |
|------|--------|
| Mechanism | **APPROVED_EXISTING_SIDECAR**（JSONL stdin/stdout，非 HTTP） |
| Script | `electron_node/services/model2_runtime/model2_inference_host.py` |
| Client | process-level singleton `getModel2InferenceHost()` |
| Checkpoint | Stage P `stage_p_checkpoint.pt`（单文件） |
| ONNX | 尝试 export；本机缺 `onnx` 包 → 未部署；runtime 不依赖 ONNX |
| Dual P+D | **禁止且未做** |

失败语义：load/infer fail → log → Model2 no-op → base recall 继续。

---

## 4. P0-C — UserProfile plumbing

```
sessionUserProfiles → handleJob → JobProcessor → InferenceService(options)
  → JobContext.userProfileV1 → fw-detector-v4-path → orchestrator.userProfile
```

无第二 cache、无 Gateway 重查、未写入 JobResult。

---

## 5. P0-D…G — Adapters / merge

| Module | Role |
|--------|------|
| `finespan-adapter.ts` | PathFineSpan → `Model2PolicyInput` |
| `relation-direction.ts` | X_Y 方向 SSOT + hypothesize |
| `relation-lexicon-adapter.ts` | actions → `recallSpanTopKV2` |
| `candidate-materialize.ts` | hits → `WindowCandidate` + provenance |
| `merge-profile-candidates.ts` | termId 单次 merge |
| orchestrator insertion | after `activeCandidates`, before `runDomainAwareAssembly` |

---

## 6. What this does NOT prove

- Stage J unified checkpoint  
- Stage D production profile  
- session domain prior  
- Full adaptation loop  
- `MODEL2_RUNTIME_COMPLETE`

---

## 7. Files

见 `modified_file_inventory.csv`。

---

## 8. Next phase

在**不重写 runtime 架构**的前提下：

1. Stage D freeze（真实 writeback）  
2. Stage J unified training（**必须** `MODEL2_FEATURE_HASH_V1`）  
3. 将 sidecar 中 Stage P-only checkpoint 替换为 ONE unified Model2 checkpoint  
