# ASR Beam Size 配置架构说明

## 当前架构

### 配置位置

ASR的`beam_size`配置实际上**有两个地方**可以设置：

1. **Node配置** (`electron_node/electron-node/main/src/node-config.ts`)
   - 位置：`DEFAULT_CONFIG.asr.beam_size = 2`
   - 作用：Node端读取配置，通过HTTP请求传递给Python服务

2. **Python服务配置** (`electron_node/services/faster_whisper_vad/config.py`)
   - 位置：`BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "10"))`
   - 作用：作为默认值，如果请求中没有传递`beam_size`参数才使用

### 数据流

```
Node配置 (node-config.ts)
  ↓ loadNodeConfig()
TaskRouter (task-router-asr.ts)
  ↓ this.getASRConfig().beam_size
HTTP请求 (requestBody.beam_size)
  ↓ POST /utterance
Python服务 (faster_whisper_vad_service.py)
  ↓ req.beam_size (如果请求中有) 或 BEAM_SIZE (默认值)
ASR Worker
```

### 代码实现

#### Node端 (`task-router-asr.ts`)
```typescript
beam_size: task.beam_size || this.getASRConfig().beam_size,
```
- 优先使用任务中的`beam_size`（如果任务指定了）
- 否则使用Node配置中的`beam_size`

#### Python服务端 (`api_models.py`)
```python
beam_size: int = BEAM_SIZE  # 从配置文件读取，默认 10
```
- 如果HTTP请求中传递了`beam_size`，使用请求中的值
- 如果请求中没有传递，使用`BEAM_SIZE`（从`config.py`读取）

## 为什么这样设计？

### 优点

1. **灵活性**：
   - 可以在Node端统一管理配置，不需要重启Python服务
   - 可以为不同的任务动态设置不同的`beam_size`
   - 配置集中管理，便于维护

2. **向后兼容**：
   - Python服务仍然支持环境变量配置（`ASR_BEAM_SIZE`）
   - 如果其他客户端直接调用Python服务，可以使用服务端的默认配置

3. **动态调整**：
   - 可以在运行时修改Node配置，立即生效
   - 不需要重启Python服务

### 缺点

1. **配置分散**：
   - 配置在两个地方（Node配置和服务配置）
   - 可能导致不一致（如果只修改了一处）

2. **依赖关系**：
   - Python服务的默认值可能被Node配置覆盖
   - 如果Node配置和服务配置不一致，可能造成混淆

## 为什么不在服务端设置？

### 如果只在服务端设置的问题

1. **需要重启服务**：
   - 每次修改配置都需要重启Python服务
   - 影响服务可用性

2. **无法动态调整**：
   - 不能为不同的任务设置不同的`beam_size`
   - 不能根据运行时情况动态调整

3. **配置管理分散**：
   - Node端需要管理其他配置（如GPU仲裁、顺序执行等）
   - 如果ASR配置也在服务端，配置管理会更分散

## 建议的改进

### 方案1：保持当前架构（推荐）

**优点**：
- 灵活性高，可以动态调整
- 配置集中管理（Node端）
- 向后兼容（服务端仍有默认值）

**缺点**：
- 配置分散在两个地方

**建议**：
- 在文档中明确说明配置优先级
- Node配置优先，服务配置作为后备

### 方案2：只在服务端设置

**优点**：
- 配置集中在一个地方
- 更符合微服务架构（服务自己管理配置）

**缺点**：
- 需要重启服务才能生效
- 无法动态调整
- 配置管理分散（Node端和服务端）

### 方案3：统一配置管理

**优点**：
- 配置集中管理
- 可以动态调整

**缺点**：
- 需要额外的配置管理服务
- 架构复杂度增加

## 当前最佳实践

1. **主要配置在Node端**：
   - 在`node-config.ts`中设置`beam_size`
   - 这是"主动"配置，会通过HTTP请求传递给服务

2. **服务端作为后备**：
   - 在`config.py`中设置默认值
   - 这是"被动"配置，只在请求中没有传递参数时使用

3. **优先级**：
   - 任务中的`beam_size`（如果指定）> Node配置 > 服务端默认值

## 总结

ASR的`beam_size`在Node配置中设置，而不是只在服务端设置，是为了：

1. **灵活性**：可以在运行时动态调整，不需要重启服务
2. **集中管理**：Node端统一管理所有配置
3. **向后兼容**：服务端仍有默认值，支持其他客户端直接调用

这种设计是合理的，但需要在文档中明确说明配置优先级和最佳实践。
