# 字符级 KenLM 模型（同音/近音纠错用）

本目录用于**从语料训练**字符级 n-gram 模型，得到 `zh_char_3gram.trie.bin`，供节点端同音字候选选优使用。

**说明**：该模型**没有现成下载地址**，必须用 KenLM 工具在本机从语料完成「训练 + 剪裁 + 导出 trie」。  
**Windows 用户**：KenLM 的 `lmplz` / `build_binary` 需在 **WSL**（或 Linux/macOS）下编译并运行训练脚本；本机已完成的只有「语料 + 分词」。

---

## 目录结构

- `data/zh_sentences.txt` — 小示例语料（每行一句，UTF-8）
- `data/zh_sentences_large.txt`、`data/en_sentences_large.txt` — **仅新闻语料**（由 `fetch_news_corpus.py` 或 `download_corpus.py` 生成，勿用模板脚本覆盖）
- `data/zh_sentences_template.txt`、`data/en_sentences_template.txt` — 模板生成的测试语料（`generate_zh_corpus.py` / `generate_en_corpus.py` 输出，不用于正式训练）
- `data/zh_char_tokenized*.txt`、`data/en_word_tokenized.txt` — 分词后语料
- `models/` — 输出目录（小语料训练用）
- `scripts/fetch_news_corpus.py` — 抓取中英文新闻（仅新闻，不补模板）
- `scripts/download_corpus.py` — 从 Hugging Face 下载中文新闻摘要数据集写入 `zh_sentences_large.txt`（仅新闻）
- `scripts/train_zh_large.sh`、`train_en_large.sh` — 训练并复制到 `electron_node/services/semantic_repair_en_zh/models/`
- `scripts/` — 分词与训练脚本
- `kenlm/` — 可选，用于放置 KenLM 源码并编译（见下方）

---

## 步骤零：WSL 前置（仅首次需做）

在 **WSL** 里先安装编译依赖（会提示输入 Ubuntu 密码）：

```bash
sudo apt-get update
sudo apt-get install -y cmake build-essential git
```

---

## 步骤一：安装 KenLM（仅需一次）

在 **WSL 或 Linux/macOS** 下执行（Windows 原生需 CMake + 编译器，推荐用 WSL）：

```bash
# 进入本仓库 addons/char-lm
cd /mnt/d/Programs/github/lingua_1/addons/char-lm   # WSL 路径示例

# 克隆并编译 KenLM（若已克隆过可跳过 git clone）
test -d kenlm || git clone https://github.com/kpu/kenlm.git
mkdir -p kenlm/build && cd kenlm/build
cmake ..
cmake --build . -j

# 将工具所在目录记下来，后面训练要用
export KENLM_BIN="$(pwd)/bin"
# 例如: KENLM_BIN=/mnt/d/Programs/github/lingua_1/addons/char-lm/kenlm/build/bin
```

也可使用 `scripts/clone_build_kenlm.sh`（在 WSL 中运行），会在本目录下创建 `kenlm/` 并编译。

---

## 步骤二：准备语料

- 将**每行一句**的中文语料放入 `data/zh_sentences.txt`（UTF-8）。
- 当前已有一份示例语料；**效果更好请用实际业务/ASR 相关文本**。

---

## 步骤三：训练 + 剪裁 + 生成 trie

在 **WSL/Linux/macOS** 下（推荐）：

```bash
cd /mnt/d/Programs/github/lingua_1/addons/char-lm
export KENLM_BIN="$PWD/kenlm/build/bin"   # 若 KenLM 编译在别处，改为实际路径
bash scripts/train_and_build.sh
```

或在 **Windows PowerShell** 下（需已安装 KenLM 并将 `lmplz`、`build_binary` 放入 PATH，或设置 `$env:KENLM_BIN`）：

```powershell
cd D:\Programs\github\lingua_1\addons\char-lm
$env:KENLM_BIN = "C:\path\to\kenlm\build"   # 若 KenLM 在 WSL，需在 WSL 里跑 train_and_build.sh
.\scripts\train_and_build.ps1
```

完成后模型路径：

- **ARPA**：`addons/char-lm/models/zh_char_3gram.arpa`
- **Trie 二进制**：`addons/char-lm/models/zh_char_3gram.trie.bin`

---

## 节点端使用

将生成的 `zh_char_3gram.trie.bin` 路径告诉节点端：

- 环境变量：`CHAR_LM_PATH=D:\Programs\github\lingua_1\addons\char-lm\models\zh_char_3gram.trie.bin`
- 或放到节点端默认查找路径（见节点端文档）。

并确保 KenLM 的 `query` 可执行文件在 PATH 中，或设置 `KENLM_QUERY_PATH`。

更多命令与参数说明见：`docs/decision/ken_lm_字符级trie模型_构建命令清单与节点端使用说明.md`。

---

## 大语料训练（仅新闻语料，输出到合并服务 models）

语料**仅来自新闻**（RSS + 可选正文抓取），不再使用模板生成。

1. **准备纯新闻语料**（二选一，勿用 `generate_zh_corpus.py` 生成的内容覆盖 `zh_sentences_large.txt`）：  
   - **抓取**（依赖：`pip install feedparser requests readability-lxml`）：  
     `python3 scripts/fetch_news_corpus.py` → 输出 `zh_sentences_large.txt`、`en_sentences_large.txt`（仅新闻）。  
     不抓正文：`python3 scripts/fetch_news_corpus.py --no-articles`  
   - **下载**（依赖：`pip install datasets`）：  
     `python3 scripts/download_corpus.py` → 中文新闻 → `zh_sentences_large.txt`；  
     `python3 scripts/download_corpus.py --en` → 英文新闻 → `en_sentences_large.txt`。  
   - 若当前大文件里混有模板句，请用上述脚本**重新生成**以覆盖为纯新闻。

2. **在 WSL 中训练并复制到 semantic_repair_en_zh/models**  
   ```bash
   export KENLM_BIN="$PWD/kenlm/build/bin"
   bash scripts/train_zh_large.sh
   bash scripts/train_en_large.sh
   ```
   若语料文件不存在，训练脚本会先执行 `fetch_news_corpus.py` 再训练。

脚本默认使用 `--prune 0 0 1`。**若要中英文各达到几十 MB**：需使用**更大规模语料**，并放宽剪裁：  
`PRUNE_ZH="0 0 0" PRUNE_EN="0 0 0" bash scripts/train_zh_large.sh` 与 `bash scripts/train_en_large.sh`。
