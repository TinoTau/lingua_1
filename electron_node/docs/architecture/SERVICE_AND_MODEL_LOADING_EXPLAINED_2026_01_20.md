# 服务发现和模型加载机制说明 - 2026-01-20

## 🔍 问题根因

### 您的情况

**模型确实存在**，但是在**HuggingFace缓存格式**的目录中：
```
✅ 模型实际位置：
D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\
  └── models--Systran--faster-whisper-large-v3\  （HuggingFace缓存格式）
      └── snapshots\
          └── [hash]\
              ├── model.bin        ← 模型文件在这里
              ├── config.json
              └── vocabulary.json

❌ 期望的位置（但目录为空）：
D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\
  └── faster-whisper-large-v3\     （空目录！）
```

### 为什么会这样？

**集成测试使用了HuggingFace自动下载模式**：
```python
# 集成测试时，config.py 这样工作：
ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"  # HuggingFace标识符
WHISPER_CACHE_DIR = "models/asr"  # 缓存目录

# Faster Whisper 自动下载模型到 HuggingFace 标准格式：
# models/asr/models--Systran--faster-whisper-large-v3/snapshots/xxx/
```

### 当前问题

**config.py 的逻辑**：
```python
_local_model_path = "models/asr/faster-whisper-large-v3"

if os.path.exists(_local_model_path) and os.path.isdir(_local_model_path):
    # ❌ 目录存在但为空，使用本地路径 → 找不到 model.bin
    ASR_MODEL_PATH = _local_model_path
else:
    # ✅ 应该走这个分支，使用 HuggingFace 标识符
    ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"
```

**问题**：空目录导致 config.py 误判，尝试从空目录加载模型！

---

## 📋 完整的服务发现和启动流程

### Step 1: 服务发现（ServiceDiscovery）

**位置**: `main/src/service-layer/ServiceDiscovery.ts`

**流程**:
```typescript
// 1. 扫描 services 目录
scanServices("D:/Programs/github/lingua_1/electron_node/services")

// 2. 对每个子目录：
for (serviceDir of serviceDirs) {
  // 3. 读取 service.json
  const serviceJson = readFile(`${serviceDir}/service.json`)
  
  // 4. 解析服务定义
  const def: ServiceDefinition = {
    id: "faster-whisper-vad",
    name: "Faster Whisper VAD",
    type: "asr",
    exec: {
      command: "python",
      args: ["faster_whisper_vad_service.py"],
      cwd: "."  // 相对路径
    }
  }
  
  // 5. 转换相对路径为绝对路径
  def.exec.cwd = path.join(serviceDir, def.exec.cwd)
  // 结果: D:/Programs/github/lingua_1/electron_node/services/faster_whisper_vad
  
  // 6. 注册到 ServiceRegistry
  registry.set(def.id, {
    def: def,
    runtime: { status: 'stopped' },
    installPath: serviceDir
  })
}
```

**关键点**：
- ✅ 服务发现**只读取 service.json**
- ✅ 不关心模型文件在哪里
- ✅ 只关心如何启动服务进程（command + args + cwd）

---

### Step 2: 服务启动（ServiceProcessRunner）

**位置**: `main/src/service-layer/ServiceProcessRunner.ts`

**流程**:
```typescript
async startService(serviceId: string) {
  // 1. 从 Registry 获取服务信息
  const entry = registry.get(serviceId)
  
  // 2. 提取启动参数
  const { command, args } = entry.def.exec
  const workingDir = entry.def.exec.cwd || entry.installPath
  
  // 3. spawn 子进程
  const proc = spawn(command, args, {
    cwd: workingDir,  // D:/Programs/github/lingua_1/electron_node/services/faster_whisper_vad
    env: { ...process.env }
  })
  
  // 4. 监听进程输出
  proc.stdout.on('data', ...)
  proc.stderr.on('data', ...)
  proc.on('exit', ...)
}
```

**关键点**：
- ✅ 只负责启动进程
- ✅ 不关心进程内部做什么
- ✅ 环境变量继承自 Electron 主进程

---

### Step 3: 服务内部模型加载（Python服务）

**位置**: `services/faster_whisper_vad/config.py` + `models.py`

**流程**:
```python
# config.py
_local_model_path = "models/asr/faster-whisper-large-v3"

if os.path.exists(_local_model_path) and os.path.isdir(_local_model_path):
    # ❌ 当前走这里（因为空目录存在）
    ASR_MODEL_PATH = _local_model_path  
    # 结果：尝试从空目录加载 → 失败
else:
    # ✅ 应该走这里
    ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"
    # 结果：Faster Whisper 自动从 HuggingFace 缓存加载

# models.py
asr_model = WhisperModel(
    ASR_MODEL_PATH,  # ❌ 当前传入空目录路径
    device="cuda",
    compute_type="float16",
    download_root=WHISPER_CACHE_DIR  # models/asr
)
```

**关键点**：
- ⚠️ **模型加载是服务内部的逻辑**
- ⚠️ Electron **不知道也不关心**模型在哪里
- ⚠️ 完全由 Python 服务的 config.py 决定

---

## ✅ 解决方案（3种）

### 方案1：删除空目录（推荐，最简单）

```powershell
# 删除空的 faster-whisper-large-v3 目录
Remove-Item "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3" -Recurse -Force

# 重启 Electron
# config.py 会自动使用 HuggingFace 标识符，从缓存加载模型
```

**原理**：
```python
# 删除后，config.py 会走 else 分支：
if os.path.exists(_local_model_path):  # False（目录不存在了）
    ...
else:
    ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"  # ✅ 使用 HuggingFace 标识符
    # Faster Whisper 会自动在缓存中查找：
    # models/asr/models--Systran--faster-whisper-large-v3/snapshots/xxx/
```

