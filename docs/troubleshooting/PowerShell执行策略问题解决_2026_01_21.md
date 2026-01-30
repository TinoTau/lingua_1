# PowerShell执行策略问题解决

**日期**: 2026-01-21  
**问题**: 无法运行PowerShell脚本（数字签名错误）  
**状态**: ✅ **提供多种解决方案**

---

## 🔴 错误信息

```
无法加载文件 D:\Programs\github\lingua_1\expired\lingua_1-main\scripts\start_scheduler.ps1。
未对文件进行数字签名。无法在当前系统上运行该脚本。
PSSecurityException
```

---

## ✅ 解决方案（推荐）

### 方案1: 永久修改执行策略（仅当前用户）

**执行一次即可**:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**然后就可以正常运行脚本了**:
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main
.\scripts\start_scheduler.ps1
```

**优点**:
- ✅ 一劳永逸
- ✅ 只影响当前用户
- ✅ 不需要管理员权限

---

### 方案2: 临时绕过执行策略（每次使用）

**每次启动时使用**:

```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main
powershell -ExecutionPolicy Bypass -File .\scripts\start_scheduler.ps1
```

**优点**:
- ✅ 不修改系统设置
- ✅ 更安全

**缺点**:
- ⚠️ 每次都要输入完整命令

---

### 方案3: 直接运行命令（不使用脚本）

**调度服务器**:
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main\central_server\scheduler
cargo run --release
```

**节点端**:
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main\electron_node\electron-node
npm start
```

**Web端**:
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main\webapp\web-client
npm run dev
```

**优点**:
- ✅ 完全绕过脚本限制
- ✅ 最简单直接

---

## 🚀 立即解决

### 推荐：使用方案1

**步骤1: 修改执行策略**

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**确认提示时输入**: `Y` (是)

---

**步骤2: 启动三端服务**

```powershell
# 终端1
cd D:\Programs\github\lingua_1\expired\lingua_1-main
.\scripts\start_scheduler.ps1

# 终端2
cd D:\Programs\github\lingua_1\expired\lingua_1-main
.\scripts\start_electron_node.ps1

# 终端3
cd D:\Programs\github\lingua_1\expired\lingua_1-main
.\scripts\start_webapp.ps1
```

---

## 📋 或者：使用方案3（更简单）

**不修改任何设置，直接运行命令**:

### 终端1: 调度服务器
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main\central_server\scheduler
cargo run --release
```

### 终端2: 节点端
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main\electron_node\electron-node
npm start
```

### 终端3: Web端
```powershell
cd D:\Programs\github\lingua_1\expired\lingua_1-main\webapp\web-client
npm run dev
```

---

## ⚠️ 安全说明

### 关于执行策略

**RemoteSigned** 是什么？
- ✅ 本地脚本可以运行（无需签名）
- ✅ 从互联网下载的脚本需要签名
- ✅ 这是推荐的开发环境设置

**Bypass** 是什么？
- ⚠️ 临时绕过所有限制
- ⚠️ 仅对当前命令有效
- ✅ 不修改系统设置

---

## ✅ 总结

| 方案 | 优点 | 使用场景 |
|------|------|----------|
| **方案1: RemoteSigned** | 一劳永逸 | **推荐：长期使用** |
| **方案2: Bypass** | 不修改设置 | 偶尔使用 |
| **方案3: 直接命令** | 最简单 | **推荐：快速启动** |

---

**建议**: 如果经常使用，执行方案1一次即可。如果只是临时测试，直接使用方案3。
