# 环境变量配置指南

## CMake 4.2 兼容性环境变量

为了在 CMake 4.2 环境下正常构建 Opus 库，需要设置以下环境变量：

```
CMAKE_POLICY_VERSION_MINIMUM=3.5
```

## 配置方法

### 方法 1: 使用配置脚本（推荐，最简单）

**PowerShell**:
```powershell
cd lingua_1
powershell -ExecutionPolicy Bypass -File scripts\setup_cmake_env.ps1
```

**CMD**:
```cmd
cd lingua_1
scripts\setup_cmake_env.bat
```

脚本会自动：
- ✅ 设置用户级环境变量（永久生效）
- ✅ 设置当前会话环境变量（立即生效）

### 方法 2: 手动设置（系统环境变量）

1. 打开 "系统属性" → "高级" → "环境变量"
2. 在 "用户变量" 或 "系统变量" 中点击 "新建"
3. 变量名: `CMAKE_POLICY_VERSION_MINIMUM`
4. 变量值: `3.5`
5. 确定并重启终端

### 方法 3: 使用 Cargo 配置文件（项目级别）

已在 `electron_node/services/node-inference/.cargo/config.toml` 中配置：

```toml
[env]
CMAKE_POLICY_VERSION_MINIMUM = "3.5"
```

此配置会在使用 `cargo` 命令时自动设置环境变量，**无需手动设置**。

### 方法 4: PowerShell 配置文件（用户级别）

如果 PowerShell 配置文件不存在，创建它：

```powershell
if (!(Test-Path $PROFILE)) {
    New-Item -Path $PROFILE -Type File -Force
}
```

然后添加以下内容到 `$PROFILE`：

```powershell
# CMake 4.2 兼容性设置
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
```

## 验证配置

### 检查用户级环境变量
```powershell
[System.Environment]::GetEnvironmentVariable("CMAKE_POLICY_VERSION_MINIMUM", "User")
```

### 检查当前会话环境变量
```powershell
$env:CMAKE_POLICY_VERSION_MINIMUM
```

### 测试构建
```powershell
cd electron_node/services/node-inference
cargo build
```

如果构建成功，说明环境变量已正确配置。

## 推荐配置

**最佳实践**: 使用 **方法 3（Cargo 配置文件）** + **方法 1（配置脚本）**

- Cargo 配置文件：确保在项目目录下使用 `cargo` 时自动设置
- 用户级环境变量：确保在其他场景下也能使用

## 故障排除

### 问题 1: 环境变量未生效

**解决方案**:
1. 重启终端/PowerShell
2. 检查环境变量是否正确设置
3. 确认使用的是用户级或系统级环境变量

### 问题 2: Cargo 配置文件未生效

**解决方案**:
1. 确认配置文件路径正确：`electron_node/services/node-inference/.cargo/config.toml`
2. 确认文件格式正确（TOML 格式）
3. 在项目目录下运行 `cargo build` 测试

### 问题 3: 多个配置冲突

**优先级**（从高到低）:
1. 当前会话环境变量 (`$env:CMAKE_POLICY_VERSION_MINIMUM`)
2. Cargo 配置文件 (`.cargo/config.toml`)
3. 用户级环境变量
4. 系统级环境变量

## 快速检查清单

- [ ] 运行配置脚本或手动设置环境变量
- [ ] 验证环境变量已设置
- [ ] 测试 `cargo build` 是否成功
- [ ] 测试 `cargo test` 是否成功

## 参考

- CMake 文档: https://cmake.org/documentation/
- Cargo 配置: https://doc.rust-lang.org/cargo/reference/config.html

