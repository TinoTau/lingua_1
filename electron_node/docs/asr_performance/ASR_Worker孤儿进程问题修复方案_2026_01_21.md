# ASR Worker 孤儿进程问题分析与修复方案

**日期**: 2026-01-21 01:10  
**问题**: ASR Worker子进程在节点端关闭后继续运行  
**严重程度**: 🔴 **严重** - 导致资源泄漏和性能问题

---

## 🔍 问题分析

### 进程结构

```
Electron Node (节点端主进程)
    ↓ spawn
Python Service (faster_whisper_vad_service.py)
    ↓ multiprocessing.Process
ASR Worker (asr_worker_process.py)  ← 子进程，孤儿进程
```

### 问题根因

#### 1. **FastAPI shutdown事件可能不被触发**

**代码位置**: `api_routes.py`第109-123行

```python
async def shutdown():
    """停止ASR Worker Manager"""
    try:
        logger.info("=" * 80)
        logger.info("🛑 Shutting down Faster Whisper + Silero VAD Service")
        logger.info(f"   Main process PID: {os.getpid()}")
        logger.info("=" * 80)
        
        global _asr_worker_manager
        if _asr_worker_manager:
            await _asr_worker_manager.stop()  # ← 清理子进程
            _asr_worker_manager = None
        logger.info("✅ ASR Worker Manager stopped on shutdown")
    except Exception as e:
        logger.error(f"❌ Error during shutdown: {e}", exc_info=True)
```

**问题**:
- 只有在FastAPI**优雅关闭**时才会触发
- 当节点端强制kill Python主进程时，shutdown事件**不会触发**
- ASR Worker子进程变成孤儿进程继续运行

---

#### 2. **信号处理器只记录日志，不清理子进程**

**代码位置**: `faster_whisper_vad_service.py`第53-66行

```python
def signal_handler(signum, frame):
    """信号处理器"""
    logger.warning(f"Received signal {signum}, preparing to shutdown...")
    if signum == signal.SIGTERM:
        logger.info("SIGTERM received, graceful shutdown")
    elif signum == signal.SIGINT:
        logger.info("SIGINT received (Ctrl+C), graceful shutdown")
    else:
        logger.warning(f"Unexpected signal {signum} received")

# 注册信号处理器
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (AttributeError, ValueError):
    logger.debug("Some signals not available on this platform")
```

**问题**:
- 信号处理器**只打印日志**，没有实际清理子进程
- 没有调用`_asr_worker_manager.stop()`

---

#### 3. **节点端的进程停止逻辑**

**代码位置**: `electron_node/electron-node/main/src/python-service-manager/service-process.ts`

节点端停止Python服务的方式：

```typescript
// 1. 发送 SIGTERM
child.kill('SIGTERM');

// 2. 等待10秒

// 3. 如果还没退出，SIGKILL强制杀死
child.kill('SIGKILL');
```

**问题**:
- Windows上SIGTERM可能不可靠
- SIGKILL会立即杀死主进程，不给它清理子进程的机会
- 子进程（ASR Worker）变成孤儿进程

---

## 🎯 修复方案

### 方案1: 修改信号处理器，主动清理子进程（推荐）

**修改文件**: `faster_whisper_vad_service.py`

```python
import asyncio
import sys
import signal
import logging

logger = logging.getLogger(__name__)

# 全局变量，用于在信号处理中访问
_shutdown_initiated = False

def signal_handler(signum, frame):
    """信号处理器 - 优雅关闭"""
    global _shutdown_initiated
    
    if _shutdown_initiated:
        logger.warning(f"Signal {signum} received again, forcing immediate exit...")
        sys.exit(1)
    
    _shutdown_initiated = True
    
    logger.warning(f"Received signal {signum}, initiating graceful shutdown...")
    
    # 立即停止ASR Worker Manager
    try:
        from api_routes import get_asr_worker_manager
        manager = get_asr_worker_manager()
        
        # 创建新的事件循环来运行async的stop()
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(manager.stop())
        loop.close()
        
        logger.info("✅ ASR Worker Manager stopped successfully")
    except Exception as e:
        logger.error(f"❌ Failed to stop ASR Worker Manager: {e}", exc_info=True)
    
    # 退出主进程
    logger.info("Exiting main process...")
    sys.exit(0)

# 注册信号处理器
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# Windows特殊处理：SIGBREAK
if hasattr(signal, 'SIGBREAK'):
    signal.signal(signal.SIGBREAK, signal_handler)
```

