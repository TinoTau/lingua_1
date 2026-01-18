# 启动后高CPU占用问题修复

## 问题描述

语义修复服务（semantic-repair-zh 和 semantic-repair-en）启动后CPU占用仍然很高（约50-100%），这是不正常的。

## 问题分析

### 可能的原因

1. **PyTorch CUDA kernels编译**
   - 首次运行时，PyTorch需要编译CUDA kernels
   - 这个过程可能持续几分钟，CPU占用会很高
   - 编译完成后，CPU占用应该恢复正常

2. **uvicorn多进程/多线程**
   - 默认情况下，uvicorn可能使用多进程
   - 每个进程都会加载模型，导致CPU占用高

3. **模型未完全初始化**
   - 模型加载后可能还在进行某些初始化操作
   - 需要确保模型处于评估模式

4. **后台任务**
   - 可能有后台任务在运行
   - 需要检查是否有轮询或定时任务

## 已实施的修复

### 1. 优化uvicorn配置
- 设置 `workers=1`：单进程运行，避免多进程导致的高CPU占用
- 设置 `loop="asyncio"`：使用asyncio事件循环

### 2. 确保模型处于评估模式
- 在启动完成后，显式调用 `model.eval()`
- 这会禁用梯度计算，减少CPU占用

### 3. 清理GPU缓存
- 调用 `torch.cuda.empty_cache()` 清理GPU缓存
- 调用 `torch.cuda.synchronize()` 等待所有CUDA操作完成

### 4. 添加警告信息
- 如果CPU占用仍然高，提示可能是PyTorch在编译CUDA kernels（首次运行）

## 验证方法

1. **检查CPU占用**
   ```bash
   python check_cpu_usage.py
   ```

2. **等待几分钟**
   - 如果是首次运行，PyTorch可能需要编译CUDA kernels
   - 编译完成后，CPU占用应该恢复正常

3. **检查服务日志**
   - 查看是否有错误或警告信息
   - 确认服务是否完全启动

## 预期行为

- **首次启动**：CPU占用可能较高（50-100%），持续1-5分钟（PyTorch编译CUDA kernels）
- **后续启动**：CPU占用应该很快恢复正常（<5%）
- **运行中**：CPU占用应该很低（<5%），除非在处理请求

## 如果问题仍然存在

如果修复后CPU占用仍然很高，可能需要：

1. **检查是否有其他进程在竞争CPU**
   - 使用 `check_cpu_usage.py` 检查所有Python进程

2. **检查PyTorch版本**
   - 某些版本的PyTorch可能有性能问题
   - 建议使用稳定版本

3. **检查系统资源**
   - 确保有足够的CPU和内存
   - 检查是否有其他程序占用资源

4. **重启服务**
   - 有时重启可以解决临时问题
