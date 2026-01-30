# 备份代码配置覆盖机制分析

**日期**: 2026-01-23  
**目的**: 分析备份代码中ASR配置的覆盖机制，找出实际运行时使用的配置来源

---

## 一、问题背景

用户反馈：排查了好久才找出备份代码里实际使用的是 `BEAM_SIZE=5` 和 `faster-whisper-base` 模型，但 `config.py` 中默认是 `BEAM_SIZE=10` 和 `faster-whisper-large-v3`。

这说明备份代码中**存在配置覆盖机制**，实际运行时使用的配置可能不是 `config.py` 中的默认值。

---

## 二、BEAM_SIZE 配置覆盖机制

### 2.1 配置来源层级

**层级1: `config.py` 默认值**
```python
BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "10"))  # 默认 10
```

**层级2: 环境变量覆盖**
```bash
ASR_BEAM_SIZE=5  # 通过环境变量覆盖为 5
```

**层级3: HTTP请求参数覆盖**
```python
# api_models.py
beam_size: int = BEAM_SIZE  # 从配置文件读取，但如果HTTP请求中传递了beam_size，使用请求中的值
```

**层级4: 任务参数覆盖**
```typescript
// task-router-asr.ts
// 如果任务中指定了beam_size，使用任务中的值；否则不传递，让服务使用自己的默认值
...(task.beam_size !== undefined ? { beam_size: task.beam_size } : {})
```

### 2.2 实际运行时使用的值

**备份代码实际运行时**:
- `BEAM_SIZE=5`（通过环境变量或HTTP请求参数覆盖）

**可能的原因**:
1. 启动脚本中设置了 `ASR_BEAM_SIZE=5`
2. HTTP请求中传递了 `beam_size=5`
3. 任务中指定了 `beam_size=5`

---

## 三、模型路径配置覆盖机制

### 3.1 配置来源层级

**层级1: `config.py` 默认值**
```python
_default_model_path = "Systran/faster-whisper-large-v3"  # 大模型
```

**层级2: 本地模型目录检查**
```python
# config.py
if os.path.exists(_local_model_path) and os.path.isdir(_local_model_path):
    ASR_MODEL_PATH = os.getenv("ASR_MODEL_PATH", _local_model_path)
```

**层级3: Node.js服务配置覆盖（关键！）**
```typescript
// python-service-config.ts
// 只检查服务目录下的本地 CTranslate2 模型
const localCt2ModelPath = path.join(servicePath, 'models', 'asr', 'whisper-base-ct2');

if (fs.existsSync(localCt2ModelPath)) {
  // 使用转换后的 CTranslate2 模型
  asrModelPath = 'Systran/faster-whisper-base';  // ⚠️ 覆盖为 base 模型！
  // 设置缓存目录环境变量，让 Faster Whisper 使用本地缓存
  baseEnv.WHISPER_CACHE_DIR = localCt2ModelPath;
}

// 通过环境变量传递给Python服务
const env: Record<string, string> = {
  ASR_MODEL_PATH: asrModelPath,  // ⚠️ 覆盖了 config.py 中的默认值
  // ...
};
```

### 3.2 实际运行时使用的值

**备份代码实际运行时**:
- `ASR_MODEL_PATH=Systran/faster-whisper-base`（通过 `python-service-config.ts` 覆盖）

**原因**:
- 如果本地存在 `whisper-base-ct2` 目录，`python-service-config.ts` 会自动将 `ASR_MODEL_PATH` 设置为 `Systran/faster-whisper-base`
- 这个值通过环境变量传递给Python服务，覆盖了 `config.py` 中的默认值

---

## 四、配置覆盖顺序总结

### 4.1 BEAM_SIZE 覆盖顺序

1. **任务参数** (`task.beam_size`) - 最高优先级
2. **HTTP请求参数** (`requestBody.beam_size`) - 次高优先级
3. **环境变量** (`ASR_BEAM_SIZE`) - 中等优先级
4. **config.py 默认值** (`BEAM_SIZE = 10`) - 最低优先级

### 4.2 模型路径覆盖顺序

1. **环境变量** (`ASR_MODEL_PATH`) - 最高优先级
2. **Node.js服务配置** (`python-service-config.ts`) - 次高优先级
   - 如果本地存在 `whisper-base-ct2`，自动设置为 `Systran/faster-whisper-base`
3. **本地模型目录检查** (`config.py`) - 中等优先级
   - 如果本地存在模型目录，使用本地路径
4. **config.py 默认值** (`faster-whisper-large-v3`) - 最低优先级

---

## 五、备份代码中的配置冲突

### 5.1 配置冲突示例

**问题1: BEAM_SIZE 不一致**
- `config.py`: 默认 10
- `asr_worker_process.py`: 默认 10
- 文档和测试代码: 使用 5
- 实际运行时: 可能是 5（通过环境变量或HTTP请求覆盖）

**问题2: 模型版本不一致**
- `config.py`: 默认 `faster-whisper-large-v3`
- `python-service-config.ts`: 如果本地有 `whisper-base-ct2`，自动使用 `faster-whisper-base`
- 实际运行时: 使用 `faster-whisper-base`（通过Node.js服务配置覆盖）

### 5.2 配置覆盖导致的问题

1. **配置来源不明确**: 很难确定实际运行时使用的配置值
2. **配置冲突**: 不同文件中的默认值不一致
3. **调试困难**: 需要检查多个地方才能找到实际使用的配置
4. **文档不准确**: 文档中的配置可能与实际运行时不一致

---

**文档版本**: v1.0  
**最后更新**: 2026-01-23  
**状态**: 归档文档（历史记录）
