# Pinyin IME Spike 实现说明

> 对照 [Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md](./Pinyin_IME_Decoder_Spike_V1_Architecture_Supplement.md) 与 vibe coding 规范实现。  
> **未修改** `main/src/**`、冻结主链、Patch、Scheduler。

## 交付位置

| 路径 | 说明 |
|------|------|
| `electron_node/electron-node/tests/spike/` | 全部 Spike 代码 |
| `electron_node/electron-node/package.json` | `spike:pinyin-ime-v1:*`（`spike:ime:*` 过渡期 deprecated） |
| `docs/pinyin-v1/pinyin-ime-v1-report-latest.md` | `npm run spike:pinyin-ime-v1:analyze` 生成 |

## 命令速查

```powershell
cd electron_node/electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm rebuild better-sqlite3   # 系统 Node 与 Electron ABI 不同时需要

npm run spike:pinyin-ime-v1:export:all    # → tests/spike/tmp/pinyin-ime-v1/*.txt
npm run spike:pinyin-ime-v1:sidecar
npm run spike:pinyin-ime-v1:dialog200     # 需 fw-detector-dialog-200-batch-result.json
npm run spike:pinyin-ime-v1:analyze
```

## 与补充文档的对应

| 补充项 | 实现 |
|--------|------|
| B-01~B-10 冻结边界 | 代码仅在 `tests/spike/` |
| L-01~L-09 词库导出 | `export-lexicon-v3-ime-dict.mjs` |
| P-01~P-06 拼音流 | `lib/pinyin-stream.mjs`（toneless + CJK 段） |
| I-01~I-06 Sidecar | `ime-sidecar-server.mjs`，端口 `PINYIN_IME_SPIKE_PORT` |
| D-01~D-06 Diff | `lib/diff-align.mjs` |
| K-02 KenLM | `lib/kenlm-spike.mjs`（Spike 镜像，非 import 主链） |
| §10 Dialog200 子集 | `lib/subsets.mjs` + analyze 分层 |
| §16 Freeze Gate | `analyze-pinyin-ime-spike.mjs` |

## 重要约束（开发时注意）

1. **dict_dp 非 libpinyin**：无 GPL 二进制时用词典 beam；须**全量**导出才有整句候选。
2. **libpinyin**：设置 `PINYIN_IME_DECODE_CMD` 指向 stdin/stdout JSON 解码器，sidecar 自动切换 `backend=libpinyin_cli`。
3. **better-sqlite3**：Spike 脚本用系统 Node 时需 `npm rebuild better-sqlite3`（与 `lexicon:rebuild-sqlite` Electron ABI 分开）。
4. **主链接入**：Freeze Gate 未通过前禁止改 `fw-detector/`。

## 回滚

删除 `tests/spike/` 与 `package.json` 中 `spike:ime:*` 脚本即可。
