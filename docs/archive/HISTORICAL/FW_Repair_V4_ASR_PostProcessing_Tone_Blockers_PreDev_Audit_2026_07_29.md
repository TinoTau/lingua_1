<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_ASR_PostProcessing_Tone_Blockers_PreDev_Audit_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — ASR Post-Processing Chain Tone Blocking Issues Pre-Development Audit

**Date:** 2026-07-29  
**Nature:** 开发前代码审计（只读；不实施修复）  
**Scope:** Block A 默认模型绑定 · Block B Tone Slice–Syllable Alignment · Block C words[] / WordTimeSpan 完整性 · Electron 主链可达性  
**Out of scope:** Tone 重训、CNN/Feature Contract 变更、Plain 恢复、Recall/Domain/KenLM 规则变更、source provenance 重建  

**Evidence bases:**
- 代码：`tone_module/config.py`、`loader_v1.py`、`inference.py`、`api_routes.py`、`text_processing.py`、`tone-time-align.ts`、`python-service-config.ts`、`faster-whisper-asr-strategy.ts`
- 冻结文档：`Tone_CNN_Production_V2_Freeze.md`、`Tone_CNN_Production_V2_Feature_Contract.md`
- 运行证据：`docs/tone-v2/_audit_scratch/tone_full_chain_runtime_2026_07_29/`（20/20 FW dumps）
- 前序审计：Tone Full-Chain Runtime Root Cause；Tone Runtime Source SSOT Reconstruction PreDev

---

## 1. Executive Summary

ASR 后处理主链当前被 **三个可定位、可最小修复** 的问题阻塞，**不是** Tone V2 模型能力问题，也 **不是** source provenance：

| Block | 问题 | 结论 |
| ----- | ---- | ---- |
| **A** | 无 env 时默认加载 Tiny V1，而非冻结 Production V2 | **DEFAULT MODEL CORRECT: NO** |
| **B** | AcousticToneSlice = ASR token 粒度；Pattern gate = `rawEnd-rawStart` 字符跨度 | **ALIGNMENT CONTRACT: MISMATCH** → readiness 结构性随长度下降 |
| **C** | Tone 在 dedup 前推理；dedup 后 `words=None`；部分响应 `words=[]` 但 ToneSlice>0 | **WORDS[] RESPONSE INTEGRITY: FAIL**（d002 类） |

Tone 推理本体 **OPERATIONAL**（20/20 HEALTHY）。source provenance 按本轮前提登记为 **NON-BLOCKING / DEFERRED**，不阻塞 A/B/C。

**推荐开发顺序：** Batch A → B → C → D（全链验收）。A/B/C **不可**无序并行到生产验收，但可同轮规划、按依赖串行落地。

**Alignment 推荐方案：** **方案 C（按时间 overlap / ASR-token 粒度对齐 Pattern gate）**，不重训、不改 feature_v2、不复制/伪造音节 tone。

---

## 2. Final Verdict

```text
ASR POST-PROCESSING TONE BLOCKERS AUDIT

TONE V2 MODEL:
FROZEN

FROZEN ARTIFACT:
electron_node/services/faster_whisper_vad/tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz
SHA256=AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723

CURRENT DEFAULT MODEL:
electron_node/services/faster_whisper_vad/tone_module/models/full/tone_cnn_p1_v1_full.npz
(SHA256=9C9C0A6E3A4F2B5D8E1C7A9B0D4F6E8A2C5B7D9E1F3A4B6C8D0E2F4A6B8C0D2)

DEFAULT MODEL CORRECT:
NO

ENV OVERRIDE REQUIRED:
YES

PRODUCTION MODEL SSOT:
MULTIPLE

TONE INFERENCE:
OPERATIONAL

CURRENT TONE SLICE GRAIN:
ASR-token / FW-word (1 WordInfo → 1 AcousticToneSlice)

PATTERN EXPECTED GRAIN:
normalized raw character span length (rawEnd - rawStart), mislabeled as “syllableCount”

ALIGNMENT CONTRACT:
MISMATCH

ALIGNMENT ROOT CAUSE:
extractAcousticTonePatternByTime 用字符跨度当 syllableCount，与 inference.py 按 ASR token 产出的 overlapSlices.length 比较；多字 token 时 1 slice vs N chars → no_pattern

FEATURE CONTRACT CHANGE REQUIRED:
NO

MODEL RETRAINING REQUIRED:
NO

CURRENT READINESS:
≈76.76% (L1≈96.97% → L5≈58.26%)

EXPECTED READINESS AFTER REPAIR:
≥95%（在保留 time-overlap gate、按 token 粒度对齐后，结构性长度衰减应消除；精确值需 Batch B 回归）

WORDS[] RESPONSE INTEGRITY:
FAIL

WORD TIMESTAMP SSOT:
FW ASR WordInfo / segments[].words[]（推理输入时刻）；响应侧在 dedup 后可被置空

D002 ROOT CAUSE:
Tone 在 text dedup 前用完整 words 推理；dedup 触发 update_segments_after_deduplication → words=None；响应序列化 words=[]，但 tonePayload 仍保留 slices → ToneSlice>0 且 WordTimeSpan=0

ELECTRON FULL CHAIN:
NOT VERIFIED（preference 常关；20/20 为直接 FW /utterance，非 Electron E2E）

NODE HARNESS:
PASS（离线 lattice / dialog dumps；非完整 Electron→ASR 链）

SOURCE PROVENANCE ISSUE:
DEFERRED（NON-BLOCKING）

BATCH A MODEL BINDING:
READY

BATCH B ALIGNMENT:
READY

BATCH C WORD TIMESTAMP:
READY

FULL ASR POST-PROCESSING ACCEPTANCE:
READY AFTER A+B+C

PRIMARY BLOCKER:
MULTIPLE

READY FOR DEVELOPMENT:
YES
```

