
```markdown
# ARCHITECTURE_REFACTOR_EXECUTION_PLAN_2026_01_20.md
## 节点端架构重构执行计划（For Internal Development）

版本：v1.0  
日期：2026-01-20  
目标受众：节点端主开发 / 架构调整执行人员  
文档目的：将已确定的“简化架构方案”落地为一套可执行的重构步骤，重点在“减少复杂度、删除假对象、统一通路、方便排查问题”。

---

# 1. 重构目标（最终状态）

本次重构的最终愿景：

1. **只保留一条节点端运行链路：**
```

UI → IPC → ServiceProcessRunner → ServiceRegistry → spawn/kill 服务

````
2. **删除所有旧 Manager / 兼容层 / 假对象 / null-as-any**  
包含：`PythonServiceManager`、`RustServiceManager`、`legacyServiceRegistryManagerAdapter`  
3. **InferenceService 不再依赖任何 Manager**  
只依赖一个 `EndpointResolver(capability) -> URL`
4. **NodeAgent 不再依赖旧 Manager**  
只依赖 `getServiceSnapshot()` + `getResourceSnapshot()`
5. **服务发现只靠 service.json + ServiceRegistry**  
不再使用 installed.json、current.json、命名转换、蛇形转短横等中间逻辑
6. **生命周期逻辑统一、无 null 参数、无多余依赖**
7. **去掉魔法数字和隐式等待机制**  
spawn 成功即视为启动尝试，失败由健康检查或 exit 事件确定
8. **构建产物统一输出 dist/main**  
彻底清理多层 outDir 嵌套

最终效果：**节点端代码实现可读、简单、线性，无隐藏逻辑，无层层绕路，任何错误都能在一眼可见的地方截获。**

---

# 2. 高层重构策略

重构策略采用“**直接替换，不做兼容**”模式：

- 不做渐进合并，不做临时兼容 Adapter，不保留旧接口和旧 Manager  
- 不做隐藏补丁，不做“保险层”，任何错都直接抛出供排查  
- 必要时直接改构造函数签名、直接改 module API  
- 允许修改 20~30 个文件，因为长期维护成本可以降低一个数量级

**理念：为了少写以后半年，每天多写 1 小时是值得的。**

---

# 3. 模块级重构动作

以下按模块拆解重构内容。

---

## 3.1 InferenceService（核心第 1 刀）

### 3.1.1 删除内容
- 删除构造函数参数：
- pythonServiceManager
- rustServiceManager
- serviceRegistryManagerAdapter
- 删除内部所有 `this.pythonServiceManager...` 和 `this.rustServiceManager...` 的逻辑
- 删除所有 mock / dummy / null-as-any 注入点

### 3.1.2 新构造函数设计