**优点**:
- ✅ 主动清理子进程
- ✅ 在主进程被kill前完成清理
- ✅ 适用于SIGTERM、SIGINT等信号

**缺点**:
- ⚠️ 对SIGKILL无效（无法捕获）
- ⚠️ 需要在信号处理器中运行async代码

---

### 方案2: 使用atexit注册清理函数

**修改文件**: `faster_whisper_vad_service.py`

```python
import atexit
import asyncio

def cleanup_on_exit():
    """退出时清理ASR Worker"""
    try:
        from api_routes import get_asr_worker_manager
        manager = get_asr_worker_manager()
        
        # 创建新的事件循环
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(manager.stop())
        loop.close()
        
        logger.info("✅ Cleanup on exit completed")
    except Exception as e:
        logger.error(f"❌ Cleanup on exit failed: {e}", exc_info=True)

# 注册退出清理函数
atexit.register(cleanup_on_exit)
```

**优点**:
- ✅ Python解释器退出时自动调用
- ✅ 简单直接

**缺点**:
- ⚠️ 对SIGKILL无效
- ⚠️ 在某些异常退出场景下可能不被调用

---

### 方案3: 在Worker进程中设置daemon=True（不推荐）

```python
self.worker_process = mp.Process(
    target=asr_worker_process,
    args=(self.task_queue, self.result_queue),
    name="ASRWorkerProcess",
    daemon=True  # ← 设置为守护进程
)
```

**优点**:
- ✅ 父进程退出时，子进程自动被kill

**缺点**:
- ❌ 子进程可能在处理任务中被突然kill
- ❌ 没有优雅关闭的机会
- ❌ 可能导致数据丢失或GPU状态泄漏

---

### 方案4: 组合方案（最佳）

**同时使用方案1 + 方案2**:

1. **信号处理器**: 处理SIGTERM/SIGINT
2. **atexit**: 处理其他异常退出场景

```python
import signal
import atexit
import asyncio
import sys

_shutdown_initiated = False

def cleanup_worker_manager():
    """清理ASR Worker Manager的通用函数"""
    global _shutdown_initiated
    
    if _shutdown_initiated:
        return
    
    _shutdown_initiated = True
    
    try:
        from api_routes import get_asr_worker_manager
        manager = get_asr_worker_manager()
        
        # 创建新的事件循环
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(manager.stop())
        loop.close()
        
        logger.info("✅ ASR Worker Manager stopped successfully")
    except Exception as e:
        logger.error(f"❌ Failed to stop ASR Worker Manager: {e}", exc_info=True)

def signal_handler(signum, frame):
    """信号处理器"""
    logger.warning(f"Received signal {signum}, initiating shutdown...")
    cleanup_worker_manager()
    sys.exit(0)

def atexit_handler():
    """退出时清理"""
    logger.info("atexit handler called, cleaning up...")
    cleanup_worker_manager()

# 注册信号处理器
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)
if hasattr(signal, 'SIGBREAK'):
    signal.signal(signal.SIGBREAK, signal_handler)

# 注册退出清理函数
atexit.register(atexit_handler)
```

**优点**:
- ✅ 多层保护，覆盖更多退出场景
- ✅ 信号处理 + atexit双重保障
- ✅ 优雅关闭，避免资源泄漏

---

## 🔧 推荐实施步骤

### 步骤1: 修改`faster_whisper_vad_service.py`（5分钟）

在文件开头（导入后、创建app前）添加清理逻辑：