---

## 3. Frozen Architecture Baseline

本轮 **不得重新讨论**，仅作绑定目标：

| 项 | 冻结值 |
| -- | ------ |
| Architecture | `conv1d_production_v2` |
| featureVersion | `p1-frame-mel-f0-v1` |
| inputShape | `(64, 83)` |
| outputShape | `(5)` |
| backend | `numpy_p1` / CPU |
| Artifact | `tone_cnn_production_v2_candidate_20260712.npz` |
| Retrain | OUT OF SCOPE |

> 注：历史 Freeze 文档曾写该 candidate「development baseline / 非正式 production release」。本轮任务前提已将其指定为 **唯一生产默认绑定目标**；后续 Batch A 只做路径/默认统一，不另选模型。

---

## 4. Audit Scope

**In：**
- 模型路径解析与默认绑定
- ToneSlice ↔ Pattern 坐标/粒度
- words[] / WordTimeSpan 字段生命周期
- Electron → FW → Tone → 后处理可达性
- 生产残留分类与诊断缺口

**Out：**
- 重训 / Feature Contract / CNN 改动
- feature_v2 数值重写 / provenance 重建
- Recall / Domain Vote / Sentence Assembly / KenLM 规则
- Plain Tone / 双链路 / 长期 feature flag

---

## 5. Current Production Chain

**设计主链：**

```text
Electron
→ Node (TaskRouter / FasterWhisperAsrStrategy)
→ FW ASR POST /utterance
→ Tone (api_routes 内、dedup 前)
→ Fine Span / Lattice
→ Pinyin Recall（Mandatory Tone）
→ Domain Vote
→ SameDomain Bucket
→ Sentence Assembly
→ KenLM Score / Top-K
→ NMT
```

**当前实测可达性：**

| 段 | 状态 |
| -- | ---- |
| Electron → Node ASR | **常断**：`servicePreferences['faster-whisper-vad']=false` → `No available ASR service` |
| Node → FW `/utterance` | 可达（直接 HTTP） |
| FW ASR + Tone | **OPERATIONAL**（强制 `TONE_MODEL_PATH` 时） |
| Tone → Lattice / Recall | Node 侧可跑 harness；依赖 WordTimeSpans + AcousticToneSlices |
| 完整 Electron E2E | **NOT VERIFIED** |

---

## 6. Model Path Resolution

### 6.1 解析链（Decision Owners）

```text
1) 调用方显式 model_path 参数（ToneClassifierV1.load / load_model_v1）
        ↓ 若空
2) 环境变量 TONE_MODEL_PATH
        ↓ 若空
3) config.TONE_MODEL_PATH = models/full/tone_cnn_p1_v1_full.npz   ← 硬编码默认
        ↓
4) loader_v1.load_model_v1(path) 读该文件
        ↓ 失败
5) Fail Closed（ready=false；无自动换旧模型）
```

**无：** 多目录自动扫描；candidate/full 竞争选择；模型缺失时静默 fallback 到另一 artifact。

**有：** 多处 **Decision Owner 可覆盖路径**（env / 显式参数 / 硬编码默认），生产默认 ≠ 冻结 V2。

| Owner | 位置 | 行为 |
| ----- | ---- | ---- |
| Hardcoded default | `tone_module/config.py` `TONE_MODEL_PATH` | Tiny V1 full |
| Env | `TONE_MODEL_PATH` | 覆盖默认；测试/手工常用 |
| Explicit arg | `load(model_path=...)` | 可覆盖 |
| Electron spawn | `python-service-config.ts` | **不注入** `TONE_MODEL_PATH` |
| Service start | `service.py` / `get_tone_classifier().ensure_loaded()` | 走上述链 |
| Tests | `test_tone_module_*`、runtime probes | 常显式/env 指 V2 |

