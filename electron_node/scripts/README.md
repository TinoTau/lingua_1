# electron_node 运维脚本

仅保留日常启停与排错脚本；开发/批测脚本在 `electron-node/scripts` 与 `electron-node/tests`。

| 脚本 | 用途 |
|------|------|
| [kill_residual_processes.ps1](./kill_residual_processes.ps1) | 清理残留 Python/服务进程（调度前常用） |
| [find_log_file.ps1](./find_log_file.ps1) | 定位主进程 `electron-main.log` |