```python
# ... imports ...

# 清理逻辑
_shutdown_initiated = False

def cleanup_worker_manager():
    """清理ASR Worker Manager"""
    global _shutdown_initiated
    
    if _shutdown_initiated:
        return
    
    _shutdown_initiated = True
    
    logger.info("🛑 Cleaning up ASR Worker Manager...")
    
    try:
        from api_routes import get_asr_worker_manager
        manager = get_asr_worker_manager()
        
        # 同步运行async的stop()
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(manager.stop())
        loop.close()
        
        logger.info("✅ ASR Worker Manager cleaned up successfully")
    except Exception as e:
        logger.error(f"❌ Failed to cleanup ASR Worker Manager: {e}", exc_info=True)

def signal_handler(signum, frame):
    """信号处理器"""
    logger.warning(f"Received signal {signum}, initiating graceful shutdown...")
    cleanup_worker_manager()
    sys.exit(0)

def atexit_handler():
    """退出时清理"""
    logger.info("Python process exiting, cleaning up resources...")
    cleanup_worker_manager()

# 注册信号处理器
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)
if hasattr(signal, 'SIGBREAK'):
    signal.signal(signal.SIGBREAK, signal_handler)

# 注册退出清理函数
atexit.register(atexit_handler)

# ... 继续原有代码 ...
```

---

### 步骤2: 验证修复（10分钟）

1. **启动节点端**
2. **检查进程**:
   ```powershell
   Get-Process python | Select-Object Id,ProcessName,@{Name="Runtime(min)";Expression={(New-TimeSpan -Start $_.StartTime).TotalMinutes}}
   ```
3. **关闭节点端**
4. **再次检查进程**，确认ASR Worker已停止

---

### 步骤3: 对比备份代码（确认一致性）

检查备份代码是否有类似问题：

```bash
# 查看备份代码的信号处理
cat d:\Programs\github\lingua_1\expired\lingua_1-main\electron_node\services\faster_whisper_vad\faster_whisper_vad_service.py
```

如果备份代码也有相同问题，则两者一致，不影响对比。

---

## 🎲 影响评估

### 当前问题的影响

| 影响 | 严重程度 | 说明 |
|------|---------|------|
| **GPU内存泄漏** | 🔴 严重 | Worker占用GPU内存不释放 |
| **性能退化** | 🔴 严重 | 旧Worker可能导致性能问题 |
| **资源浪费** | 🟡 中等 | CPU、内存持续占用 |
| **进程混乱** | 🟡 中等 | 多个Worker同时运行 |

### 修复后的改善

```
修复前:
节点端关闭 → Python主进程被kill → ASR Worker成为孤儿进程 → 继续运行

修复后:
节点端关闭 → Python主进程收到SIGTERM → 清理ASR Worker → Worker停止 → 主进程退出
```

---

## 📋 测试计划

### 测试1: 正常关闭

1. 启动节点端
2. 记录ASR Worker PID
3. 正常关闭节点端
4. 检查ASR Worker是否已停止

**预期**: ✅ Worker已停止

---

### 测试2: 异常退出

1. 启动节点端
2. 记录ASR Worker PID
3. 强制kill节点端主进程
4. 检查ASR Worker是否已停止

**预期**: ✅ Worker已停止（通过atexit）

---

### 测试3: SIGTERM信号

1. 启动节点端
2. 记录Python主进程PID
3. 手动发送SIGTERM: `Stop-Process -Id <PID>`
4. 检查ASR Worker是否已停止

**预期**: ✅ Worker已停止（通过signal handler）

---

## 🔑 关键代码变更总结

### 变更文件

- ✅ `faster_whisper_vad_service.py` - 添加清理逻辑

### 变更内容

1. **添加`cleanup_worker_manager()`函数** - 统一的清理逻辑
2. **修改`signal_handler()`** - 调用清理函数
3. **添加`atexit_handler()`** - 退出时清理
4. **注册信号和atexit** - 多层保护

### 不变内容

- ✅ `api_routes.py` - 保持不变（FastAPI shutdown仍然保留）
- ✅ `asr_worker_manager.py` - 保持不变
- ✅ `asr_worker_process.py` - 保持不变

---

## 🎯 预期效果

修复后：
- ✅ 节点端关闭时，ASR Worker进程正确停止
- ✅ 不会有孤儿进程残留
- ✅ GPU内存正确释放
- ✅ 避免资源泄漏

---

**状态**: 🔴 待修复  
**优先级**: P0（最高）  
**预计时间**: 15分钟（修改 + 测试）