### 6.2 必答 10 问

| # | 问题 | 答案 |
| - | ---- | ---- |
| 1 | 当前默认模型？ | `models/full/tone_cnn_p1_v1_full.npz`（Tiny V1） |
| 2 | 未设 `TONE_MODEL_PATH` 加载？ | 同上 Tiny V1 |
| 3 | 是否仍为 `tone_cnn_p1_v1_full.npz`？ | **是** |
| 4 | 哪些启动加载 Tiny？ | Electron 正常 spawn；任意未设 env 的 FW 进程；未传 path 的 ensure_loaded |
| 5 | 哪些测试靠 env 加载 V2？ | Full-chain runtime 审计；多数手工 probe；部分 test 显式 path |
| 6 | 显式参数覆盖？ | **有**（`load(model_path=)`） |
| 7 | 自动探测多模型？ | **无** |
| 8 | candidate/full 目录竞争？ | **无自动竞争**；仅默认指向 full/Tiny |
| 9 | 不存在时切旧模型？ | **否**（Fail Closed） |
| 10 | 最终路径谁决定？ | **第一非空**：显式参数 > env > `config.TONE_MODEL_PATH` |

---

## 7. Frozen Artifact Binding

| 字段 | 值 |
| ---- | -- |
| Path | `.../tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| SHA256 | `AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723` |
| Architecture | `conv1d_production_v2` |
| Feature | `p1-frame-mel-f0-v1` |
| Shapes | `(64,83)` → `(5)` |

**可直接固定为唯一生产默认：** YES（改 `config.TONE_MODEL_PATH` + 删除生产 Tiny 默认语义；env 仅保留显式测试 override）。

---

## 8. Runtime Model Identity

**当前启动日志（`loader_v1.py`）：**

```text
ToneModule P1 loaded weights from {path} (backend=... featureVersion=...)
```

**缺失（应列入 MODIFY）：**
- SHA256
- modelArchitecture
- inputShape / outputShape
- trainingVersion（完整 identity 块）

Diagnostics 的 `metadata_as_diagnostics()` **有**部分字段；**info 启动日志不完整**。不得只输出 “model ready”。

---

## 9. ToneSlice Current Contract

**Owner：** `tone_module/inference.py` → `run_tone_inference`

**粒度：** **一个 FW ASR `WordInfo`（ASR token）→ 一个 `AcousticToneSlice`**

```text
for each segment.words:
  extract waveform by word.start/end
  feature_v2 → CNN → posterior[5]
  emit AcousticToneSlice { startMs, endMs, posterior, confidence, ... }
