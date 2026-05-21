# Sentence KenLM 训练目录

Recover V2 句级 rerank 用的中文字符级 3-gram KenLM（**非** CTC decoder KenLM）。

## 目录

```text
kenLM/
  corpus/          # 原始与分词后语料
  model/           # 训练产物 .arpa / .trie.bin
  kenlm/           # KenLM 源码与编译（git clone）
  scripts/         # 本目录辅助脚本
```

## 一键（WSL）

```bash
cd /mnt/d/Programs/github/lingua_1/kenLM
bash scripts/setup_and_train.sh
```

## 当前产物（已训练）

| 文件 | 说明 |
|------|------|
| `corpus/zh_sentences.raw.txt` | Hugging Face 中文新闻摘要语料（约 43.9 万句） |
| `corpus/corpus.char.txt` | 字符级分词后训练输入 |
| `model/zh_char_3gram.arpa` | ARPA（约 119 MB） |
| `model/zh_char_3gram.trie.bin` | 节点推理用 trie（约 34 MB） |
| `kenlm/build/bin/query` | WSL 下 query 工具 |

## 节点配置

```powershell
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
$env:CHAR_LM_PATH="D:\Programs\github\lingua_1\kenLM\model\zh_char_3gram.trie.bin"
# WSL 内 query（节点若在 Windows 原生跑，需 WSL 路径或单独编译 Windows query.exe）
$env:KENLM_QUERY_PATH="D:\Programs\github\lingua_1\kenLM\kenlm\build\bin\query"
```

仅设置 `PROJECT_ROOT` 时，Node 会自动探测 `kenLM/model/zh_char_3gram.trie.bin`。

Smoke：`wsl bash kenLM/scripts/smoke_query.sh`
