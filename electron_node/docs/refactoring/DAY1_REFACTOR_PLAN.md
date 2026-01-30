# Day 1 重构计划 - InferenceService清理

## 目标

**彻底删除InferenceService对旧Manager的依赖，改用ServiceRegistry**

## 改动文件清单

### 1. 新建文件
- ✅ `task-router-service-manager-new.ts` - 直接从ServiceRegistry读取，无Manager依赖

### 2. 修改文件
- `task-router.ts` - 构造函数改为接收ServiceRegistry
- `inference-service.ts` - 构造函数简化，删除Manager参数
- `app-init-simple.ts` - 删除所有假对象，直接传ServiceRegistry

### 3. 删除文件（标记为deprecated）
- `task-router-service-manager.ts` - 旧版本，依赖Manager

## 步骤

### Step 1: 修改TaskRouter ✅
- 构造函数改为 `constructor(registry: ServiceRegistry)`
- 使用 `TaskRouterServiceManagerNew`
- 删除所有对pythonServiceManager/rustServiceManager的引用

### Step 2: 修改InferenceService ✅
- 构造函数改为 `constructor(modelManager: ModelManager, registry: ServiceRegistry)`
- 只传递registry给TaskRouter
- 删除所有假对象相关代码

### Step 3: 修改app-init-simple.ts ✅
- 删除dummyPythonManager、dummyRustManager、serviceRegistryManagerAdapter
- 直接传入registry

### Step 4: 验证编译 ✅
- 检查TypeScript错误
- 修复所有类型不匹配

### Step 5: 清理NodeAgent（移到Day 2）
- NodeAgent也需要类似的简化，但放到Day 2

## 预期收益

1. **删除约150行假对象代码**
2. **删除3个Manager依赖**
3. **代码路径简化为：InferenceService → TaskRouter → ServiceRegistry**
4. **错误直接抛出，无包装**

## 风险

- 可能影响现有的推理功能
- 需要完整测试ASR/NMT/TTS流程

## 回滚方案

- 保留旧文件作为`.deprecated`后缀
- 出问题可以快速切回

---

**开始时间**: 2026-01-20  
**预计完成**: 1小时内