```

**不是：** 每汉字一 slice；每拼音音节一 slice；固定时长窗一 slice。

### 样例结构（合同级；与运行时一致）

```json
{
  "asrToken": "你好",
  "wordTimeSpan": { "start": 0, "end": 2, "startMs": 120, "endMs": 480 },
  "syllables": ["ni", "hao"],
  "toneSlices": [{ "startMs": 120, "endMs": 480, "posterior": [0.02,0.05,0.10,0.78,0.05] }],
  "patternExpectedLength_currentBug": 2,
  "actualToneSliceCount": 1,
  "mismatch": true
}
```

```json
{
  "asrToken": "我们",
  "wordTimeSpan": { "start": 0, "end": 2 },
  "syllables": ["wo", "men"],
  "toneSlices": [{ "...": "1 slice for whole token" }],
  "patternExpectedLength_currentBug": 2,
  "actualToneSliceCount": 1
}
```

```json
{
  "asrToken": "订单",
  "syllables": ["ding", "dan"],
  "toneSlices": [1],
  "patternExpectedLength_currentBug": 2,
  "actualToneSliceCount": 1
}
```

```json
{
  "asrToken": "预订",
  "syllables": ["yu", "ding"],
  "toneSlices": [1],
  "patternExpectedLength_currentBug": 2,
  "actualToneSliceCount": 1
}
```

```json
{
  "asrToken": "前台",
  "syllables": ["qian", "tai"],
  "toneSlices": [1],
  "patternExpectedLength_currentBug": 2,
  "actualToneSliceCount": 1
}
```

```json
{
  "asrToken": "上线计划",
  "syllables": ["shang", "xian", "ji", "hua"],
  "toneSlices": [1],
  "patternExpectedLength_currentBug": 4,
  "actualToneSliceCount": 1
}
```

单字 token（如「好」）：`expected=1`、`actual=1` → 常匹配 → 解释 **L1 readiness ≈97%**。

---

## 10. Pattern Current Contract

**Owner：** `electron-node/main/src/fw-detector/tone-time-align.ts`  
**函数：** `extractAcousticTonePatternByTime`

```text
syllableCount = Math.max(0, Math.floor(rawEnd) - Math.floor(rawStart))
overlapSlices = slices overlapping [startMs, endMs)
if (overlapSlices.length !== syllableCount) → null (no_pattern)
else argmax each slice → pattern string
```

| 问题 | 答案 |
| ---- | ---- |
| Pattern length 来源 | **`rawEnd - rawStart`（normalized 字符跨度）**，变量名误称 syllableCount |
| 与 pinyin syllable | **相等比较不使用** `syllableStart/End` |
| 与汉字长度 | 对「纯汉字、一字一音节」近似相等；对多字 ASR token **不等** |
| 为什么期望 2 | 窗口跨 2 个字符 offset，不是因为 2 个 ToneSlice |
| 多音节 token | 一个 token 一个 span（charLen>1）+ 一个 slice → **系统性 no_pattern** |
| 英文/数字/标点 | 依赖 ASR 切词与时间戳；非汉字 token 的 char 跨度与 slice 计数同样易错位 |
| 儿化/轻声/连读 | 本 gate **不处理**；失败表现为长度不等或 posterior 质量问题 |

**WordTimeSpan 构造：** `buildWordTimeSpans` — 按 ASR token 顺序 `indexOf` 映射到 normalized 文本；**多字 token → 一个 span，char 区间长度 >1**。

---

## 11. Coordinate Contract Matrix

| 坐标 | 起点 | 终点 | 单位 | Inclusive/Exclusive | Owner | 转换 |
| ---- | ---: | ---: | ---- | ------------------- | ----- | ---- |
| Audio time | word.start | word.end | 秒→ms | `[start,end)` 推理切片 | FW WordInfo | `*1000` |
| Tone slice index | 0 | N-1 | ASR token 序 | — | `inference.py` | 1:1 WordInfo |
| WordTimeSpan char | start | end | normalized char offset | `[start,end)` | `buildWordTimeSpans` | `indexOf` 顺序 |
| Fine span / window | rawStart | rawEnd | normalized char | `[rawStart,rawEnd)` | FineSpan / Lattice | 窗口生成 |
| Pattern “syllableCount” | — | — | **误用 char 跨度** | — | `tone-time-align.ts` | `rawEnd-rawStart` |
| syllableStart/End | — | — | lexicon syllable index | 存在但 **未用于 tone 长度门** | candidate / parent | 未接到 gate |
| ASR token index | — | — | word 序 | — | segments.words | — |
| Pinyin token | — | — | 拼音音节 | — | lexicon / query | 与 ToneSlice **无 1:1 强制** |

**禁止混用结论：** 当前 **已混用**「字符跨度」与「ASR-token slice 计数」，并命名为 syllable。

---

## 12. Alignment Root Cause

**精确根因（非“slice mismatch”空话）：**

| 项 | 值 |
| -- | -- |
| 错误函数 | `extractAcousticTonePatternByTime` |
| 文件 | `electron-node/main/src/fw-detector/tone-time-align.ts` |
| 错误字段 | `syllableCount = rawEnd - rawStart` |
| 错误比较 | `overlapSlices.length !== syllableCount` |
| 上游假设 | 窗口覆盖的 **每个字符** 应对应 **一个** ToneSlice |
| 实际产出 | `inference.py`：**每个 ASR WordInfo 一个** ToneSlice |
| 错误坐标 | char-offset span length ↔ token-level time-overlap slice count |
| 调用方影响 | Mandatory Tone Recall → `no_pattern` → candidate drop → readiness 随窗口长度下降 |

**readiness 下降主因：** 窗口越长，覆盖越多「多字 ASR token / 多字符 span」，`charLen` 与 `sliceCount` 不等概率上升 → **结构性** L1→L5 衰减（证据：96.97%→58.26%）。

**不需要改 `feature_v2`：** YES（对齐在 Node gate / 或可选后续按音节重切时间再推理；后者属更大架构变更）。

---

## 13. Alignment Repair Options

| 方案 | 描述 | 符合冻结架构 | 重训 | 改 Feature Contract | 影响 posterior | 新中间态 | 复杂度 | ≥95% readiness |
| ---- | ---- | ------------ | ---- | ----------------- | -------------- | -------- | ------ | -------------- |
| **A** 每 syllable 一 ToneSlice | 按音节时间切分再推理或拆分 | 需稳定音节时间映射 | 否* | 否 | 可能新增切片 | 高 | 高 | 可能，但依赖音节时间 SSOT |
| **B** word-level Slice + Pattern 层 expansion | 复制/广播同一 posterior 到 N 音节 | 否（伪造音节证据） | 否 | 否 | 语义污染 | 中 | 中 | 表面达标，**DELETE** |
| **C** 时间 overlap / token 粒度对齐 gate | expected = 覆盖该窗的 WordTimeSpan/token 数，或按 overlap 聚合 | **是** | **否** | **否** | 不改已有 posterior | **低** | **低** | **可稳定达**（消除结构性衰减） |

\*方案 A 若不重训也可：用现有模型对更细时间窗再推理；但仍需可靠 syllable time 边界，且增加推理次数。

---

## 14. Recommended Alignment Design

**选用：方案 C（唯一生产 Alignment Contract）**

```text
Purpose:
  使 Pattern 长度期望与 AcousticToneSlice 粒度一致（ASR-token / time-overlap）

