# CMake 4.2 兼容性问题解决方案

## 问题描述

您使用的是 CMake 4.2.0-rc2（候选发布版），而 `audiopus_sys` 使用的 Opus 源码中的 `CMakeLists.txt` 可能设置了较低的 `cmake_minimum_required` 版本（如 3.5）。

CMake 4.2 移除了对旧版本要求的兼容性，导致构建失败。

## 解决方案

### 方案 1: 设置环境变量（推荐，最简单）

在构建前设置环境变量：

```powershell
# PowerShell
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
cargo build

# 或者一次性设置并构建
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"; cargo test --test audio_codec_test
```

```cmd
# CMD
set CMAKE_POLICY_VERSION_MINIMUM=3.5
cargo build
```

### 方案 2: 降级到 CMake 3.x 稳定版（推荐用于生产环境）

CMake 4.2 是候选发布版，可能存在兼容性问题。建议使用稳定版：

1. **卸载 CMake 4.2**
   ```powershell
   # 通过控制面板卸载，或使用 winget
   winget uninstall Kitware.CMake
   ```

2. **安装 CMake 3.28.x 稳定版**
   - 访问: https://cmake.org/download/
   - 下载 `cmake-3.28.x-windows-x86_64.msi`
   - 安装时勾选 "Add CMake to the system PATH"

3. **验证版本**
   ```powershell
   cmake --version
   # 应该显示 3.28.x
   ```

### 方案 3: 使用预编译的 Opus 库（如果可用）

如果 `audiopus_sys` 支持使用预编译库，可以避免构建问题。检查是否有 `vendored` 或 `system` feature：

```toml
# 在 Cargo.toml 中尝试
opus = { version = "0.3", default-features = false, features = ["system"] }
```

### 方案 4: 使用不同的 Opus 绑定

如果 `audiopus_sys` 持续有问题，可以考虑其他 Rust Opus 绑定：

- `audiopus` - 另一个 Opus 绑定
- `libopus-sys` - 直接绑定到 libopus

## 快速测试

使用方案 1（环境变量）快速测试：

```powershell
cd electron_node/services/node-inference
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
cargo clean
cargo build
```

如果构建成功，运行测试：

```powershell
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
cargo test --test audio_codec_test
```

## 永久设置环境变量（可选）

如果方案 1 有效，可以永久设置：

1. 打开 "系统属性" → "高级" → "环境变量"
2. 在 "用户变量" 或 "系统变量" 中点击 "新建"
3. 变量名: `CMAKE_POLICY_VERSION_MINIMUM`
4. 变量值: `3.5`
5. 确定并重启终端

## 推荐方案

**对于开发环境**:
- 使用方案 1（环境变量）- 快速且不需要重新安装

**对于生产环境**:
- 使用方案 2（降级到 CMake 3.28.x）- 更稳定可靠

## 验证

设置环境变量后，验证构建：

```powershell
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
cargo build --verbose 2>&1 | Select-String -Pattern "cmake|CMake|opus"
```

如果看到 CMake 成功配置 Opus，说明问题已解决。

