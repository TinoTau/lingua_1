# Day 4 单元测试计划 - 2026-01-20

## 🧪 **测试目标**

验证 Day 4 重构后的服务层功能完整性。

---

## 📋 **测试清单**

### 1. ServiceDiscovery 测试 ✅

**已有测试**: `ServiceDiscovery.test.ts`

**测试内容**:
- ✅ 扫描 service.json
- ✅ 验证必需字段（id, name, type）
- ✅ 验证 exec 字段
- ✅ 处理重复 service_id
- ✅ 处理无效 JSON
- ✅ 转换相对路径为绝对路径

**运行方式**:
```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm test -- ServiceDiscovery.test.ts
```

---

### 2. ServiceProcessRunner 集成测试

**测试文件**: 创建 `ServiceProcessRunner.test.ts`

**测试场景**:

#### A. 启动服务
```typescript
describe('ServiceProcessRunner.start()', () => {
  it('should start a service successfully', async () => {
    // Given: 一个停止的服务
    // When: 调用 runner.start(id)
    // Then: 服务状态变为 starting -> running
  });

  it('should throw if service not found', async () => {
    // Given: 不存在的服务ID
    // When: 调用 runner.start('non-existent')
    // Then: 抛出 "Service not found" 错误
  });

  it('should throw if service already running', async () => {
    // Given: 已运行的服务
    // When: 调用 runner.start(id)
    // Then: 抛出 "Service already running" 错误
  });
});
```

#### B. 停止服务
```typescript
describe('ServiceProcessRunner.stop()', () => {
  it('should stop a running service', async () => {
    // Given: 一个运行中的服务
    // When: 调用 runner.stop(id)
    // Then: 服务优雅关闭，状态变为 stopped
  });

  it('should release port after stop', async () => {
    // Given: 占用端口5000的服务
    // When: 调用 runner.stop(id)
    // Then: 端口5000在3秒内释放
  });
});
```

#### C. 获取状态
```typescript
describe('ServiceProcessRunner.getStatus()', () => {
  it('should return correct status', () => {
    // Given: 服务注册表
    // When: 调用 runner.getStatus(id)
    // Then: 返回正确的 Status 对象
  });

  it('should return all statuses', () => {
    // Given: 多个服务
    // When: 调用 runner.getAllStatuses()
    // Then: 返回所有服务的 Status 数组
  });
});
```

---

### 3. IPC Handlers 测试 ✅

**已有测试**: `service-ipc-handlers.test.ts`

**测试内容**:
- ✅ services:list - 列出所有服务
- ✅ services:start - 启动服务
- ✅ services:stop - 停止服务
- ✅ services:get - 获取单个服务
- ✅ services:refresh - 刷新服务列表（非破坏性）

**运行方式**:
```bash
npm test -- service-ipc-handlers.test.ts
```

---

### 4. ServiceRegistry 集成测试

**测试文件**: 创建 `ServiceRegistry.integration.test.ts`

**测试场景**:

#### A. 全局单例
```typescript
describe('ServiceRegistrySingleton', () => {
  it('should maintain single global instance', () => {
    // Given: 设置全局 registry
    // When: 多次调用 getServiceRegistry()
    // Then: 返回同一个实例
  });

  it('should reflect changes across modules', () => {
    // Given: 模块A修改registry
    // When: 模块B读取registry
    // Then: 看到模块A的修改
  });
});
```

#### B. 服务刷新
```typescript
describe('services:refresh', () => {
  it('should add new services', async () => {
    // Given: 添加新的 service.json
    // When: 调用 services:refresh
    // Then: 新服务出现在列表中
  });

  it('should update service definitions', async () => {
    // Given: 修改 service.json 的定义
    // When: 调用 services:refresh
    // Then: 定义更新，runtime状态保留
  });

  it('should not stop running services', async () => {
    // Given: 运行中的服务
    // When: 调用 services:refresh
    // Then: 服务继续运行
  });
});
```

---

## 🚀 **运行所有测试**

```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node

# 运行所有服务层测试
npm test -- --testPathPattern=service-layer

# 或运行所有测试
npm test
```

---

## 📊 **预期结果**

### 成功指标
- ✅ 所有测试通过
- ✅ 覆盖率 > 80%
- ✅ 无测试超时
- ✅ 无内存泄漏

### 失败处理
如果测试失败：
1. 查看错误信息
2. 修复代码逻辑
3. 重新运行测试
4. 更新文档

---

## 📝 **测试报告模板**

```markdown
## Day 4 测试报告

### 测试环境
- Node.js: vX.X.X
- 操作系统: Windows 10
- 测试时间: 2026-01-20

### 测试结果
- 总测试数: XX
- 通过: XX
- 失败: 0
- 跳过: 0
- 覆盖率: XX%

### 失败的测试
无

### 结论
✅ Day 4 重构通过单元测试
```

---

**创建时间**: 2026-01-20  
**状态**: ✅ 测试计划已创建  
**下一步**: 运行测试 → 验证通过 → 更新文档
