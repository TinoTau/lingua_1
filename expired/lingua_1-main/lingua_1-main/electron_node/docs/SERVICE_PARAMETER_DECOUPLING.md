# 服务参数解耦重构

## 重构目标

支持系统热插拔，而不是支持系统随时调整参数。各服务的参数应该随着服务走，避免节点端与服务强制绑定，避免预加载一堆参数却找不到对应服务的bug。

## 问题背景

### 之前的问题

1. **节点端预加载服务参数**：
   - Node端在`node-config.ts`中预加载了ASR配置（beam_size、temperature等）
   - TaskRouter在初始化时就加载ASR配置
   - 如果ASR服务没有启动，这些配置就没有意义

2. **节点端与服务强制绑定**：
   - 节点端必须知道服务的所有参数
   - 修改服务参数需要同时修改节点端配置
   - 服务热插拔时，节点端配置可能无效

3. **配置分散**：
   - 配置在两个地方（Node配置和服务配置）
   - 可能导致不一致

## 重构方案

### 核心原则

1. **服务参数随服务走**：
   - 各服务的参数应该在服务自己的配置文件中设置
   - ASR服务的参数在`config.py`中设置
   - NMT服务的参数在`nmt_service.py`中设置

2. **节点端不预加载服务参数**：
   - 节点端不预加载服务的具体参数
   - 节点端只管理节点级别的配置（如GPU仲裁、顺序执行等）

3. **支持服务热插拔**：
   - 服务可以动态启动/停止
   - 节点端不需要预先知道服务是否存在
   - 服务参数由服务自己管理

### 具体修改

#### 1. 移除Node端的ASR配置

**文件**: `electron_node/electron-node/main/src/node-config.ts`

**修改前**:
```typescript
export interface ASRConfig {
  beam_size?: number;
  temperature?: number;
  // ...
}

export interface NodeConfig {
  asr?: ASRConfig;
  // ...
}

const DEFAULT_CONFIG: NodeConfig = {
  asr: {
    beam_size: 2,
    temperature: 0.0,
    // ...
  },
  // ...
};
```

**修改后**:
```typescript
// ASR配置已移除：各服务的参数应该随着服务走，避免节点端与服务强制绑定
// ASR服务的参数（如beam_size）应该在ASR服务自己的配置文件中设置（config.py）

export interface NodeConfig {
  // ASR配置已移除：各服务的参数应该随着服务走
  // ...
}
```

#### 2. 移除TaskRouter中的ASR配置加载

**文件**: `electron_node/electron-node/main/src/task-router/task-router-asr.ts`

**修改前**:
```typescript
export class TaskRouterASRHandler {
  private asrConfig: NodeConfig['asr'];
  
  constructor(...) {
    this.loadASRConfig();
    // ...
  }
  
  private loadASRConfig(): void {
    // 从node-config加载ASR配置
  }
  
  private getASRConfig(): Required<NonNullable<NodeConfig['asr']>> {
    // 返回ASR配置（带默认值）
  }
  
  // 使用配置
  beam_size: task.beam_size || this.getASRConfig().beam_size,
}
```

**修改后**:
```typescript
export class TaskRouterASRHandler {
  // ASR配置已移除：各服务的参数应该随着服务走
  // 节点端不预加载这些参数，避免服务未启动时配置无意义
  
  // 使用任务中的参数，或让服务使用自己的默认值
  ...(task.beam_size !== undefined ? { beam_size: task.beam_size } : {}),
}
```

#### 3. 服务端使用自己的配置

**文件**: `electron_node/services/faster_whisper_vad/config.py`

```python
BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "2"))  # 服务自己的默认值
TEMPERATURE = float(os.getenv("ASR_TEMPERATURE", "0.0"))
# ...
```

**文件**: `electron_node/services/faster_whisper_vad/api_models.py`

```python
class UtteranceRequest(BaseModel):
    beam_size: int = BEAM_SIZE  # 从配置文件读取，如果请求中没有传递则使用默认值
    # ...
```

## 参数传递策略

### 优先级

1. **任务中指定的参数**（如果任务明确指定了参数，使用任务中的值）
2. **服务端默认值**（如果任务中没有指定，不传递参数，让服务使用自己的默认值）

### 实现方式

```typescript
// 如果任务中指定了beam_size，使用任务中的值；否则不传递，让服务使用自己的默认值
...(task.beam_size !== undefined ? { beam_size: task.beam_size } : {}),
```

这样：
- 如果任务中指定了参数，会传递给服务
- 如果任务中没有指定，不传递参数，服务使用自己的默认值
- 节点端不需要预加载配置

## 优势

1. **支持服务热插拔**：
   - 服务可以动态启动/停止
   - 节点端不需要预先知道服务是否存在
   - 服务参数由服务自己管理

2. **避免配置分散**：
   - 服务参数集中在服务自己的配置文件中
   - 节点端只管理节点级别的配置

3. **避免节点端与服务强制绑定**：
   - 节点端不需要知道服务的具体参数
   - 服务可以独立修改参数，不需要修改节点端

4. **避免预加载无效配置**：
   - 节点端不预加载服务参数
   - 避免服务未启动时配置无意义

## 影响范围

### 修改的文件

1. `electron_node/electron-node/main/src/node-config.ts`
   - 移除`ASRConfig`接口
   - 移除`NodeConfig.asr`字段
   - 移除`DEFAULT_CONFIG.asr`

2. `electron_node/electron-node/main/src/task-router/task-router-asr.ts`
   - 移除`asrConfig`字段
   - 移除`loadASRConfig()`方法
   - 移除`getASRConfig()`方法
   - 修改参数传递逻辑

### 不受影响的部分

1. **服务端配置**：
   - `config.py`中的配置仍然有效
   - 服务仍然使用自己的默认值

2. **任务参数**：
   - 如果任务中指定了参数，仍然会传递给服务
   - 只是不再从节点配置中读取默认值

## 迁移指南

### 对于开发者

1. **修改ASR参数**：
   - 修改`electron_node/services/faster_whisper_vad/config.py`
   - 或设置环境变量`ASR_BEAM_SIZE`等
   - 不需要修改节点端配置

2. **在任务中指定参数**：
   - 如果需要在特定任务中使用不同的参数，可以在任务中指定
   - 节点端会传递这些参数给服务

### 对于用户

1. **配置ASR参数**：
   - 修改`electron_node/services/faster_whisper_vad/config.py`
   - 或设置环境变量
   - 不再需要在`electron-node-config.json`中配置

2. **重启服务**：
   - 修改服务配置后，需要重启服务才能生效
   - 这是预期的行为（参数应该固定，不支持运行时调整）

## 总结

这次重构实现了：
- ✅ 支持服务热插拔
- ✅ 服务参数随服务走
- ✅ 避免节点端与服务强制绑定
- ✅ 避免预加载无效配置

符合微服务架构的设计理念，提高了系统的灵活性和可维护性。
