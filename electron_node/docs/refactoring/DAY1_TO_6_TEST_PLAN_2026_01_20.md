# Day 1-6 重构测试计划 - 2026-01-20

## 🎯 测试目标

验证 Day 1-6 的所有重构改动是否正常工作，确保没有引入回归问题。

---

## 📋 测试清单

### ✅ 0. 环境准备
- [ ] TypeScript 编译无错误
- [ ] Vite 开发服务器运行正常
- [ ] Electron 应用成功启动
- [ ] 主窗口成功打开

### 🔍 1. Day 1 测试 - InferenceService 重构
**目标**: 验证 InferenceService 使用 ServiceRegistry 而不是 Manager

- [ ] InferenceService 能获取服务列表
- [ ] InferenceService 能解析服务端点
- [ ] InferenceService 不再依赖 PythonServiceManager
- [ ] 数据源统一为 ServiceRegistry

### 🔍 2. Day 2 测试 - NodeAgent 重构
**目标**: 验证 NodeAgent 使用快照函数而不是 Manager

- [ ] NodeAgent 能生成服务快照
- [ ] NodeAgent 能生成资源快照
- [ ] NodeAgent 不再依赖 pythonServiceManager/rustServiceManager
- [ ] 硬件信息获取有 3 秒超时保护
- [ ] 节点能成功注册到调度器
- [ ] 调度器能收到心跳

### 🔍 3. Day 3 测试 - ServiceProcessRunner 简化
**目标**: 验证魔法数字已删除，错误处理统一

- [ ] 所有常量使用 PROCESS_CONSTANTS
- [ ] 无硬编码的超时值
- [ ] 所有错误统一抛出（不静默）
- [ ] 日志清晰且有 jobId 上下文

### 🔍 4. Day 4 测试 - ServiceRegistry 重构
**目标**: 验证服务发现只用 service.json

- [ ] 服务发现能扫描所有 service.json
- [ ] 不再读取 installed_services.json
- [ ] 不再读取 current_services.json
- [ ] 所有服务 ID 统一为 kebab-case
- [ ] 动态添加/删除服务能被发现

### 🔍 5. Day 5 测试 - IPC 和 Lifecycle 统一
**目标**: 验证命名转换已删除，lifecycle 简化

- [ ] IPC handlers 不再做 `replace(/_/g, '-')` 转换
- [ ] 所有服务 ID 统一使用 kebab-case
- [ ] registerWindowCloseHandler 已删除
- [ ] lifecycle 逻辑简化，无冗余代码

### 🔍 6. Day 6 测试 - TSConfig 输出重构
**目标**: 验证输出到 dist/main，路径别名正常

- [ ] TypeScript 编译输出到 dist/main/
- [ ] package.json main 指向 dist/main/index.js
- [ ] 相对路径全部正确（window-manager.ts）
- [ ] TypeScript 路径别名 @shared/* 正常解析
- [ ] tsconfig-paths 正确注册

---

## 🧪 详细测试步骤

### 测试 1: 编译和启动
```bash
# 1. 编译主进程
npm run build:main
# 期望: Exit code 0, 无错误

# 2. 检查输出文件
Test-Path dist/main/index.js
# 期望: True

# 3. 启动应用
npm run dev  # 终端1: TypeScript watch + Vite
npm start    # 终端2: Electron
# 期望: 窗口打开，无错误
```

### 测试 2: 服务发现（Day 4）
```typescript
// 在 Electron DevTools Console 中执行
const services = await window.electronAPI.serviceDiscovery.list();
console.log('发现的服务:', services.length, services.map(s => s.id));
// 期望: 显示 9 个服务，所有 ID 都是 kebab-case
```

### 测试 3: 服务状态（Day 3 & 4）
```typescript
// 检查服务状态
services.forEach(s => {
  console.log(`${s.id}: ${s.status} (PID: ${s.pid || 'N/A'})`);
});
// 期望: 所有服务都有明确的状态
```

### 测试 4: 启动/停止服务（Day 4 & 5）
```typescript
// 启动服务（使用 kebab-case ID）
const result = await window.electronAPI.serviceDiscovery.start('nmt-m2m100');
console.log('启动结果:', result);
// 期望: success: true

// 停止服务
const stopResult = await window.electronAPI.serviceDiscovery.stop('nmt-m2m100');
console.log('停止结果:', stopResult);
// 期望: success: true
```

### 测试 5: NodeAgent 注册（Day 2）
```bash
# 查看主进程日志
# 期望看到:
# - "NodeAgent initialized"
# - "Node registered successfully"
# - "node-XXXXXXXX" (8位ID)
# - 周期性心跳日志
```

### 测试 6: IPC Handlers（Day 5）
```typescript
// 测试所有 IPC handlers
const tests = [
  () => window.electronAPI.getSystemResources(),
  () => window.electronAPI.getNodeInfo(),
  () => window.electronAPI.serviceDiscovery.list(),
];

for (const test of tests) {
  try {
    const result = await test();
    console.log('✅ 测试通过:', result);
  } catch (err) {
    console.error('❌ 测试失败:', err);
  }
}
```

### 测试 7: UI 界面
- [ ] 服务管理界面显示所有发现的服务
- [ ] 刷新服务按钮正常工作
- [ ] 服务状态实时更新（每 2 秒）
- [ ] 启动/停止按钮正常工作
- [ ] 模型管理界面动态显示服务（无硬编码）

### 测试 8: 路径别名（Day 6 Hotfix 2）
```bash
# 检查编译后的代码
grep -n "@shared" dist/main/**/*.js
# 期望: 无 @shared 字符串（应该已被解析为实际路径）

# 检查运行时注册
# 期望在启动日志中看到:
# "✅ TypeScript path aliases registered (baseUrl: ...)"
```

---

## 📊 测试记录

### 环境信息
- **Node.js**: ___
- **npm**: ___
- **TypeScript**: ___
- **Electron**: ___
- **测试日期**: 2026-01-20
- **测试人员**: ___

### 测试结果

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 0. 环境准备 | ⏳ | |
| 1. Day 1 - InferenceService | ⏳ | |
| 2. Day 2 - NodeAgent | ⏳ | |
| 3. Day 3 - ServiceProcessRunner | ⏳ | |
| 4. Day 4 - ServiceRegistry | ⏳ | |
| 5. Day 5 - IPC & Lifecycle | ⏳ | |
| 6. Day 6 - TSConfig | ⏳ | |
| 7. UI 界面测试 | ⏳ | |
| 8. 路径别名测试 | ⏳ | |

**图例**:
- ⏳ 待测试
- ✅ 通过
- ❌ 失败
- ⚠️ 部分通过

---

## 🐛 发现的问题

### 问题 1
- **描述**: 
- **严重程度**: 
- **状态**: 
- **解决方案**: 

---

## 📝 测试总结

### 通过的测试
- 

### 失败的测试
- 

### 待改进项
- 

---

**测试开始时间**: ___  
**测试结束时间**: ___  
**总体结论**: ___
