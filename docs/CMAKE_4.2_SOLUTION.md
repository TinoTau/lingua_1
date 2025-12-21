# CMake 4.2 兼容性问题解决方案

## 问题

使用 CMake 4.2.0-rc2 时，构建 Opus 库出现错误：

```
CMake Error at CMakeLists.txt:1 (cmake_minimum_required):   
  Compatibility with CMake < 3.5 has been removed from CMake.
```

## 原因

CMake 4.2 移除了对旧版本 `cmake_minimum_required` 的兼容性支持。Opus 源码中的 `CMakeLists.txt` 设置了较低的版本要求（如 3.5），导致 CMake 4.2 拒绝构建。

## 解决方案

### ✅ 方案：设置环境变量（已验证有效）

在构建前设置 `CMAKE_POLICY_VERSION_MINIMUM` 环境变量：

**PowerShell**:
```powershell
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
cargo build
cargo test
```

**CMD**:
```cmd
set CMAKE_POLICY_VERSION_MINIMUM=3.5
cargo build
cargo test
```

### 永久设置（可选）

如果需要永久设置，可以添加到系统环境变量：

1. 打开 "系统属性" → "高级" → "环境变量"
2. 新建用户变量或系统变量：
   - 变量名: `CMAKE_POLICY_VERSION_MINIMUM`
   - 变量值: `3.5`
3. 重启终端

## 验证

设置环境变量后，运行测试：

```powershell
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
cargo test --test audio_codec_test
cargo test --test http_server_opus_test
```

**测试结果**:
- ✅ `audio_codec_test`: 7 passed
- ✅ `http_server_opus_test`: 5 passed

## 测试结果总结

### Web Client 端
- ✅ Session Init 协议增强测试: **6/6 通过**

### Node 端（使用 CMake 4.2 + 环境变量）
- ✅ 音频编解码器测试: **7/7 通过**
- ✅ HTTP 服务器 Opus 解码测试: **5/5 通过**

## 总结

**CMake 4.2 可以正常使用**，只需要在构建时设置 `CMAKE_POLICY_VERSION_MINIMUM=3.5` 环境变量即可。

这个解决方案：
- ✅ 不需要降级 CMake
- ✅ 不需要修改源码
- ✅ 简单易用
- ✅ 已验证有效

## 推荐工作流程

在开发时，可以在 PowerShell 配置文件中添加：

```powershell
# 添加到 $PROFILE
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
```

或者在项目根目录创建 `.env` 文件（如果使用支持的工具）。