**优点**：
- ✅ 不需要修改任何代码
- ✅ 利用现有的 HuggingFace 缓存
- ✅ 与集成测试保持一致

---

### 方案2：使用环境变量（推荐，灵活）

**不删除任何文件**，在启动 Electron 前设置环境变量：

```powershell
# 方法A：临时设置（当前 PowerShell 会话）
$env:ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"
npm start

# 方法B：永久设置（系统环境变量）
[System.Environment]::SetEnvironmentVariable("ASR_MODEL_PATH", "Systran/faster-whisper-large-v3", "User")
# 然后重启 PowerShell 和 Electron
```

**原理**：
```python
# config.py 会优先使用环境变量：
ASR_MODEL_PATH = os.getenv("ASR_MODEL_PATH", _local_model_path)
# 如果设置了 ASR_MODEL_PATH，直接使用
# Faster Whisper 会自动从缓存加载
```

**优点**：
- ✅ 不需要删除文件
- ✅ 可以灵活切换不同模型
- ✅ 可以在启动脚本中配置

---

### 方案3：修复目录结构（最彻底，但复杂）

**复制模型文件到期望的目录**：

```powershell
# 1. 找到 HuggingFace 缓存中的实际模型目录
$cacheDir = Get-ChildItem "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\models--Systran--faster-whisper-large-v3\snapshots" -Directory | Select-Object -First 1

# 2. 复制到 faster-whisper-large-v3 目录
Copy-Item -Path "$($cacheDir.FullName)\*" -Destination "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3\" -Recurse -Force

# 3. 重启 Electron
```

**原理**：
```python
# config.py 会使用本地路径：
if os.path.exists(_local_model_path):  # True（目录存在且有文件）
    ASR_MODEL_PATH = _local_model_path  # ✅ 直接从本地加载
```

**缺点**：
- ⚠️ 占用额外磁盘空间（模型重复存储）
- ⚠️ 需要手动同步更新

---

## 🎯 推荐方案

### 开发环境（您当前情况）

**推荐：方案1（删除空目录）**

```powershell
Remove-Item "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3" -Recurse -Force
```

**理由**：
- ✅ 最简单，一行命令
- ✅ 利用现有缓存，不浪费空间
- ✅ 与集成测试配置一致

---

### 生产环境

**推荐：方案3（复制模型）+ 打包**

**理由**：
- ✅ 启动更快（不需要查找缓存）
- ✅ 不依赖 HuggingFace 缓存机制
- ✅ 更可控

---

## 📝 为什么 Electron 不需要知道模型路径？

### 架构设计

```
┌─────────────────────────────────────────────┐
│ Electron Main Process                       │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ ServiceDiscovery                     │  │
│  │ - 扫描 service.json                  │  │
│  │ - 注册服务定义                       │  │
│  └──────────────────────────────────────┘  │
│                 ↓                           │
│  ┌──────────────────────────────────────┐  │
│  │ ServiceProcessRunner                 │  │
│  │ - spawn(python, [script.py], {cwd}) │  │
│  │ - 只关心如何启动进程                 │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
                 ↓ spawn
┌─────────────────────────────────────────────┐
│ Python Service Process                      │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ config.py                            │  │
│  │ - 决定模型路径                       │  │
│  │ - 处理环境变量                       │  │
│  └──────────────────────────────────────┘  │
│                 ↓                           │
│  ┌──────────────────────────────────────┐  │
│  │ models.py                            │  │
│  │ - 加载模型                           │  │
│  │ - 提供推理服务                       │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**关键原则**：
- ✅ **关注点分离**：Electron 管进程，Python 管模型
- ✅ **松耦合**：服务可以独立配置和测试
- ✅ **灵活性**：可以通过环境变量动态配置

---

## 🔄 与集成测试的对比

### 集成测试配置

```python
# 集成测试时（可能的配置）
os.environ["ASR_MODEL_PATH"] = "Systran/faster-whisper-large-v3"
os.environ["WHISPER_CACHE_DIR"] = "models/asr"

# 结果：
# 1. Faster Whisper 自动从 HuggingFace 下载/加载
# 2. 缓存到 models/asr/models--Systran--faster-whisper-large-v3/
# 3. 工作正常 ✅
```

### 当前 Electron 配置

```python
# 当前情况
# 无环境变量设置
# config.py 自动检测：
#   - 发现 faster-whisper-large-v3 目录存在（但为空）
#   - 使用本地路径 → 找不到 model.bin ❌
```

### 修复后

```python
# 方案1（删除空目录）或方案2（环境变量）后：
# config.py 自动使用 HuggingFace 标识符
# Faster Whisper 从缓存加载
# 工作正常 ✅
```

---

## ✅ 立即执行（推荐方案1）

```powershell
# 1. 删除空目录
Remove-Item "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3" -Recurse -Force

# 2. 重启 Electron（如果正在运行）
taskkill /F /IM electron.exe

# 3. 启动 Electron
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm start

# 4. 在 UI 中点击"启动服务"
# ✅ 应该能成功启动！
```

---

## 🎉 总结

### 问题根因
- ❌ 空的 `faster-whisper-large-v3` 目录误导了 config.py
- ✅ 模型实际在 HuggingFace 缓存中，完全正常

### 解决方案
- ✅ 删除空目录（推荐）
- ✅ 或使用环境变量

### Electron 的角色
- ✅ 只负责启动 Python 进程
- ✅ 不管理模型路径
- ✅ 完全由服务内部 config.py 决定

### 不需要调整
- ✅ service.json 不需要改
- ✅ ServiceDiscovery 不需要改
- ✅ ServiceProcessRunner 不需要改
- ✅ 只需要删除一个空目录！

---

**执行时间**: 10 秒
**复杂度**: 非常简单
**风险**: 无（只删除空目录）
