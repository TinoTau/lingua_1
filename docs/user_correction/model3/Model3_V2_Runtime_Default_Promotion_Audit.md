# Model3 V2 Runtime Default Promotion Audit

**Phase:** `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_AUDIT`  
**Mode:** `READ_ONLY`（未修改任何 production code / config / registry）  
**Date:** 2026-09-08  
**Verdict:** `MODEL3_V2_RUNTIME_PROMOTION_AUDIT_PASS_TYPE_B_IDENTITY_GUARD_WORK`

---

## Concept separation (current reality)

| ID | Concept | Current value |
| -- | ------- | ------------- |
| **A** | `AUTHORITATIVE_V2_ARTIFACT` | `MODEL3_V2_S3_RANDOM_INIT_V1`（freeze seal） |
| **B** | `RUNTIME_DEFAULT_CHECKPOINT` | **`MODEL3_SYNTHETIC_V1`** |
| **C** | `RUNTIME_SELECTED_CHECKPOINT` | env `MODEL3_CHECKPOINT_IDENTITY` if set；否则 = B |
| **D** | `MODEL3_INFERENCE_ENABLED` | **YES**（主链每 path 调用 `runModel3PathStep` → infer） |
| **E** | `PRODUCTION_RETRY_ENABLED` | **YES**（主链无独立 OFF 门；始终 `routeModel3Retry`） |

Frozen starting state（不重验收）：Model3 V2 / Retry / Delta1 / Delta2 = FROZEN；开发阶段 CLOSED。

---

## Required final answers

| ID | Answer |
| -- | ------ |
| **A** `CURRENT_NORMAL_ELECTRON_DEFAULT_MODEL` | **`MODEL3_SYNTHETIC_V1`** |
| **B** `CURRENT_S3_REGISTRY_ROLE` | **`CANDIDATE`** |
| **C** `S3_ACCEPTANCE_USED_EXPLICIT_IDENTITY` | **YES** |
| **D** `MODEL3_INFERENCE_ACTIVE_IN_NORMAL_RUNTIME` | **YES** |
| **E** `PRODUCTION_RETRY_ENABLED` | **YES**（代码现实；契约文案仍写 OFF → 文档歧义） |
| **F** `S3_PROMOTION_AUTO_ENABLES_RETRY` | **NO**（Retry 已在主链启用；promotion 只换 checkpoint） |
| **G** `S3_RUNTIME_COMPATIBILITY` | **PASS**（同 BiGRU / 6-feat；acceptance 已加载 S3） |
| **H** `RUNTIME_IDENTITY_GUARD_COMPLETE` | **NO**（weights+config SHA 有；datasetId/buildId 无 runtime 校验；另有陈旧 seal 常量） |
| **I** `SYNTHETIC_V1_RUNTIME_DEPENDENCY` | **YES**（default id / deprecated label / Python host defaults / seal constants）— **非语义分支依赖** |
| **J** `PROMOTION_IS_SINGLE_SEMANTIC_VARIABLE` | **YES**（仅 default identity + seal 对齐；不碰 Retry enablement） |
| **K** `ARCHITECTURE_CHANGE_REQUIRED` | **NO** |

---

## Why S3 is not Electron default

唯一原因（代码）：

```73:76:electron_node/electron-node/main/src/model3-runtime/model3-checkpoint-registry.ts
export function resolveModel3CheckpointIdentityId(): string {
  const raw = process.env.MODEL3_CHECKPOINT_IDENTITY?.trim();
  if (!raw) return MODEL3_PRODUCTION_IDENTITY_ID;
```

`MODEL3_PRODUCTION_IDENTITY_ID = 'MODEL3_SYNTHETIC_V1'`  
S3 条目 `role: 'CANDIDATE'`。

无 `.env` / launch / CI 默认写入 `MODEL3_CHECKPOINT_IDENTITY=S3`。

**结论：** 过去 S3 acceptance/replay **依赖 explicit identity**；普通 Electron 无 env 仍跑 Synthetic V1。→ **YES**。

---

## Registry / selection owner

| Item | Location |
| ---- | -------- |
| Registry | `model3-checkpoint-registry.ts` |
| Default | `MODEL3_PRODUCTION_IDENTITY_ID` → `MODEL3_SYNTHETIC_V1` |
| S3 role | `CANDIDATE`（L49–59） |
| Resolve | `resolveModel3CheckpointIdentityId()` / `getModel3CheckpointIdentity()` |
| Active load | `getActiveModel3Identity()` → `Model3InferenceHost._start()` in `model3-inference-client.ts` |
| Mainline call | `span-assembly-v4-orchestrator.ts` → `runModel3PathStep()` |
| Invalid identity | `throw unknown_model3_checkpoint_identity:...` |
| Missing env | fall back to `MODEL3_PRODUCTION_IDENTITY_ID` |

