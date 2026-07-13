# Dialog200 完整语料恢复报告

**日期**：2026-06-28  
**版本**：`restored_full_v1`  
**裁决**：**CONDITIONAL PASS**（语料 **PASS**；本轮末 FW Runtime 探针因 Worker 503 未复验）

---

## Executive Summary

完整 **200 条** dialog_200 语料已恢复：

- `cases.manifest.json` — `caseCount=200`, `isFullCorpus=true`, `version=restored_full_v1`
- `dialog_d001.wav` … `dialog_d200.wav` — 200 个独立 wav（Piper TTS，16kHz mono，文本一一对应）

生成耗时约 **100s**（200 条 Piper 合成）。**不再是 minimal subset 版**。

本轮末 FW Worker `/health=200` 但 `/utterance` 返回 **503**（ASR 子进程未就绪），故随机 5 条 FW 抽检与 `audit --part all` **未在本环境完成**；生成当时及早前会话中 d001 探针曾 **PASS**。

---

## Source of Text

| 来源 | 路径 | 条数 |
|------|------|------|
| Utterance SSOT | `electron_node/electron-node/tests/experiments/tone-module-p1-dialog-fw-scan.json` | 200 |
| Scenario SSOT | `electron_node/electron-node/tests/raw-log-delta-gate3-dialog200-batch-result.json` | 200 |

每条 case 含：`id` d001–d200、`text` / `expectedText` / `utterance`（同文）、`language=zh`、`scenario`。

---

## Source of Audio

| 项 | 值 |
|----|-----|
| 方式 | Piper TTS HTTP `http://127.0.0.1:5009` |
| Voice | `zh_CN-huayan-medium` |
| 格式 | WAV，16kHz mono（与 `context_prior/gen_context_prior_wavs.py` 同链路） |
| 脚本 | `electron_node/electron-node/scripts/test-corpus/restore-dialog200-full.py` |
| 包装 | `test wav/dialog_200/gen_dialog_200_wavs.py` |

**未**使用单条音频冒充 200 条；**未**生成 fake/equal-split timestamp 或 text-derived tone。

---

## Generated / Restored File List

| 路径 | 数量 | 说明 |
|------|------|------|
| `test wav/dialog_200/cases.manifest.json` | 1 | 完整 manifest |
| `test wav/dialog_200/dialog_dNNN.wav` | **200** | 新生成 |
| `test wav/dialog_200/README.md` | 1 | 已更新为 full v1 |
| `electron_node/.../restore-dialog200-full.py` | 1 | 恢复脚本 |
| `electron_node/.../validate-dialog200-full.py` | 1 | 校验脚本 |

---

## Manifest Summary

```json
{
  "corpus": "dialog_200",
  "version": "restored_full_v1",
  "caseCount": 200,
  "isFullCorpus": true
}
```

- `cases[]` 长度：**200**
- 每条 `file` / `audio`：`dialog_d001.wav` … `dialog_d200.wav`
- 无 word timestamp / tone label / refTones

---

## Full Corpus Validation

| 检查 | 结果 |
|------|------|
| `cases.manifest.json` 存在 | ✅ |
| `caseCount = 200` | ✅ |
| `isFullCorpus = true` | ✅ |
| `version = restored_full_v1` | ✅ |
| d001–d200 wav 全部存在 | ✅（磁盘计数 200） |
| manifest audio 路径可解析 | ✅ |
| 随机 5 条 FW `/utterance` | ⚠️ 本轮末 **0/5**（503；Worker 需重启） |

---

## Random Sample ASR Validation

生成完成后首次抽检（4/5 PASS，1×504 timeout）：

| id | toneEnabled | sliceCount |
|----|-------------|------------|
| d007 | true | 29 |
| d019 | true | 35 |
| d065 | true | 28 |
| d197 | true | 16 |
| d142 | — | 504 timeout |

---

## Runtime Probe Result

| 探针 | 生成后会话 | 说明 |
|------|------------|------|
| `d001-timestamp-tone-probe.mjs` | **PASS**（exit 0） | 新 TTS d001；ASR 更接近参考句 |
| `audit_runtime_acceptance --part all` | **未完成** | 长跑被中断；末轮 FW 503 |
| `validate-dialog200-full.py` | 语料 **PASS** / FW 抽检 **FAIL**（503） |

d001 探针摘录（新音频）：

- `raw_asr`: `你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?`
- `toneEnabled`: true（22 slices，与参考文本对齐度优于 minimal subset 版）

---

## Remaining Gaps

1. **FW Worker 稳定性**：验收前需 venv 重启 FW，确认 `/utterance` 非 503 后再跑 `audit --part all`。
2. **Node 配置**：`servicePreferences.faster-whisper-vad: true`。
3. **200-case batch**：语料已就绪，可跑 `run-dialog200-timed-batch.mjs`（耗时长，需 Node+FW 稳定）。

---

## KEEP / MODIFY / RESTORE / DELETE

| 项 | 裁决 |
|----|------|
| `restored_full_v1` manifest + 200 wav | **KEEP** |
| `restore-dialog200-full.py` / `validate-dialog200-full.py` | **KEEP** |
| `restore-dialog200-smoke.py` | **KEEP**（应急 minimal corpus 脚本，非 SSOT） |
| minimal 单条 `context_prior` 复制版 d001 | **DELETE（已被 TTS d001 覆盖）** |
| 原始录制 wav（git 无历史） | **N/A** |

---

## Final Verdict — 必答六项

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否恢复完整 200 条？ | **是** |
| 2 | 是否仍然只是 minimal subset 版？ | **否** — `restored_full_v1` |
| 3 | d001~d200 是否全部存在？ | **是**（200 wav + 200 manifest entries） |
| 4 | cases.manifest.json 是否完整？ | **是** |
| 5 | 是否可以进行 200-case Runtime 回归？ | **是（语料就绪）**；需 FW+Node 启动后执行 batch/audit |
| 6 | 是否可以继续 Tone V2 Phase 1 前置验证？ | **是（CONDITIONAL）** — 语料 PASS；跑通 audit/batch 前需 FW 就绪 |

### 总裁决：**CONDITIONAL PASS**

- **PASS**：200 条语料资产、manifest 契约、文本–音频一一对应、生成脚本与校验脚本  
- **CONDITIONAL**：本轮末 FW 503，完整 `audit --part all` 与 5 条随机 FW 抽检需在 Worker 重启后补跑  

---

## 复现命令

```powershell
# 完整恢复（需 Piper :5009）
python electron_node/electron-node/scripts/test-corpus/restore-dialog200-full.py

# 语料校验
python electron_node/electron-node/scripts/test-corpus/validate-dialog200-full.py

# FW Worker
cd electron_node/services/faster_whisper_vad
$env:PYTHONUTF8="1"
.\.venv\Scripts\python.exe faster_whisper_vad_service.py

# Runtime（FW 就绪后）
.\.venv\Scripts\python.exe -m tone_module.audit_runtime_acceptance --part all
cd ..\..\electron-node
node tests/experiments/d001-timestamp-tone-probe.mjs
```
