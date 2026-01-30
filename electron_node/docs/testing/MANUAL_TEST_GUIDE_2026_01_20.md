# 手动测试指南 - 2026-01-20

## 📋 **问题诊断**

自动测试显示无法连接到节点端API（http://localhost:3001），可能原因：

1. ✅ Electron还未启动
2. ✅ Electron使用了不同的端口
3. ✅ Electron启动但API未就绪
4. ✅ 开发环境配置问题

---

## 🚀 **启动步骤**

### Step 1: 确保Vite运行中

```powershell
# Terminal 1
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev
```

**预期输出**:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

### Step 2: 启动Electron

```powershell
# Terminal 2 (新终端)
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm start
```

**预期**:
- Electron窗口打开
- 显示服务管理界面
- 可以看到服务列表

---

## 🧪 **手动测试清单**

### 测试1: 服务列表显示

**操作**: 打开Electron窗口

**预期**:
- [ ] 可以看到所有服务
- [ ] 服务状态清晰显示（已停止/正在启动.../运行中）
- [ ] 显示PID和端口

**截图位置**: 服务管理页面

---

### 测试2: 服务启动（观察状态流转）

**操作**: 点击启动"NMT 翻译服务"

**预期状态流转**:
1. **点击后立即**: 显示 ⏳ **"正在启动..."**
2. **2-5秒后**: 变为 ✅ **"运行中"**
3. **PID显示**: 应该有PID号码
4. **端口显示**: 应该显示8002

**关键验证**:
- [ ] 不立即显示"运行中"
- [ ] 有"正在启动..."状态
- [ ] 状态变化流畅

---

### 测试3: 刷新服务

**操作**:
1. 确保至少1个服务在运行（如NMT）
2. 记录PID（例如：12345）
3. 点击"刷新服务"按钮

**预期**:
- [ ] NMT服务仍然显示"运行中"
- [ ] PID没有变化（仍然是12345）
- [ ] 服务未被停止

**如果失败**: 说明刷新功能有问题

---

### 测试4: 服务停止

**操作**: 点击停止正在运行的NMT服务

**预期**:
- [ ] 状态变为"已停止"
- [ ] PID消失
- [ ] 服务进程确实被kill

**验证进程**:
```powershell
# 检查Python进程（应该少一个）
Get-Process python -ErrorAction SilentlyContinue
```

---

### 测试5: 多个服务同时运行

**操作**: 依次启动多个服务
1. FastWhisperVad
2. NMT
3. Piper TTS

**预期**:
- [ ] 每个服务都正确启动
- [ ] 状态独立显示
- [ ] 无相互影响

---

### 测试6: 配置保存

**操作**:
1. 启动2个服务
2. 关闭Electron
3. 重新启动Electron

**预期**:
- [ ] 之前启动的服务自动恢复（或保存状态）
- [ ] 配置正确加载

---

## 🔍 **问题排查**

### 问题1: Electron无法启动

**检查**:
```powershell
# 检查Vite是否运行
curl http://localhost:5173

# 查看日志
cat d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log
```

### 问题2: 服务列表为空

**检查**:
```powershell
# 确认services目录存在
ls d:\Programs\github\lingua_1\electron_node\services

# 检查每个服务的service.json
ls d:\Programs\github\lingua_1\electron_node\services\*\service.json
```

### 问题3: 服务无法启动

**检查**:
1. 查看Electron控制台（F12）
2. 查看错误信息
3. 手动启动服务验证：
   ```powershell
   cd d:\Programs\github\lingua_1\electron_node\services\nmt_m2m100
   python nmt_service.py
   ```

### 问题4: 状态立即显示"运行中"

**可能原因**: 代码未重新编译

**解决**:
```powershell
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
npm start
```

---

## 📊 **测试记录表**

### 架构验证

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 服务列表显示 | [ ] 通过 / [ ] 失败 | ________________ |
| 状态流转（starting → running） | [ ] 通过 / [ ] 失败 | ________________ |
| 刷新不影响运行服务 | [ ] 通过 / [ ] 失败 | ________________ |
| 服务停止 | [ ] 通过 / [ ] 失败 | ________________ |
| 多服务同时运行 | [ ] 通过 / [ ] 失败 | ________________ |
| 配置保存 | [ ] 通过 / [ ] 失败 | ________________ |

### 功能验证

| 服务 | 启动 | 运行 | 停止 | 备注 |
|------|------|------|------|------|
| FastWhisperVad | [ ] | [ ] | [ ] | ________________ |
| NMT | [ ] | [ ] | [ ] | ________________ |
| Piper TTS | [ ] | [ ] | [ ] | ________________ |
| Semantic Repair ZH | [ ] | [ ] | [ ] | ________________ |
| Semantic Repair Unified | [ ] | [ ] | [ ] | ________________ |

---

## ✅ **完成标准**

### 核心测试（必须通过）

- [ ] 服务列表正常显示
- [ ] 服务启动状态流转正确（starting → running）
- [ ] 刷新不影响运行中的服务
- [ ] 服务可以正常停止

### 可选测试

- [ ] 多服务同时运行
- [ ] 配置保存和恢复
- [ ] API功能测试

---

## 🎯 **关键观察点**

### 1. 状态透明性

**重要**: 服务启动时应该显示"正在启动..."，**不应该立即显示"运行中"**

这是本次修复的核心改进！

### 2. 刷新功能

**重要**: 点击刷新后，运行中的服务**不应该被停止**

这是架构统一的关键验证！

### 3. 无冗余逻辑

所有功能应该通过统一的`ServiceProcessRunner`实现，无重复或矛盾的行为。

---

## 📸 **建议截图**

1. 服务列表（显示所有服务）
2. 服务启动中（显示"正在启动..."状态）
3. 服务运行中（显示PID和端口）
4. 刷新前后对比（PID保持不变）
5. 多服务运行（同时运行多个服务）

---

## 📝 **测试报告模板**

完成测试后，请记录：

### 成功的功能
- ✅ ...
- ✅ ...

### 发现的问题
- ❌ ...
- ❌ ...

### 需要改进的地方
- ⚠️ ...
- ⚠️ ...

---

**测试时间**: 预计10-15分钟  
**关键验证**: 状态流转和刷新功能  
**成功标志**: 所有核心测试通过

---

**如果需要帮助，请提供：**
1. Electron控制台截图（F12）
2. electron-main.log最后50行
3. 具体的错误信息
