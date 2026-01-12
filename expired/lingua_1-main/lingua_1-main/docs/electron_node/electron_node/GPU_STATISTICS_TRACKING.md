# GPU 使用时间统计功能文档

## 概述

本文档描述了服务管理器中 GPU 使用时间统计功能的实现逻辑、修复的问题以及使用方式。

**文档日期**: 2025-12-17  
**最后更新**: 2025-12-17

## 功能说明

GPU 使用时间统计功能用于跟踪每个服务在任务执行期间实际使用 GPU 的时间，帮助用户了解资源使用情况。

### 统计数据

每个服务维护以下统计数据：
- **任务计数** (`taskCount`): 服务处理的任务总数
- **GPU 使用时长** (`gpuUsageMs`): GPU 累计使用时间（毫秒）

## 设计原则

1. **只在有任务时统计**: GPU 使用时间只在服务处理实际任务时才统计
2. **任务执行期间统计**: GPU 跟踪在任务开始时启动，任务结束时停止
3. **独立统计**: 每个服务（nmt、tts、yourtts、rust）都有独立的统计数据和跟踪器
4. **基于实际使用**: 只在 GPU 实际被使用（使用率 > 0）时累计时间
5. **会话级别**: 统计数据从 Electron 启动时开始累积，关闭后清零

## 实现架构

### 1. GPU 跟踪器 (`utils/gpu-tracker.ts`)

`GpuUsageTracker` 类负责跟踪 GPU 使用时间：

```typescript
class GpuUsageTracker {
  private gpuUsageMs: number = 0;              // 累计的GPU使用时间（毫秒）
  private gpuUsageStartTime: number | null;    // 当前GPU使用时段的开始时间
  private isGpuInUse: boolean = false;         // 当前是否正在使用GPU
  private gpuCheckInterval: NodeJS.Timeout;    // 定期检查GPU使用率的定时器
}
```

#### 工作原理

1. **开始跟踪** (`startTracking()`)
   - 每 500ms 检查一次 GPU 使用率（通过 `pynvml`）
   - 检测 GPU 使用状态变化

2. **状态转换累计**
   - **非使用 → 使用**: 记录开始时间
   - **使用 → 非使用**: 累计这段时间到 `gpuUsageMs`

3. **停止跟踪** (`stopTracking()`)
   - 停止定期检查
   - 如果 GPU 还在使用中，累计最后一次使用时间

4. **获取累计时间** (`getGpuUsageMs()`)
   - 如果 GPU 正在使用，返回 `累计值 + 当前使用时段时间`
   - 如果 GPU 未使用，返回累计值
   - 确保返回值单调递增，不会时高时低

### 2. Rust 服务管理器

#### GPU 跟踪控制

```typescript
// 在 index.ts 中设置回调
inferenceService.setOnTaskStartCallback(() => {
  rustServiceManager.startGpuTracking();  // 任务开始时启动跟踪
});

inferenceService.setOnTaskEndCallback(() => {
  rustServiceManager.stopGpuTracking();   // 任务结束时停止跟踪
});
```

#### 特点

- 使用任务开始/结束回调精确控制 GPU 跟踪
- 只在任务执行期间进行跟踪
- 所有任务结束后停止跟踪

### 3. Python 服务管理器

#### GPU 跟踪控制

每个服务（nmt、tts、yourtts）都有独立的跟踪器：

```typescript
private gpuTrackers: Map<string, GpuUsageTracker> = new Map();
private taskCounts: Map<string, number> = new Map();
```

#### 特点

- 每个服务有独立的 `GpuUsageTracker` 实例
- 第一个任务完成后启动 GPU 跟踪
- 没有任务时显示 GPU 使用时间为 0
- 服务停止时重置统计数据

## 问题修复历史

### 问题 1: 服务启动时就开始跟踪

**问题描述**:
- 服务启动时立即开始 GPU 跟踪，即使没有任务

**修复方案**:
- Rust 服务：改为在任务开始时启动跟踪
- Python 服务：改为在第一个任务完成后启动跟踪（因为 `incrementTaskCount` 在任务完成后调用）

### 问题 2: 持续累计所有 GPU 使用时间

**问题描述**:
- 一旦开始跟踪，会持续累计所有 GPU 使用时间，即使没有新任务也在累计

**修复方案**:
- Rust 服务：使用任务开始/结束回调，只在任务执行期间跟踪
- Python 服务：虽然跟踪器持续运行，但只在 GPU 实际使用（usage > 0）时累计时间

