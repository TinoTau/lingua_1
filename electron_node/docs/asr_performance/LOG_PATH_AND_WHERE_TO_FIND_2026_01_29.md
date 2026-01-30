# 节点端主进程日志路径说明（2026-01-29）

## 1. 矛盾原因（已修复）

**第一版问题**：日志写入路径用的是 **`process.cwd()`**（当前工作目录）。  
谁在哪个目录下启动进程，日志就写在「该目录/logs/electron-main.log」。  
脚本和文档默认找的是 **electron_node/electron-node/logs/electron-main.log**，和实际写入位置可能不一致，导致「找不到日志」。

**第二版问题（__dirname 与编译输出矛盾）**：  
曾改为用 **`__dirname`** 的上一级作为 log 目录。但主进程编译输出在 **dist/main/** 下（tsconfig.main.json 的 outDir），运行时 **logger.js** 实际在 **dist/main/main/src/logger.js**，因此 `path.resolve(__dirname, '..')` 得到的是 **dist/main/main/**，日志实际写在 **electron_node/electron-node/dist/main/main/logs/electron-main.log**，而脚本和文档找的是 **electron_node/electron-node/logs/electron-main.log**，仍然「找不到日志」。

**当前做法**：  
不再依赖「logger 所在目录」，而是 **向上查找项目根**：从 `__dirname` 起向上找第一个同时包含 **package.json** 和 **main** 目录的目录，视为 electron-node 项目根，日志固定写在 **项目根/logs/electron-main.log**。  
这样无论从源码（main/src）还是编译后（dist/main/main/src）加载，得到的都是 **electron_node/electron-node/logs/electron-main.log**，与脚本和文档一致。

---

## 2. 固定路径（推荐）

| 场景 | 日志文件路径 |
|------|----------------|
| 运行编译后的主进程（main/logger.js） | **electron_node/electron-node/logs/electron-main.log** |
| 即：从 electron-node 目录 `npm start` 或运行打包应用时 | 同上 |

启动时控制台会打印：`[Logger] Log file path: ...`，以该输出为准。

---

## 3. 为何仓库里看不到该文件？

项目根目录 **.gitignore** 里包含：

- `*.log`
- `logs/`

所以 **electron-main.log** 和 **logs/** 目录不会被提交，仓库里看不到是正常的。  
日志只在本地生成，分析时请用本机上的 **electron_node/electron-node/logs/electron-main.log**（或控制台打印的路径）。

---

## 4. 脚本默认查找顺序

**analyze_jobs_per_service_flow.ps1** 的默认查找顺序：

1. **electron_node/electron-node/logs/electron-main.log**（与固定路径一致）
2. **当前工作目录/logs/electron-main.log**（若在 electron_node 下执行脚本，则为 electron_node/logs/electron-main.log）

若仍找不到，请用 **-LogPath** 显式指定本次测试产生的 log 的完整路径。

---

## 5. 从源码直接跑（如单测）

从 **main/src** 或 **dist/main/main/src** 加载时，都会通过「向上找项目根」得到 **electron-node**，因此日志统一在 **electron_node/electron-node/logs/electron-main.log**，无歧义。

---

## 6. 小结

- **写入**：主进程 logger 通过 **向上查找项目根**（含 package.json + main 的目录），固定写到 **electron-node/logs/electron-main.log**，与脚本/文档一致，避免与编译输出目录（dist/main/main/logs）混淆。
- **找不到时**：看启动时控制台的 `[Logger] Log file path: ...`，或以脚本的 **-LogPath** 指定实际路径。
- **仓库无文件**：因 .gitignore 忽略了 `*.log` 和 `logs/`，属预期行为。