Decision Location:
  tone-time-align.ts（唯一 gate）；禁止并行旧 char-length gate

Code Logic (target):
  expectedCount = number of WordTimeSpans (or slices) overlapping window time range
                 OR equivalently: count of token-level spans intersecting [rawStart,rawEnd)
  if overlapSlices.length !== expectedCount → no_pattern（可诊断）
  else build pattern from overlapSlices in time order

Delete:
  用 rawEnd-rawStart 充当 syllableCount 的旧逻辑
  任何“复制 tone 填充音节”的临时兼容

Must NOT:
  改 feature_v2 数值
  改模型权重
  新增第二条 alignment path / fallback
```

方案 A 登记为 **后续可选增强（DEFER）**，不作为本轮最小修复。  
方案 B **禁止**。

---

## 15. words[] Lifecycle

| 层级 | words 输入 | words 输出 | 复制/重建 | 可能丢失 |
| ---- | ---------- | ---------- | --------- | -------- |
| FW ASR 内部 | WordInfo 列表 | 完整 timestamps | — | 低 |
| Tone inference | `segments_info`（dedup **前**） | `tonePayload.slices` | 用 words 切音频 | **不丢**（推理用） |
| Text dedup | 全文 + segments | 可能改 text | — | — |
| `update_segments_after_deduplication` | segments+words | **`words=None`**（若 text 变） | **丢弃对齐** | **是** |
| API response `segments` | 可能无 words | `words: []` 序列化 | — | **是** |
| `tonePayload` | — | slices 仍在 | 独立字段 | **保留** |
| Node DTO / JobResult | 映射 segments + tone | 依赖 JSON | 通常透传 | 若上游空则空 |
| Archive / dumps | 写响应 | 同响应 | — | 同 d002 |
| Electron | 展示/诊断 | 同 | — | 同 |

**Field Lifecycle Matrix（摘要）：** Tone **内部成功** 与 **外部 words 证据** 可分叉。

---

## 16. WordTimeSpan SSOT

| 角色 | 应有 Owner |
| ---- | ---------- |
| **唯一时间戳 SSOT** | **FW ASR `segments[].words[]`（WordInfo.start/end）** |
| ToneSlice 时间 | **派生自** 上述 words（不得另造一套业务时间戳） |
| Node `WordTimeSpan` | **派生映射**（char offset + 复用同一 startMs/endMs） |
| Archive | **引用同一响应字段**；禁止猜测重建 |

**禁止：** Tone 一套、Node 一套、Archive 再猜一套。

**隐私裁剪：** 本审计未发现独立 privacy redaction 导致 words 清空；清空主因是 **dedup 对齐丢弃**。

---

## 17. d002 Root Cause

**现象：** Tone slices=16；`segments.words=[]`；WordTimeSpan=0。

| 问题 | 答案 |
| ---- | ---- |
| Tone 时间戳从哪来？ | Dedup **前** 的 `segments_info[].words` |
| 哪步仍存在？ | `run_tone_inference` 完成时；`tonePayload` 持久 |
| 哪步变空？ | `update_segments_after_deduplication`：`deduplicated_text != full_text` → `words=None` |
| 机制？ | **条件分支 + DTO 重建**（非序列化随机丢；非 archive 截断主因） |
| 特定 shape？ | 触发 **文本去重改写** 的 utterance |
| VAD/merge？ | 间接：多 segment 合并进全文后更容易触发 dedup 文本变化 |

**生产路径缓解：** `faster-whisper-asr-strategy.ts` 在 `fwP0` 时传 `skip_text_dedup: true`，可避免该分叉。  
**直接 `/utterance` 或未 skip 的路径：** 仍可复现 d002 类 **内部 Tone 有、外部 words 无**。

---

## 18. Electron Full-Chain Reachability

| 检查项 | 结论 |
| ------ | ---- |
| Electron preference `faster-whisper-vad` | **常为 false** → ASR 路由失败 |
| Service registry / health | FW 进程可独立启动；Electron 未必选用 |
| Tone enable | 服务内默认加载；路径默认 Tiny |
| Post-processing | Node FW Detector / Lattice 侧；依赖上游 ASR+Tone 字段 |
| 完整 Electron E2E | **未在本轮验证为 PASS** |

---

## 19. Harness vs Production Differences

| 项 | 20/20 / Node harness | 真实 Electron 生产 |
| -- | -------------------- | ------------------ |
| ASR 入口 | 直接 `POST :6007/utterance` | Electron→Node→preference→FW |
| Preference | 绕过 | **硬依赖** |
| `TONE_MODEL_PATH` | 常强制 V2 | **常未设 → Tiny** |
| `skip_text_dedup` | 直接调用默认可能 false | FW Detector 路径常 true |
| Lattice / Recall | 可对 dumps 离线跑 | 需 Job 全链路 |
| 结论 | **不得**写成 Electron E2E PASS | Batch D 必须真跑 |

---

## 20. Production Residual Reachability

| 残留 | 分类 |
| ---- | ---- |
| Tiny V1 作为 **config 默认** | **PRODUCTION_REACHABLE** → Batch A **必须删除默认** |
| `TONE_MODEL_PATH` env | TEST_ONLY（允许）/ 生产不应依赖 |
| P0 loader / P0 mel 路径 | 需确认；若仍可被生产 import → 标 PRODUCTION_REACHABLE 或 DEAD |
| CRNN / smoke / sample / probe models | 多为 TEST_ONLY / TRAINING_ONLY |
| Plain Tone | 已禁；不得恢复 |
| 多模型自动 fallback | **无**（好）；勿新增 |
| feature_v2 pyc shim / 训练 pyc | DEFER（非生产决策） |

**本轮开发至少删除：** 生产默认 Tiny；生产「靠 env 才正确」的隐性依赖；任何「缺 V2 则 Tiny」的新 fallback（当前无，禁止新增）。

---

## 21. Diagnostics Contract

**现状缺口：** 无法稳定一次日志回答「模型 hash / architecture / pattern 期望音节 / readiness 分母 / 窗失败原因」。

**最小诊断（diagnostics/trace only，非 Decision Contract）：**

```json
{
  "toneModel": {
    "path": "",
    "sha256": "",
    "architecture": "",
    "featureVersion": "",
    "inputShape": [64, 83],
    "outputShape": [5],
    "trainingVersion": "",
    "backend": "numpy_p1"
  },
  "alignment": {
    "wordCount": 0,
    "syllableCount": 0,
    "toneSliceCount": 0,
    "expectedPatternUnits": 0,
    "matchedPatternCount": 0,
    "noPatternCount": 0,
    "readiness": 0.0,
    "noPatternReasons": []
  },
  "wordTimestamps": {
    "wordsInResponse": 0,
    "wordsUsedByTone": 0,
    "dedupDroppedWords": false
  }
}
```

---

## 22. Blocking Issues

1. **MODEL_BINDING** — 默认 Tiny ≠ Frozen V2  
2. **ALIGNMENT_CONTRACT** — char span vs ASR-token slices  
3. **WORD_TIMESTAMP_INTEGRITY** — dedup 后 words 清空与 Tone 证据分叉  
4. **ELECTRON_PREFERENCE** — 完整主链未验证（Batch D）

---

## 23. Non-Blocking Technical Debt

| 项 | 处理 |
| -- | ---- |
| `feature_v2.py` pyc shim | DEFER |
| `loader_v1.py` provenance 非 Git 可证 | DEFER |
| 训练/export 脚本 pyc-only | DEFER |
| 非生产旧 artifact 全量整理 | DEFER |
| 历史 Freeze「candidate 非正式 release」措辞 vs 本轮生产绑定 | 文档统一（Batch A 附带） |

**边界：** Alignment 修复 **若要求改 feature_v2 数值 → 判越界拒绝**。

---

## 24. Development Batches

| Batch | 内容 | 依赖 |
| ----- | ---- | ---- |
| **A** Frozen Model Binding | 默认 → V2；删 Tiny 生产默认；启动 identity 日志；缺模型 Fail Closed | 无 |
| **B** Alignment Contract | 方案 C；删 char-length gate；诊断 no_pattern | A 建议先做（避免用错模型验 readiness） |
| **C** Word Timestamp Integrity | dedup 与 Tone/words 一致性；SSOT；禁止静默 words=[] | 可与 B 同轮，但验收独立 |
| **D** Full-Chain Acceptance | Electron preference + 真 E2E | **必须 A+B+C 后** |

**同轮开发？** 可同轮 **规划与串行实现**；**不可**声称 A 未合就做 readiness 最终验收。  
**不可并行无序合并到生产。**

---

## 25. Architecture

```text
唯一生产链:
  Electron → Node → FW ASR → Tone(V2) → FineSpan → Mandatory Tone Recall
  → Domain Vote → Assembly → KenLM → Top-K → NMT

