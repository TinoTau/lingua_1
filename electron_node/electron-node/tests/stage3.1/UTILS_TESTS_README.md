# 工具模块单元测试

本文档描述了为新拆分的工具模块创建的单元测试。

## 测试文件

### 1. `utils-port-manager.test.ts`
测试端口管理工具模块 (`utils/port-manager.ts`)

**测试覆盖：**
- ✅ 端口可用性检查 (`checkPortAvailable`)
- ✅ 端口释放验证 (`verifyPortReleased`)
- ✅ 端口进程查找 (`findPortProcess`)
- ✅ 端口占用信息记录 (`logPortOccupier`)
- ✅ 端口进程清理 (`cleanupPortProcesses`)
- ✅ 集成测试：完整的端口检查流程

**关键测试场景：**
- 检测可用端口
- 检测被占用的端口
- 验证端口释放
- 处理端口超时情况
- 跨平台兼容性（Windows/Unix）

### 2. `utils-gpu-tracker.test.ts`
测试 GPU 跟踪工具模块 (`utils/gpu-tracker.ts`)

**测试覆盖：**
- ✅ GPU 使用率获取 (`getGpuUsage`)
- ✅ GPU 使用时间跟踪器 (`GpuUsageTracker`)
  - 初始化和重置
  - 开始和停止跟踪
  - 防止重复启动
  - 累计时间计算
  - 多次启动/停止场景

**关键测试场景：**
- 跟踪器状态管理
- 时间累计逻辑
- 处理 GPU 不可用的情况
- 处理 Python/pynvml 不可用的情况

### 3. `utils-cuda-env.test.ts`
测试 CUDA 环境设置工具模块 (`utils/cuda-env.ts`)

**测试覆盖：**
- ✅ CUDA 环境变量配置 (`setupCudaEnvironment`)
- ✅ PATH 环境变量合并
- ✅ CUDA 路径检测
- ✅ 处理 CUDA 不存在的情况

**关键测试场景：**
- 返回正确的环境变量对象
- 正确设置 CUDA 相关环境变量（如果 CUDA 存在）
- 处理没有 CUDA 的情况（不抛出错误）
- PATH 环境变量正确合并

### 4. `utils-python-service-config.test.ts`
测试 Python 服务配置工具模块 (`utils/python-service-config.ts`)

**测试覆盖：**
- ✅ NMT 服务配置生成
- ✅ TTS 服务配置生成
- ✅ YourTTS 服务配置生成
- ✅ 日志目录创建
- ✅ HF token 文件读取
- ✅ 环境变量配置
- ✅ 虚拟环境路径配置
- ✅ GPU 使用标志配置

**关键测试场景：**
- 为所有三种服务类型生成正确的配置
- 使用环境变量覆盖默认配置
- 创建必要的目录结构
- 读取可选的配置文件（如 HF token）
- 配置完整的服务环境变量

## 运行测试

### 运行所有工具模块测试
```bash
cd electron_node/electron-node/tests/stage3.1
npm test -- utils-
```

### 运行特定测试文件
```bash
# 端口管理测试
npm test -- utils-port-manager.test.ts

# GPU 跟踪测试
npm test -- utils-gpu-tracker.test.ts

# CUDA 环境测试
npm test -- utils-cuda-env.test.ts

# Python 服务配置测试
npm test -- utils-python-service-config.test.ts
```

### 运行所有测试（包括现有测试）
```bash
npm test
```

## 测试覆盖率

这些测试旨在覆盖以下方面：

1. **功能正确性**：确保每个函数按预期工作
2. **边界情况**：处理错误、空值、不存在的情况
3. **跨平台兼容性**：Windows 和 Unix 系统的差异
4. **集成测试**：多个函数协同工作的场景

## 注意事项

### 端口管理测试
- 使用随机端口（20000-30000 范围）避免冲突
- 测试会创建实际的网络服务器来占用端口
- 某些测试可能需要管理员权限（进程终止）

### GPU 跟踪测试
- 测试不要求实际 GPU 存在
- 如果系统没有 GPU 或 pynvml 不可用，相关测试会返回 null（这是预期的）
- 时间跟踪测试使用短时间间隔（100ms）以加快测试速度

### CUDA 环境测试
- 测试不要求实际 CUDA 安装
- 如果系统没有 CUDA，函数应该返回空的环境变量对象（不抛出错误）

### Python 服务配置测试
- 使用临时目录进行测试
- 测试会创建必要的目录结构
- 测试后会自动清理临时文件

## Mock 配置

测试使用以下 mock：
- `__mocks__/logger.ts` - Mock logger 以避免文件系统操作

Jest 配置已更新以支持 logger mock：
```javascript
moduleNameMapper: {
  '^../logger$': '<rootDir>/../../__mocks__/logger.ts',
  '^../../main/src/logger$': '<rootDir>/../../__mocks__/logger.ts',
}
```

## 测试结果示例

运行测试后，你应该看到类似以下的输出：

```
PASS  utils-port-manager.test.ts
  Port Manager
    checkPortAvailable
      ✓ 应该检测到可用端口 (XX ms)
      ✓ 应该检测到被占用的端口 (XX ms)
    verifyPortReleased
      ✓ 应该验证端口已释放 (XX ms)
      ...

PASS  utils-gpu-tracker.test.ts
  GPU Tracker
    GpuUsageTracker
      ✓ 应该正确初始化 (XX ms)
      ✓ 应该开始和停止跟踪 (XX ms)
      ...

PASS  utils-cuda-env.test.ts
  CUDA Environment
    setupCudaEnvironment
      ✓ 应该返回环境变量对象 (XX ms)
      ...

PASS  utils-python-service-config.test.ts
  Python Service Config
    getPythonServiceConfig
      ✓ 应该为 NMT 服务生成配置 (XX ms)
      ✓ 应该为 TTS 服务生成配置 (XX ms)
      ...
```

## 持续集成

这些测试应该集成到 CI/CD 流程中，确保：
1. 代码重构不会破坏现有功能
2. 新功能添加时保持向后兼容
3. 跨平台兼容性得到验证

