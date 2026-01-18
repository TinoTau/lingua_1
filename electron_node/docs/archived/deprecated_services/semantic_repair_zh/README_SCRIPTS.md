# Semantic Repair ZH Service - 脚本快速参考

## 🚀 一键启动（最简单）

```powershell
cd electron_node\services\semantic_repair_zh
.\start_all_in_one.ps1
```

这个脚本会自动：
1. ✅ 检查环境（Python、端口、模型）
2. ✅ 启动服务
3. ✅ 等待服务就绪（最多5分钟）
4. ✅ 检查服务状态
5. ✅ 显示诊断信息
6. ✅ 检测潜在问题

**推荐使用这个脚本！**

---

## 📋 其他脚本

### 启动脚本
- `start_debug.ps1` - 调试启动（实时查看日志）
- `capture_startup_logs.ps1` - 启动并保存日志到文件

### 检查脚本
- `check_service_status.py` - 检查服务状态
- `check_gpu_usage.py` - 检查GPU使用情况
- `view_logs.ps1` - 查看历史日志

---

## 🔍 快速诊断

服务启动后，访问：
- 健康检查：`http://127.0.0.1:5013/health`
- 诊断信息：`http://127.0.0.1:5013/diagnostics`

---

## 📚 详细文档

查看 `SCRIPTS_USAGE_GUIDE.md` 获取完整的使用说明。