```ts
type Capability = "asr" | "nmt" | "tts" | "semantic";

type EndpointResolver = (cap: Capability) => URL;

class InferenceService {
constructor(private resolveEndpoint: EndpointResolver) {}
}
````

### 3.1.3 InferenceService 目标职责

* 只负责发送 HTTP/gRPC 到服务
* 不关心服务启动/停止
* 不关心服务端口分配
* 不关心服务存不存在，resolveEndpoint 会告诉它

### 3.1.4 辅助函数：端点解析

端点由外层提供，例如：

```ts
function endpointResolver(capability: Capability): URL {
  const svc = pickOneRunningService(serviceRegistry, capability);
  if (!svc) throw new ServiceError("SERVICE_NOT_AVAILABLE", capability);
  return new URL(`http://127.0.0.1:${svc.def.port}`);
}
```

---

## 3.2 NodeAgent（核心第 2 刀）

### 3.2.1 删除内容

* 删除构造函数参数：

  * pythonServiceManager
  * rustServiceManager
* 删除所有 `null as any` 注入代码
* 删除内部对旧 Manager 的所有引用

### 3.2.2 新构造函数设计

```ts
class NodeAgent {
  constructor(
    private getServiceSnapshot: () => InstalledService[],
    private getResourceSnapshot: () => ResourceUsage
  ) {}
}
```

### 3.2.3 NodeAgent 的唯一职责

* 定期上报服务快照（基于 ServiceRegistry）
* 定期上报资源快照（CPU/GPU）
* 上报失败/网络失败即抛错，不做兜底逻辑

---

## 3.3 ServiceProcessRunner（核心第 3 刀）

### 3.3.1 简化启动逻辑

删除：

* 500ms 魔法等待
* 过度检测 PID 是否可见
* 兼容旧 Manager 的 fallback 逻辑

保留精简逻辑：

```ts
class ServiceProcessRunner {
  start(id: string) {
    const entry = registry.get(id);
    if (!entry) throw new Error(`Service not found: ${id}`);

    const child = spawn(entry.def.exec.command, entry.def.exec.args, {
      cwd: entry.def.exec.cwd,
      stdio: "ignore"
    });

    entry.runtime.pid = child.pid ?? undefined;
    entry.runtime.status = "running";

    child.on("exit", code => {
      entry.runtime.status = "stopped";
      entry.runtime.lastExitCode = code ?? undefined;
    });

    child.on("error", err => {
      entry.runtime.status = "error";
      entry.runtime.lastError = String(err);
    });
  }
}
```

### 3.3.2 健康检查（可选）

* 如果 service.json 提供 `/health`，则 5–10 秒做一次 GET
* 若失败，entry.runtime.lastHealthStatus = "unhealthy"
* 但不在 `start()` 内阻塞等待健康

### 3.3.3 去掉区分 Python/Rust 的 Manager

* **不需要 PythonServiceManager**
* **不需要 RustServiceManager**
* 都归到 `ServiceProcessRunner` 管

---

## 3.4 ServiceRegistry（核心第 4 刀）

### 3.4.1 服务定义来源

* **只来源于 `services/*/service.json`**
* 删除：

  * installed.json
  * current.json
  * 各种 merge/resolve layering

### 3.4.2 内存结构

```ts
type ServiceRegistry = Map<string, ServiceEntry>;
```

### 3.4.3 服务发现逻辑只有一个函数

```ts
async function scanServices(root): Promise<ServiceRegistry>
```

用户点击“刷新服务” → 主进程重新跑一遍 scan → 替换 registry。

---

## 3.5 生命周期（core lifecycle）

### 3.5.1 改造 registerWindowCloseHandler

从：

```
(registerWindowCloseHandler getMainWindow null null serviceRunner)
```

改成：

```ts
registerWindowCloseHandler(getMainWindow, serviceRunner);
```

删除所有无关参数。

### 3.5.2 逻辑

* 关窗口前统一调用 `serviceRunner.stopAll()`
* 关窗口后 destroy win

无任何兼容处理、fallback、异常吞噬。

---

## 3.6 IPC（统一化）

### 3.6.1 删除蛇形转短横 replace 逻辑

全部使用 kebab-case（服务 ID 统一风格）。

### 3.6.2 保存的 IPC 列表

* `services:list`
* `services:refresh`
* `services:start`
* `services:stop`

### 3.6.3 统一错误策略：

错误全部抛到前端，由前端显示，不做 silent error。

---

## 3.7 tsconfig / 编译输出

### 3.7.1 重构输出结构

主进程：

```json
{
  "compilerOptions": {
    "rootDir": "./main/src",
    "outDir": "./dist/main"
  }
}
```

渲染层：

```
outDir = "./dist/renderer"
```

### 3.7.2 删除旧路径依赖

调整 Electron 启动入口 → `require("./dist/main/index.js")`

---

# 4. 重构执行顺序（1 周可完成）

## Day 1

### 模块：InferenceService

* 改构造函数签名（删 Manager）
* 删除所有旧依赖逻辑
* 替换为 EndpointResolver

## Day 2

### 模块：NodeAgent

* 改构造函数
* 改内部心跳依赖
* 删除所有空对象、null as any

## Day 3

### 模块：ServiceProcessRunner

* 删除旧 Python/Rust Manager
* 合并成一个 spawn 执行器
* 精简 start/stop 状态逻辑

## Day 4

### 模块：ServiceRegistry + ServiceDiscovery

* 实现 scanServices()
* 替换所有从 installed.json/current.json 读的逻辑
* UI 刷新 → 触发重扫

## Day 5

### 模块：IPC + lifecycle

* 删除多余 IPC handler
* 服务 ID 统一 kebab-case，不做转换
* 生命周期签名改造
* 错误向上抛出

## Day 6

### tsconfig / build/layout 重构

* 输出到 dist/main / dist/renderer
* 修正 import 路径
* 生产构建测试

## Day 7

### 回归测试

* 服务启动/停止全链路验证
* NodeAgent 注册 + 心跳验证
* InferenceService → 各服务推理端到端
* 强制异常（错误端口/错误 command）验证报错是否清晰

---

# 5. Task List（可直接丢给 Jira / 研发）

按优先级拆分。

---

## P0（必须、阻塞性任务）

* [ ] 删除 PythonServiceManager（全项目）
* [ ] 删除 RustServiceManager（全项目）
* [ ] 删除 legacyServiceRegistryManagerAdapter
* [ ] 删除所有 null-as-any 临时代码
* [ ] 重写 InferenceService 构造函数与内部引用
* [ ] 重写 NodeAgent 构造函数与内部实现
* [ ] 创建统一的 ServiceProcessRunner
* [ ] 创建 scanServices()
* [ ] 替换所有旧服务发现逻辑为 scanServices()

---

## P1（高优先级、功能可运行）

* [ ] 统一服务 ID 为 kebab-case，删除 replace 转换
* [ ] IPC handler 整理：只保留四个核心 handler
* [ ] 生命周期 handler 签名改造（只保留 serviceRunner）
* [ ] NodeAgent heartbeat 使用 getServiceSnapshot()

---

## P2（收尾优化）

* [ ] 去掉 spawn 内的 magic number（如 500ms 延迟）
* [ ] 可选：加非常轻量级健康检查（基于 service.json.health）
* [ ] 错误抛出策略统一：所有模块的错误向上抛到 UI
* [ ] 删除所有 dead code / 内部被弃用模块

---

## P3（工程质量）

* [ ] tsconfig 重构（outDir → dist/main）
* [ ] Electron 主进程入口调整
* [ ] 小规模单元测试（ServiceProcessRunner / scanServices）

---

# 6. 最终说明

本执行计划将节点端从一个“过度抽象 + 多层 Manager + 技术债堆积”的结构，彻底收缩为一条直线式架构。
完成后，你的节点端具备以下特性：

* **所有问题都能在单一代码路径上定位**
* **错误不会被包装或吞掉，调试极快**
* **服务查找、服务状态、服务启动、端点解析都各有清晰位置**
* **没有任何兼容层 / 假 Manager / 嵌套路由**
* **长期维护成本大幅下降**

以上即为本次重构的完整执行计划。

