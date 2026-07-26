# dialog_200 测试语料

**状态**：`restored_full_v1`（2026-06-28 完整恢复）

## 当前范围

| 项 | 值 |
|----|-----|
| `isFullCorpus` | `true` |
| `caseCount` | `200`（d001–d200） |
| 用途 | Tone / FW / Lexicon dialog200 batch 回归 |

## 文件

- `cases.manifest.json` — 包装 schema（200 cases）
- `dialog_d001.wav` … `dialog_d200.wav` — Piper TTS 合成（16kHz mono）
- `context_prior/` — context-prior 探针 wav（10 条，独立语料）

## 恢复命令

```powershell
# 需 Piper TTS :5009 就绪
python electron_node/electron-node/scripts/test-corpus/restore-dialog200-full.py

# 校验
python electron_node/electron-node/scripts/test-corpus/validate-dialog200-full.py
```

## 文本来源

- Utterance：`electron_node/electron-node/tests/experiments/tone-module-p1-dialog-fw-scan.json`
- Scenario：`electron_node/electron-node/tests/raw-log-delta-gate3-dialog200-batch-result.json`

## 说明

- manifest **不含** word timestamp / tone label / refTones
- 每条 wav 与 manifest 文本一一对应（Piper TTS 生成，非复用单条音频）