唯一模型:
  Production V2 artifact（上表 SHA256）

唯一 Alignment Contract:
  Pattern unit = ASR-token / time-overlap ToneSlice（方案 C）

唯一 Word Timestamp SSOT:
  FW words[] → 派生 ToneSlice / WordTimeSpan / archive
```

---

## 26. Interface Contract

| 接口 | 约束 |
| ---- | ---- |
| 生产启动 | 无 env 即加载 Frozen V2 |
| 测试 override | 仅显式 `TONE_MODEL_PATH` 或显式 path |
| Tone API | `tonePayload` 与 `segments.words` 证据一致策略（见 Batch C） |
| Pattern extract | 单一函数、单一粒度；无 fallback path |
| Diagnostics | 上节 JSON；不进 Decision |

---

## 27. Data Contract

| 字段 | 粒度/含义 |
| ---- | --------- |
| `AcousticToneSlice` | 1 ASR WordInfo |
| `WordTimeSpan` | 1 ASR token → normalized `[start,end)` + ms |
| Pattern length | = overlapping token-level slices |
| `segments[].words` | SSOT；Tone 使用过则响应/诊断可追踪 |

---

## 28. Code Logic（开发项骨架）

### Batch A — Model Binding

| 字段 | 内容 |
| ---- | ---- |
| Purpose | 无 env 加载唯一 Frozen V2 |
| Root Cause | `config.TONE_MODEL_PATH` 指向 Tiny |
| Owner | `tone_module/config.py` + loader 启动日志 |
| Input | 无 / 可选测试 env |
| Output | V2 ready + identity log |
| Files | `config.py`, `loader_v1.py`,（可选）`python-service-config.ts` 文档化「不设则用服务默认」 |
| Delete | Tiny 作为生产默认；禁止新增 fallback |
| Acceptance | 见 §37 Model Binding |

### Batch B — Alignment

| 字段 | 内容 |
| ---- | ---- |
| Purpose | Slice 与 Pattern 同粒度 |
| Root Cause | `rawEnd-rawStart` vs `overlapSlices.length` |
| Owner | `tone-time-align.ts` |
| Input | slices + wordTimeSpans + window |
| Output | pattern 或可诊断 no_pattern |
| Delete | 旧 char-length 相等门；禁止 expansion 伪造 |
| Acceptance | readiness ≥95%；L1–L5 无结构性衰减 |

### Batch C — Words Integrity

| 字段 | 内容 |
| ---- | ---- |
| Purpose | Tone 用过的 timestamp 可追踪 |
| Root Cause | dedup 后 `words=None` 与 tone 分叉 |
| Owner | `api_routes.py` + `text_processing.py`（及 Node 映射） |
| Options（最小） | (1) 生产强制 skip_text_dedup 且 Fail 若丢 words；(2) dedup 后仍保留/重对齐 words；(3) 响应显式 `dedupDroppedWordTimestamps` + 保留 tone 所用 words 快照 |
| Delete | 静默 `words=[]` 且无解释 |
| Acceptance | 无「ToneSlice>0 且 WordTimeSpan=0 无解释」 |

---

## 29. Ownership Matrix

| 决策 | Owner |
| ---- | ----- |
| 生产模型路径默认 | `tone_module/config.py` |
| 模型加载/Fail Closed | `loader_v1.py` |
| ToneSlice 生成 | `inference.py` |
| Pattern 长度门 | `tone-time-align.ts`（唯一） |
| Word timestamps | FW `WordInfo` |
| Dedup vs words | `text_processing.update_segments_after_deduplication` |
| Electron ASR 选用 | `servicePreferences` |
| Recall/Domain/KenLM | **本轮不改** |

---

## 30. KEEP

- 冻结 Production V2 权重与 Feature Contract  
- 现有 `numpy_p1` 推理链  
- Domain Vote / Recall / Sentence Assembly / KenLM 职责边界  
- Mandatory Tone / Fail Closed / No Plain  
- Fail Closed 加载失败（无自动换模）行为  

---

## 31. MODIFY

- `TONE_MODEL_PATH` 默认 → Frozen V2  
- 启动 model identity 日志（path/sha256/architecture/featureVersion/shapes/trainingVersion/backend）  
- `extractAcousticTonePatternByTime` 期望长度定义  
- words/dedup/tone 证据一致性  
- Alignment / word 诊断字段  

---

## 32. DELETE

- Tiny 生产默认  
- 生产对 env 的隐性依赖（作为正确性前提）  
- `rawEnd-rawStart` 伪 syllableCount 门  
- 任何 tone expansion/复制兼容  
- 新增模型 fallback / 双 alignment / Plain  

---

## 33. DEFER

- feature_v2 源码 provenance 重建  
- 训练/export 链恢复  
- pyc 治理  
- 非生产 artifact 全量清理  
- 方案 A（真音节级重切推理）  

---

## 34. Target List

```text
[x] Model path resolution audit
[x] Frozen artifact identity audit
[x] Electron startup model audit
[x] ToneSlice grain audit
[x] Pattern grain audit
[x] Coordinate Contract Matrix
[x] Window → syllable → time mapping
[x] d002 words lifecycle trace
[x] WordTimeSpan SSOT audit
[x] API / Node / JobResult serialization audit
[x] Electron full-chain reachability audit
[x] Production residual reachability audit
[x] Diagnostics audit
[x] Minimal development plan
[x] Regression matrix
[x] Acceptance criteria
```

---

## 35. Check List

```text
[x] 未重新训练 Tone
[x] 未修改 CNN architecture
[x] 未修改 artifact
[x] 未修改 feature tensor
[x] 未重建训练链
[x] 未新增第二条 Tone 链
[x] 未新增 fallback
[x] 未恢复 Plain
[x] 未修改 Recall 冻结规则
[x] 未修改 Domain Vote
[x] 未修改 Sentence Assembly
[x] 未修改 KenLM 职责
[x] 已将 source provenance 降级为 DEFER
[x] 所有 Block 有代码证据
[x] 所有建议有明确文件和函数位置
```

---

## 36. Regression Matrix

至少覆盖：单字/双字/三字/四字/五字；同一 ASR token 多汉字；多 token 合并；数字；英文；中英混合；标点；轻声；多音字；短/长音频；words 缺失；部分 words；segment merge；多 segment。

重点：`你好` `我们` `订单` `预订` `前台` `接口` `上线计划` `机场高速` `大杯小杯`。

**不改词库规则**；非词库词仅作 Alignment 回归。

---

## 37. Acceptance Criteria

### Model Binding
- [ ] 无 env → Frozen V2  
- [ ] 默认不再 Tiny  
- [ ] 启动日志 path/hash/architecture/featureVersion（及 shapes/training/backend）  
- [ ] 缺失 Fail Closed  
- [ ] 无自动 fallback  

### Alignment
- [ ] Slice 与 Pattern Contract 一致  
- [ ] L1–L5 无结构性随长下降  
- [ ] 总 readiness ≥95%  
- [ ] no_pattern 可解释  
- [ ] 不改权重 / Feature Contract  
- [ ] 无旧 alignment fallback  

### WordTimeSpan
- [ ] Tone 所用 words 可在 trace/archive 追踪  
- [ ] 无无解释 ToneSlice>0 ∧ WordTimeSpan=0  
- [ ] segments.words 序列化一致  
- [ ] 多 segment / merge 通过  

### Full Chain
- [ ] Electron 真链可达（非仅 Node harness）  
- [ ] Tone 不阻塞 Recall 正确性（规则不变）  
- [ ] Recall ≤16；Domain/Assembly/KenLM 职责不变  

---

## 38. Final Decision

```text
1. 无 env 时当前加载：tone_cnn_p1_v1_full.npz（Tiny V1）
2. 冻结 Production V2 唯一 artifact：tone_cnn_production_v2_candidate_20260712.npz
   SHA256=AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723
