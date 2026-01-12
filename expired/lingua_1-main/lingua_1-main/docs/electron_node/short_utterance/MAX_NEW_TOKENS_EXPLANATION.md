# max_new_tokens 参数详解

## 1. max_new_tokens 的作用

`max_new_tokens` 是 Transformer 模型生成过程中的一个关键参数，用于控制模型**最多生成多少个新 token**。

### 关键特性：

1. **只限制新生成的 token**：不包括输入文本的 token 数
   - 例如：输入 50 个 token，`max_new_tokens=256`，则最多生成 256 个新 token
   - 总输出长度 = 输入 token 数 + 新生成 token 数（最多）

2. **防止无限生成**：如果没有限制，模型可能一直生成直到遇到 EOS token 或达到其他停止条件

3. **控制输出长度**：确保输出不会过长，同时避免截断

### 与 max_length 的区别：

- `max_length`：限制**总长度**（输入 + 输出）
- `max_new_tokens`：只限制**新生成的 token 数**

**推荐使用 `max_new_tokens`**，因为它更直观，不受输入长度影响。

---

## 2. 资源消耗分析

### 2.1 GPU 显存消耗

**主要消耗在 GPU 显存（如果使用 GPU）**：

1. **KV Cache（键值缓存）**：
   - 生成过程中需要存储每个 token 的 key-value 缓存
   - 显存消耗 ≈ `batch_size × num_beams × max_new_tokens × hidden_size × 2`（key + value）
   - **与 `max_new_tokens` 成正比**

2. **注意力矩阵**：
   - 自注意力机制需要计算注意力权重
   - 显存消耗 ≈ `batch_size × num_beams × max_new_tokens × max_new_tokens`
   - **与 `max_new_tokens` 的平方成正比**（但通常使用优化后的实现，实际消耗更小）

3. **中间激活值**：
   - 每层 Transformer 的中间激活值
   - 显存消耗 ≈ `batch_size × num_beams × max_new_tokens × hidden_size × num_layers`

### 2.2 CPU 内存消耗

**如果使用 CPU 运行**：

1. **模型权重**：固定（不随 `max_new_tokens` 变化）
2. **中间激活值**：存储在系统内存中
3. **KV Cache**：存储在系统内存中
4. **内存消耗与 `max_new_tokens` 成正比**

### 2.3 计算时间

**生成时间与 `max_new_tokens` 成正比**：
- 每个新 token 都需要一次前向传播
- 时间消耗 ≈ `max_new_tokens × 单次前向传播时间`

---

## 3. 动态计算 max_new_tokens 的策略

### 3.1 输入输出长度比例

**中英文翻译的 token 比例**：

1. **字符级别**：
   - 中文：1 字符 ≈ 1 token（通常）
   - 英文：1 词 ≈ 1 token（通常）
   - 中英文词比例：约 1:1.5-2（中文更紧凑）

2. **实际观察**：
   - 短句（< 20 字符）：比例约 1:1.5-2
   - 中等句子（20-50 字符）：比例约 1:2-2.5
   - 长句（> 50 字符）：比例约 1:2.5-3

### 3.2 计算公式

```python
def calculate_max_new_tokens(input_text: str, context_text: Optional[str] = None) -> int:
    """
    根据输入文本长度动态计算 max_new_tokens
    
    Args:
        input_text: 当前要翻译的文本
        context_text: 上下文文本（可选）
    
    Returns:
        合理的 max_new_tokens 值
    """
    # 1. 计算输入文本长度（字符数）
    input_length = len(input_text)
    if context_text:
        # 如果拼接了 context_text，需要考虑总长度
        total_input_length = len(context_text) + len(input_text)
    else:
        total_input_length = input_length
    
    # 2. 根据输入长度估算输出 token 数
    # 中文字符到英文 token 的粗略比例
    # 保守估计：1 字符中文 → 2.5 token 英文（考虑 tokenization）
    base_ratio = 2.5
    
    # 3. 根据输入长度调整比例（长句可能需要更多 token）
    if total_input_length < 20:
        ratio = 2.0  # 短句：1:2
    elif total_input_length < 50:
        ratio = 2.5  # 中等句子：1:2.5
    else:
        ratio = 3.0  # 长句：1:3
    
    # 4. 计算基础 token 数
    estimated_tokens = int(total_input_length * ratio)
    
    # 5. 添加安全缓冲（+50%）
    estimated_tokens = int(estimated_tokens * 1.5)
    
    # 6. 设置合理的上下限
    min_tokens = 128   # 最短至少 128 个 token（短句）
    max_tokens = 512   # 最长不超过 512 个 token（避免显存溢出）
    
    max_new_tokens = max(min_tokens, min(estimated_tokens, max_tokens))
    
    return max_new_tokens
```

### 3.3 优化建议

1. **使用 tokenizer 精确计算**：
   ```python
   # 更精确的方法：使用 tokenizer 计算实际 token 数
   input_tokens = len(tokenizer.encode(input_text))
   estimated_output_tokens = int(input_tokens * 2.5)  # 中英文比例
   max_new_tokens = max(128, min(estimated_output_tokens + 50, 512))
   ```

2. **考虑 context_text**：
   - 如果拼接了 `context_text`，总输入长度会增加
   - 需要相应增加 `max_new_tokens`

