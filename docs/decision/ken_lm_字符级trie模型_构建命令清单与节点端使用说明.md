# KenLM 字符级 Trie 模型：构建命令清单 + 节点端使用说明（省内存优先）

> 目标：为节点端“同音/近音候选选优”提供 **字符级 n-gram LM 打分器**。
>
> 选择：**KenLM Trie**（省内存优先，速度仍然很快）。([github.com](https://github.com/kpu/kenlm?utm_source=chatgpt.com))
>
> 约束：
> - LM 文件 **内置到节点端安装包**
> - 不引入“错误→正确”维护词表；LM 仅负责对候选句打分
> - 控制流单路径：候选生成 → LM 打分 → delta 阈值选优 → 写回文本

---

## 1) 构建命令清单（可直接复制执行）

> 假设：
> - 构建机为 Linux/macOS（Windows 也可用 WSL；KenLM 需要编译）
> - 输入语料为 UTF-8 文本，每行一句（建议先用你们实际业务/ASR 文本日志做语料，效果最好）

### 1.1 安装与编译 KenLM

```bash
# 1) 拉取源码
git clone https://github.com/kpu/kenlm.git
cd kenlm

# 2) 编译（生成 lmplz / build_binary / query 等工具）
mkdir -p build && cd build
cmake ..
cmake --build . -j

# 可选：把工具加入 PATH
export KENLM_BIN="$PWD/bin"
```

KenLM 支持 probing 与 trie；本方案选择 trie（内存最省）。([github.com](https://github.com/kpu/kenlm?utm_source=chatgpt.com))

---

### 1.2 准备“字符级”训练语料（每行一句，按字符空格分隔）

> KenLM 默认以“token”为单位。要做中文字符级 LM，需要把每个汉字当作 token。

假设原语料为：`data/zh_sentences.txt`（每行一句中文，可混少量标点/数字）

#### 方案 A：Python 一次性转换（推荐，最稳定）

```bash
python3 - << 'PY'
import re

src = 'data/zh_sentences.txt'
dst = 'data/zh_char_tokenized.txt'

# 保留：汉字、字母数字、常用标点；其余归一为空格
keep_punct = set('，。！？；：、“”‘’（）()《》<>【】[]—-…·,.!?;:"\'')

def tokenize(line: str) -> str:
    line = line.strip()
    if not line:
        return ''
    out = []
    for ch in line:
        # CJK Unified Ideographs
        if '\u4e00' <= ch <= '\u9fff':
            out.append(ch)
        elif ch.isalnum():
            out.append(ch)
        elif ch in keep_punct:
            out.append(ch)
        else:
            # drop/space
            continue
    return ' '.join(out)

with open(src, 'r', encoding='utf-8') as f_in, open(dst, 'w', encoding='utf-8') as f_out:
    for line in f_in:
        t = tokenize(line)
        if t:
            f_out.write(t + '\n')

print('Wrote', dst)
PY
```

输出：`data/zh_char_tokenized.txt`（字符 token 间有空格）

---

### 1.3 训练 LM（建议 3-gram 或 4-gram）

> `lmplz` 使用 Modified Kneser-Ney 平滑；可用 `-S` 控制构建内存；可用 `-T` 指定临时目录。([www2.statmt.org](https://www2.statmt.org/moses/manual/html/language-models.html?utm_source=chatgpt.com))

#### 训练 3-gram（推荐起步）

```bash
$KENLM_BIN/lmplz \
  -o 3 \
  -S 50% \
  -T /tmp \
  --prune 0 0 1 \
  < data/zh_char_tokenized.txt \
  > build/zh_char_3gram.arpa
```

- `--prune`：启用计数阈值裁剪（非降序，首项必须为 0；示例 `0 0 1` 表示三元及更高阶裁剪单例）。([kheafield.com](https://kheafield.com/code/kenlm/estimation/?utm_source=chatgpt.com))

> 说明：prune 参数需要按你的语料规模调。语料越大可适当加大阈值（例如 `0 0 2`）。

#### 训练 4-gram（可选，略增体积与打分开销）

```bash
$KENLM_BIN/lmplz \
  -o 4 \
  -S 50% \
  -T /tmp \
  --prune 0 0 1 2 \
  < data/zh_char_tokenized.txt \
  > build/zh_char_4gram.arpa
```

---

### 1.4 生成“Trie 二进制模型”（省内存）

```bash
# 生成 trie（二进制）
$KENLM_BIN/build_binary trie \
  build/zh_char_3gram.arpa \
  build/zh_char_3gram.trie.bin
```

KenLM 文档明确：trie 结构以节省内存为目标。([github.com](https://github.com/kpu/kenlm?utm_source=chatgpt.com))

---

### 1.5 体积与质量的快速迭代建议

1) **先用 3-gram**，prune 用 `0 0 1`（或更强），保证体积可内置
2) 如果误改多：增大 `delta`（使用阶段调）或加大 prune（训练阶段调）
3) 如果改不动：降低 prune（保留更多 n-gram），或从 3-gram 提升到 4-gram

---

## 2) 节点端如何使用该模型（技术文档）

### 2.1 运行时选择（推荐）

为“速度 + 省内存”同时兼顾，并避免复杂控制流：

- **推荐：Node 原生绑定（in-process）加载 trie.bin**
  - 只加载一次，常驻内存
  - 打分为纯函数调用，无进程创建开销
  - 最符合你们“运行最快、资源最省”的目标

> 备选（不推荐）：每次用 `query` 子进程打分。实现简单但进程启动/IO 开销大，会拖慢整体。

KenLM 本身是 C++ 库；trie/probing 选择与内存/速度权衡在官方文档中已说明。([github.com](https://github.com/kpu/kenlm?utm_source=chatgpt.com))

---

### 2.2 与现有代码的集成点（单一路径）

将 LM 打分逻辑嵌入你们现有的 **PHONETIC_CORRECTION**（唯一入口），替换“恒返回原文”的实现：

```text
ASR 文本
  → (已有) 聚合/清洗
  → PHONETIC_CORRECTION（改造：候选生成 + LM 打分 + 选优）
  → (已有) 语义修复
  → 下游
```

关键要求：
- 全工程 **只有一个调用入口**
- 不新增额外并行路径、不做兜底链

---

### 2.3 运行时打分接口定义

> 输入为**原始中文字符串**，内部转换为“字符 token 序列”再喂给 KenLM。

建议 TS 接口：

```ts
export type LmScoreResult = {
  score: number;       // 越大越好（logprob 或 -NLL）
  oovCount: number;    // OOV token 数
};

export interface CharLmScorer {
  score(text: string): LmScoreResult;
}
```

### 2.4 文本到 token 的一致性（必须）

训练与推理必须一致：
- 同样的字符切分规则
- 同样的标点保留规则

建议复用训练时的字符化函数逻辑（同一份实现拷贝/共享）。

---

### 2.5 候选生成与选优（最小复杂度）

**候选生成**：复用 `SAME_PINYIN_GROUPS`
- 只允许替换 **1~2 个位置**（`M=1 or 2`）
- 总候选数上限 `K`（建议 `K=24`）

**选优规则**：
- `best = argmax score(candidate)`
- 仅当 `score(best) - score(original) >= delta` 才替换
  - 建议初始 `delta = 1.0`（按你们实际 logprob 尺度微调）

> `delta` 是唯一安全阀：避免 LM 微弱偏好导致过度改写。

---

### 2.6 失败语义（与你们既定裁决一致）

- LM 文件缺失/损坏：**fail-open**，跳过打分，直接返回原文 + 记录一次错误日志
- 候选生成失败：返回原文
- 不做重试、不做跨节点补偿

---

### 2.7 可观测性（必须）

每次触发时输出一条 debug 日志：
- `originalText`
- `bestText`
- `deltaScore`
- `candidatesCount`
- `changed`

未触发时输出原因：
- 非中文 / 无候选 / 超长 / LM 不可用

---

## 3) 交付物清单（给开发）

1. 内置模型文件：
   - `assets/models/zh_char_3gram.trie.bin`
2. 运行时 scorer：
   - `CharLmScorer`（Node 原生绑定实现）
3. 改造点：
   - `PHONETIC_CORRECTION`：候选生成 → 打分 → delta 选优 → 写回文本
4. 配置项（可选，但建议保留）：
   - `maxPositions (M)`、`maxCandidates (K)`、`delta`

---

## 4) 需要你们补充确认的唯一点（不确认会阻塞实现）

你们节点端是否允许 **native addon（node-gyp / prebuild）**？
- **允许**：按推荐方案实现（最快、无额外控制流）
- **不允许**：只能退化为子进程 `query`（实现简单但慢，且系统资源更高）

> 不建议同时实现两套，避免重复路径；请直接在决策里选定其一。