### Env surface

| Env | Effect |
| --- | ------ |
| `MODEL3_CHECKPOINT_IDENTITY` | 选择 registry key；**唯一正常选择器** |
| `MODEL3_SYNTHETIC_V1_CHECKPOINT` | 仅当 identity=`MODEL3_SYNTHETIC_V1` 时覆盖路径 |
| `MODEL3_CANDIDATE_CHECKPOINT` | 仅当 `role===CANDIDATE` 时覆盖路径 |
| `MODEL3_PYTHON` / `MODEL2_PYTHON` / `PYTHON` | sidecar 解释器 |
| `MODEL3_HARNESS_KEEP_ALL` | test：KEEP-all（非 production default） |
| `MODEL3_ACCEPTANCE_CAUSAL_FORK` 等 | acceptance-only |

`electron_node/.env.example`：**无**任何 `MODEL3_*`。

**Normal Electron, no env → loads `MODEL3_SYNTHETIC_V1` only.**

---

## End-to-end selection

```text
Electron startup
  → (no MODEL3_CHECKPOINT_IDENTITY)
  → resolveModel3CheckpointIdentityId() = MODEL3_SYNTHETIC_V1
  → registry path …/model3_v1_full100k…/seed_2026082520
  → verify weights SHA vs registry expected
  → Python host load (config_hash mode from registry)
  → runModel3PathStep → inferPath → routeModel3Retry
```

### Observability

Diagnostics 含 `checkpointIdentity: { modelId, weightsSha256, role? }`；load 成功 log：`label`, `sha256`, `role`, `checkpoint`。

**非** `RUNTIME_MODEL_IDENTITY_OBSERVABILITY_GAP`。

---

## Execution context matrix

见 `model3_v2_runtime_selection_matrix.csv`。

核心：**S3 acceptance 用 explicit `MODEL3_CHECKPOINT_IDENTITY`; normal Electron 默认仍是 Synthetic V1。**

---

## Feature gates

### Model3 inference

**YES** — 无 permanent `enableModel3=false`。主链每 retained path 进入 `runModel3PathStep`。

CONDITIONAL 仅 test hooks：`model3KeepAll` / `model3DecisionOverride` / `MODEL3_HARNESS_KEEP_ALL` / forceFail。

### Production RETRY（关键隔离）

| Question | Answer |
| -------- | ------ |
| Separate enablement flag? | **未找到** |
| Owner | `completeModel3PathFromUpstream` → 无条件 `routeModel3Retry` |
| Default | Retry 机械始终运行；仅当决策为 `RETRY` 时产生 region/mutation |
| `PRODUCTION_RETRY_ENABLED` | **YES**（代码） |
| Architecture contract L77 “RETRY remains OFF” | **过时文案** → `DOCUMENTATION_RUNTIME_STATUS_AMBIGUITY` |
| S3 promotion 会自动打开 RETRY？ | **NO** — 已打开；promotion 不改变 enablement |

**非** `CHECKPOINT_PROMOTION_COUPLED_TO_RETRY_ENABLEMENT`。

### Shadow / decision / apply

| State | Value |
| ----- | ----- |
| `MODEL3_DECISION_ACTIVE` | YES（infer → KEEP/RETRY） |
| `MODEL3_RETRY_APPLY_ACTIVE` | YES（`routeModel3Retry` 应用 RETRY） |

不存在 “infer + suppress Retry” 的 production 模式。Acceptance causal fork 的 KEEP baseline 是 **harness-only**，不是 production shadow。

---

## S3 compatibility

| Check | Result |
| ----- | ------ |
| Architecture | same `Model3BiGRUV1` |
| Features | identical 6-name allowlist |
| Output | KEEP/RETRY |
| Config mode | S3 uses `config_file_sha256`（registry） |
| Evidence | dialog_200 S3 harness 已成功 load/infer |

→ `S3_RUNTIME_COMPATIBILITY_PASS`

---

## Synthetic → S3 single-variable delta

### Changes（若仅改 runtime default）

- 无 env 时 selected identity / weights / KEEP·RETRY 分布  
- load log `label` / diagnostics `checkpointIdentity.modelId`

### Must NOT change

Model3 I/O 合同、Retry 语义、Retry enablement、FineSpan、Recall、Lexicon、Domain、Assembly、KenLM、ASR、cap≤16。