3. **监控实际使用情况**：
   - 记录每次生成实际使用的 token 数
   - 根据历史数据优化计算公式

---

## 4. 实际资源消耗估算

### 4.1 M2M100-418M 模型（418M 参数）

**假设配置**：
- `num_beams = 4`
- `batch_size = 1`
- `hidden_size = 1024`（估算）
- `num_layers = 12`（估算）

**显存消耗估算**（每个新 token）：

1. **KV Cache**：
   - 每层：`1 × 4 × 1 × 1024 × 2 = 8KB`（单精度）
   - 12 层：`8KB × 12 = 96KB`（每 token）
   - 256 tokens：`96KB × 256 = 24MB`
   - 512 tokens：`96KB × 512 = 48MB`

2. **中间激活值**：
   - 每层：`1 × 4 × 1 × 1024 = 4KB`
   - 12 层：`4KB × 12 = 48KB`（每 token）
   - 256 tokens：`48KB × 256 = 12MB`
   - 512 tokens：`48KB × 512 = 24MB`

**总显存消耗**（仅生成部分）：
- `max_new_tokens=256`：约 36MB
- `max_new_tokens=512`：约 72MB

**注意**：这只是生成过程中的额外消耗，不包括模型权重和输入编码的消耗。

### 4.2 实际建议

1. **GPU 显存充足（> 8GB）**：
   - 可以设置 `max_new_tokens=512` 或更高
   - 动态计算，上限设为 512

2. **GPU 显存有限（4-8GB）**：
   - 建议 `max_new_tokens=256-384`
   - 动态计算，上限设为 384

3. **CPU 运行**：
   - 主要消耗系统内存
   - 可以设置更高的值（如 512-1024），但生成时间会显著增加

---

## 5. 实现建议

### 5.1 动态计算函数

```python
def calculate_max_new_tokens(
    input_text: str,
    context_text: Optional[str] = None,
    tokenizer: Optional[M2M100Tokenizer] = None,
    min_tokens: int = 128,
    max_tokens: int = 512,
    safety_margin: float = 1.5
) -> int:
    """
    根据输入文本长度动态计算 max_new_tokens
    
    Args:
        input_text: 当前要翻译的文本
        context_text: 上下文文本（可选）
        tokenizer: Tokenizer 实例（如果提供，使用精确计算）
        min_tokens: 最小 token 数
        max_tokens: 最大 token 数
        safety_margin: 安全缓冲系数（默认 1.5，即 +50%）
    
    Returns:
        合理的 max_new_tokens 值
    """
    if tokenizer:
        # 精确计算：使用 tokenizer
        input_tokens = len(tokenizer.encode(input_text))
        if context_text:
            context_tokens = len(tokenizer.encode(context_text))
            total_input_tokens = input_tokens + context_tokens
        else:
            total_input_tokens = input_tokens
        
        # 中英文 token 比例（保守估计）
        ratio = 2.5
        estimated_output_tokens = int(total_input_tokens * ratio)
    else:
        # 粗略估算：使用字符数
        input_length = len(input_text)
        if context_text:
            total_input_length = len(context_text) + len(input_text)
        else:
            total_input_length = input_length
        
        # 根据输入长度调整比例
        if total_input_length < 20:
            ratio = 2.0
        elif total_input_length < 50:
            ratio = 2.5
        else:
            ratio = 3.0
        
        estimated_output_tokens = int(total_input_length * ratio)
    
    # 添加安全缓冲
    estimated_output_tokens = int(estimated_output_tokens * safety_margin)
    
    # 限制在合理范围内
    max_new_tokens = max(min_tokens, min(estimated_output_tokens, max_tokens))
    
    return max_new_tokens
```

### 5.2 截断检测

```python
def is_translation_complete(text: str) -> bool:
    """
    检查翻译结果是否完整（简单启发式方法）
    
    Args:
        text: 翻译结果文本
    
    Returns:
        True 如果看起来完整，False 如果可能被截断
    """
    text = text.strip()
    if not text:
        return False
    
    # 检查是否以标点符号结尾
    ending_punctuation = ['.', '!', '?', '。', '！', '？', ',', '，', ';', '；']
    if text[-1] in ending_punctuation:
        return True
    
    # 检查最后几个词是否完整（简单检查）
    last_words = text.split()[-3:]  # 最后 3 个词
    for word in last_words:
        if len(word) < 2:  # 单字符词可能是截断
            return False
    
    return True
```

---

## 6. 总结

1. **max_new_tokens 的作用**：限制模型最多生成的新 token 数，防止无限生成和截断

2. **资源消耗**：
   - **主要消耗 GPU 显存**（如果使用 GPU）
   - 与 `max_new_tokens` 成正比
   - 对于 M2M100-418M，256 tokens 约消耗 36MB，512 tokens 约消耗 72MB

3. **动态计算策略**：
   - 根据输入文本长度估算输出 token 数
   - 中英文比例约 1:2.5（保守估计）
   - 添加安全缓冲（+50%）
   - 设置合理上下限（128-512）

4. **建议**：
   - 使用 tokenizer 精确计算（如果可能）
   - 根据 GPU 显存情况设置上限
   - 添加截断检测机制
   - 监控实际使用情况，优化计算公式

