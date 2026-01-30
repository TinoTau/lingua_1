# 测试脚本

本目录包含各类测试相关的脚本工具。

## 脚本分类

### 调度服务器测试
- `test-scheduler-functions.ps1` - 调度服务器功能测试
- `test-scheduler-功能测试.ps1` - 调度服务器功能测试（中文版）

### 服务测试
- `test_services_simple.ps1` - 简单服务测试
- `test_all_services_comprehensive.ps1` - 全面服务测试

### WebSocket测试
- `test-websocket-e2e.py` - WebSocket端到端测试

## 使用说明

### 运行调度服务器测试

```powershell
# 功能测试
.\test-scheduler-functions.ps1

# 中文版本
.\test-scheduler-功能测试.ps1
```

### 运行服务测试

```powershell
# 简单测试
.\test_services_simple.ps1

# 全面测试
.\test_all_services_comprehensive.ps1
```

### 运行WebSocket测试

```bash
python test-websocket-e2e.py
```

## 测试环境要求

1. **调度服务器测试**
   - 调度服务器必须正在运行
   - Redis必须正在运行
   - 至少有一个节点在线

2. **服务测试**
   - 所有服务必须已启动
   - GPU可用（如需要）

3. **WebSocket测试**
   - Python 3.8+
   - websocket-client库
   - 调度服务器正在运行

## 相关文档

- [测试总结报告](../../docs/testing/)
- [调度服务器测试报告](../../central_server/docs/scheduler/optimization/调度服务器测试报告_2026_01_22.md)
- [WebSocket测试报告](../../webapp/docs/WebSocket测试报告_2026_01_22.md)

---

**最后更新**: 2026-01-22  
**维护团队**: 测试组