→ **非** `PROMOTION_NOT_SINGLE_VARIABLE`。

---

## Synthetic dependency

| Kind | Finding |
| ---- | ------- |
| Semantic `if (modelId===SYNTHETIC)` branch | path override only（`MODEL3_SYNTHETIC_V1_CHECKPOINT`） |
| Default / seal | `MODEL3_PRODUCTION_IDENTITY_ID`, deprecated `MODEL3_LABEL`, `MODEL3_EXPECTED_*`（**未被 load 路径 import**）, Python host `DEFAULT_*` |

→ `SYNTHETIC_IDENTITY_DEPENDENCY_FOUND`（wiring/seal），**非** hidden consumer 语义分叉。  
→ 实质：`NO_RUNTIME_SEMANTIC_DEPENDENCY` for business logic。

---

## Fallback

Load 失败：`loadFailed=true`，**无**静默回退 Synthetic。

→ `FAIL_CLOSED`  
→ **非** `SILENT_MODEL_IDENTITY_FALLBACK`

Python host 仅在 **load 消息省略 expected hash** 时默认 Synthetic hashes；TS client **总是**传 registry expected → Electron 路径不会静默用错 hash。

---

## Identity guard matrix

| Field | Runtime verified | Acceptance / freeze only |
| ----- | ---------------- | ------------------------ |
| modelId | YES（registry resolve + load label） | — |
| weights SHA | YES | — |
| config SHA | YES（mode from registry） | — |
| datasetId | NO | YES（manifest / freeze） |
| datasetBuildId | NO | YES |

`RUNTIME_IDENTITY_GUARD_COMPLETE = NO`（dataset 字段 + 陈旧 production seal 常量与 default 不一致）。

---

## Promotion type

**TYPE_B — DEFAULT_PROMOTION_WITH_IDENTITY_GUARD_WORK**

理由：

1. 默认切换本身是单变量（registry default + role）。  
2. 必须在同一 promotion boundary 内对齐 **production seal 常量 / Python DEFAULT_***（否则双 SSOT）。  
3. **不要**在本 delta 新增 datasetId runtime 校验（第二变量；留给用户决定）。  
4. **不要**改 Retry enablement。

非 TYPE_C（无 Retry coupling）。非 TYPE_D（compat PASS）。非 TYPE_E（仍非 default）。

---

## Minimal next phase（不执行）

`MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA`

Target list：`model3_v2_runtime_promotion_target_list.csv`

### DO NOT TOUCH

Model3 training、Retry 语义/geometry、FineSpan、Recall、Lexicon、Domain、SameDomain、Assembly、KenLM、ASR、candidate cap、**production Retry enablement**。

### Promotion acceptance plan（预定义，不执行）

```text
normal Electron no-env
→ selected = MODEL3_V2_S3_RANDOM_INIT_V1
→ weights SHA = f1e419…bbb1
→ config SHA = 8c181c…f221
→ PRODUCTION_RETRY_ENABLED unchanged (still YES in code)
→ targeted tests + build:main + drift gate
```

---

## User decisions（仅真实决策）

1. **是否**将 frozen S3 正式设为 Electron **runtime default**？  
2. Failover 保持现有 **FAIL_CLOSED**（不静默回 Synthetic）？——代码已如此；确认即可。  
3. Synthetic 是否保留为 env 可加载的 rollback identity？  
4. （可选、独立）是否另开文档修复：Architecture Contract “Production RETRY remains OFF” vs 代码 YES？——**不属于 checkpoint promotion**。  
5. （可选、独立）是否以后补 datasetId/buildId runtime 校验？——**第二变量，本 delta 不做**。

---

## Documentation ambiguity

| Doc | Issue |
| --- | ----- |
| Freeze report / manifest | 已区分 AUTHORITATIVE_V2 vs electronDefaultWithoutEnv — OK |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` L77 | 写 RETRY OFF；代码 YES → **`DOCUMENTATION_RUNTIME_STATUS_AMBIGUITY`** |
| Freeze “AUTHORITATIVE_MODEL” 措辞 | 易被误读为 runtime default；manifest wiringNote 已澄清，但标题仍可能歧义 |

本轮**不修改** frozen docs。

---

## Architecture drift for promotion itself

Promotion **不需要**改变 KEEP/RETRY 合同、Retry 语义、invocation≤1、cap≤16、ASR rerun=0。

→ `ARCHITECTURE_CHANGE_REQUIRED = NO`

---

## Recommended next phase（唯一）

`MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA`

（TYPE_B：默认切换 + seal 对齐；Retry enablement **禁止**同批。）