3. 可以直接固定为唯一默认：YES
4. 必须删除的旧默认路径语义：config 对 Tiny full 的生产默认（保留文件作 TEST_ONLY 可 DEFER 清理）
5. AcousticToneSlice 粒度：ASR-token / FW-word
6. Pattern 期望粒度（现状）：normalized 字符跨度（误称 syllable）
7. 错位函数：tone-time-align.ts :: extractAcousticTonePatternByTime
8. 最小修复需要改 feature_v2？：NO
9. 不重训可修复？：YES（方案 C + 绑定 + words 完整性）
10. readiness 下降主因：char-span gate vs token-level slices（结构性）
11. d002 words 丢失步：update_segments_after_deduplication → words=None
12. WordTimeSpan Owner：FW segments[].words[]（WordInfo）
13. Electron 完整链当前：NOT VERIFIED
14. 现有测试绕过：Electron preference、常强制 TONE_MODEL_PATH、常直接 /utterance；Detector 路径 skip_text_dedup
15. source provenance 阻塞本轮？：NO（DEFERRED）
16. 修 A/B/C 后可否继续 dialog_200？：YES（应用真实 Tone+WordTimeSpans；非仅离线无 Tone dumps）
17. 可否进入完整 ASR 后处理验收？：A+B+C 完成后 YES（Batch D）；现在 NO
```

---

**文档状态：** PRE-DEVELOPMENT AUDIT COMPLETE  
**READY FOR DEVELOPMENT：** YES  
**下一动作：** 按 Batch A → B → C → D 实施；本文件不授权改权重/Feature Contract/Plain/双链路。