### 问题 3: GPU 使用时间显示时高时低

**问题描述**:
- `getGpuUsageMs()` 返回值不准确，当 GPU 使用率变为 0 时值会变小

**修复方案**:
- 改进 `GpuUsageTracker` 的状态管理逻辑
- 使用 `isGpuInUse` 标志跟踪 GPU 使用状态
- 只在状态转换时累计时间，而不是每次都重置开始时间
- 确保返回值单调递增

## 统计独立性

每个服务都有完全独立的统计数据：

### Python 服务

```typescript
// 每个服务都有独立的实例
taskCounts: Map<'nmt' | 'tts' | 'yourtts', number>
gpuTrackers: Map<'nmt' | 'tts' | 'yourtts', GpuUsageTracker>
statuses: Map<'nmt' | 'tts' | 'yourtts', PythonServiceStatus>
```

- **nmt 服务**: 独立的任务计数和 GPU 跟踪器
- **tts 服务**: 独立的任务计数和 GPU 跟踪器
- **yourtts 服务**: 独立的任务计数和 GPU 跟踪器

### Rust 服务

```typescript
taskCount: number
gpuTracker: GpuUsageTracker
```

- **rust 服务**: 独立的任务计数和 GPU 跟踪器

## 数据生命周期

### 启动阶段

1. Electron 启动
2. 服务管理器初始化
3. 统计数据初始化为 0

### 运行阶段

1. 服务启动（不开始 GPU 跟踪）
2. 第一个任务开始/完成
   - Rust 服务：任务开始时启动 GPU 跟踪
   - Python 服务：任务完成后启动 GPU 跟踪
3. 任务执行期间
   - 定期检查 GPU 使用率
   - 只在 GPU 实际使用时累计时间
4. 所有任务结束
   - Rust 服务：停止 GPU 跟踪
   - Python 服务：继续跟踪（但不累计，除非 GPU 在使用）

### 停止阶段

1. 服务停止时
   - 停止 GPU 跟踪
   - 重置 GPU 跟踪器
   - 重置任务计数
   - 重置状态中的统计数据

2. Electron 关闭
   - 所有统计数据清零（进程退出）

## 关键代码位置

### GPU 跟踪器

- **文件**: `electron-node/main/src/utils/gpu-tracker.ts`
- **类**: `GpuUsageTracker`
- **方法**:
  - `startTracking()`: 开始跟踪 GPU 使用
  - `stopTracking()`: 停止跟踪并累计最后时段
  - `getGpuUsageMs()`: 获取累计使用时间
  - `reset()`: 重置统计数据

### Rust 服务管理器

- **文件**: `electron-node/main/src/rust-service-manager/index.ts`
- **回调设置**: `electron-node/main/src/index.ts`
  - `setOnTaskStartCallback()`: 任务开始时启动 GPU 跟踪
  - `setOnTaskEndCallback()`: 任务结束时停止 GPU 跟踪

### Python 服务管理器

- **文件**: `electron-node/main/src/python-service-manager/index.ts`
- **跟踪控制**: 
  - `incrementTaskCount()`: 第一个任务完成后启动跟踪
  - `startGpuTracking()`: 启动指定服务的 GPU 跟踪
  - `stopGpuTracking()`: 停止指定服务的 GPU 跟踪

### 推理服务

- **文件**: `electron-node/main/src/inference/inference-service.ts`
- **任务跟踪**:
  - `processJob()`: 任务开始时触发 `onTaskStartCallback`
  - `processJob()` finally 块: 任务结束时触发 `onTaskEndCallback`

## 注意事项

### GPU 使用率检测

- 使用 `pynvml` Python 库检测 GPU 使用率
- 检测间隔：500ms
- 如果检测失败，保守处理，避免重复累计

### 并发任务

- 多个任务可能同时执行
- GPU 跟踪器会持续跟踪，直到所有任务完成
- 每个服务的统计是独立的

### 全局 GPU 使用率

- GPU 使用率检测是基于全局 GPU 的（通过 `pynvml`）
- 如果多个服务或进程同时使用 GPU，它们的统计时间可能会有重叠
- 但每个服务仍然维护独立的累计值

### 显示逻辑

- 没有任务（taskCount === 0）时，GPU 使用时间显示为 0
- 有任务时，显示实际的累计使用时间

## 相关文档

- **服务管理器重构**: `SERVICE_MANAGER_REFACTORING.md`
- **服务热插拔验证**: `../SERVICE_HOT_PLUG_VERIFICATION.md`

