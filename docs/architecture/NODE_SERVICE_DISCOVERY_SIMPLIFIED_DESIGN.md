## 版本信息

- 版本：v1.0
- 日期：2026-01-20
- 适用范围：节点端（Node/Electron）服务发现与服务管理逻辑
- 目标：在不考虑兼容的前提下，简化服务发现 + 状态上报逻辑，支持：
  - 用户下载服务压缩包解压后「开包即用」
  - 通过「刷新服务」按钮重新扫描配置
  - NodeAgent 注册 / 心跳统一使用同一份内存数据结构
- 前提：
  - 项目未上线，没有用户
  - 不需要兼容既有 `installed.json` / `current.json`
  - 优先保持代码逻辑简单易懂，而不是叠加保险措施

---

## 1. 设计目标与原则

### 1.1 设计目标

1. **服务发现简单直观**
   - 服务是否“已安装”，仅由 `services/*/service.json` 决定。
   - 不再维护额外的注册表文件（如 `installed.json / current.json`）作为强依赖。

2. **开包即用**
   - 用户只需将下载好的服务压缩包解压到指定目录（如 `services/xxx_service`），
   - 然后在节点端 UI 点击一次「刷新服务」即可生效。

3. **统一视图，用于 UI + NodeAgent**
   - 所有关于“本机有哪些服务 / 当前运行状态”的信息，都来自一份内存结构 `ServiceRegistry`。
   - NodeAgent 注册和心跳**只读这一份内存结构**，不再自己读磁盘或重建服务列表。

4. **代码结构极简**
   - 尽量减少 Manager/Handler 层级。
   - 避免多处重复扫描、重复读文件、重复组装数据。

### 1.2 设计原则

- **单一事实来源（Single Source of Truth）**
  - 单一内存结构 `ServiceRegistry`。
  - 单一服务描述文件 `service.json`。

- **UI 可见即真实**
  - UI 上看到的服务列表就是 NodeAgent 心跳使用的列表。

- **刷新即重新扫描**
  - 不做复杂缓存和增量更新逻辑。
  - 用户点击刷新 → 重新扫描 `services` 目录 → 覆盖内存注册表。

---

## 2. 数据模型设计

### 2.1 服务定义（ServiceDefinition）

来自每个服务目录中的 `service.json`：

```ts
export type ServiceDefinition = {
  id: string;           // 唯一服务 ID，例如 "asr_faster_whisper"
  name: string;         // 展示名称，例如 "ASR Faster Whisper"
  type: "asr" | "nmt" | "tts" | "semantic" | "tone" | string;
  device?: "cpu" | "gpu" | "auto";
  exec: {
    command: string;    // 启动命令，例如 "python" 或某个绝对路径
    args: string[];     // 启动参数列表
    cwd: string;        // 服务工作目录，如 "./services/asr_faster_whisper"
  };
  // 可选字段，后续扩展用
  version?: string;     // 版本号，例如 "1.0.0"
  tags?: string[];      // 标签，用于能力聚合与过滤
};
````

约定：

* `service.json` 是**唯一配置来源**，不再通过其他 JSON 文件描述服务。
* `type` 用于 NodeAgent 的能力列表聚合；需要新类型时可以直接追加字符串。
* 若需要多版本，可在 `version` 字段描述，不再维护独立的 `current.json`。

---

### 2.2 运行时状态（ServiceRuntime）

由 Node 端进程管理模块（例如 `NodeServiceSupervisor`）维护：

```ts
export type ServiceRuntime = {
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  pid?: number;             // 进程 ID（若在 running）
  lastExitCode?: number;    // 上次退出码
  lastError?: string;       // 最近一次错误信息
};
```

说明：

* `status` 仅描述当前运行状态，不参与服务发现。
* 状态变化由统一的服务管理模块控制（start/stop）。

---

### 2.3 统一注册表（ServiceRegistry）

```ts
export type ServiceEntry = {
  def: ServiceDefinition;
  runtime: ServiceRuntime;
};

export type ServiceRegistry = Map<string, ServiceEntry>;  // key = def.id
```

特性：

* 内存结构，生命周期与节点进程一致。
* 启动时初始化一次。
* 点击「刷新服务」按钮后，会被新的扫描结果替换。

---

## 3. 服务发现流程（简化版）

### 3.1 目录结构约定

```text
node_root/
  services/
    asr_faster_whisper/
      service.json
      run.sh / run.bat / main.py ...
    semantic_repair/
      service.json
      ...
    tts_yourtts/
      service.json
      ...
```

服务包发布规范：

* 压缩包中包含一个目录，目录下包含 `service.json` 和其他运行文件。
* 用户将目录解压到 `services/` 下即可。

---

### 3.2 扫描函数 `scanServices()`

```ts
import * as fs from "fs";
import * as path from "path";

import { ServiceDefinition, ServiceEntry, ServiceRegistry } from "./ServiceTypes";

export async function scanServices(servicesRoot: string): Promise<ServiceRegistry> {
  const registry: ServiceRegistry = new Map();

  const entries = fs.readdirSync(servicesRoot, { withFileTypes: true });
  for (const dir of entries) {
    if (!dir.isDirectory()) continue;

    const serviceJsonPath = path.join(servicesRoot, dir.name, "service.json");
    if (!fs.existsSync(serviceJsonPath)) continue;

    const raw = fs.readFileSync(serviceJsonPath, "utf8");
    let def: ServiceDefinition;
    try {
      def = JSON.parse(raw);
    } catch (e) {
      console.error("[ServiceDiscovery] Invalid service.json:", serviceJsonPath, e);
      continue;
    }

    registry.set(def.id, {
      def,
      runtime: {
        status: "stopped"
      }
    });
  }

  console.log("[ServiceDiscovery] Scanned services:", Array.from(registry.keys()));
  return registry;
}
```

调用时机：

1. **节点端启动时**

   * 在主进程初始化阶段调用一次：

     ```ts
     let serviceRegistry = await scanServices(servicesRoot);
     ```
2. **用户点击「刷新服务」按钮**

   * IPC 调用 `scanServices()` 再次获取新 registry，并覆盖旧的内存结构。

---

## 4. 服务管理与 NodeAgent 的协作

### 4.1 NodeServiceSupervisor 与 ServiceRegistry

假设存在一个简化版的 `NodeServiceSupervisor`（或类似模块），负责：

* 按 `ServiceDefinition.exec` 启动与停止服务；
* 更新 `ServiceEntry.runtime.status` 与 `pid`；
* 将状态变更通过事件推送给 UI（可选）。

Supervisor 内部可以简单持有 `serviceRegistry` 引用：

```ts
class NodeServiceSupervisor {
  constructor(private registry: ServiceRegistry) {}

  listServices(): ServiceEntry[] {
    return Array.from(this.registry.values());
  }

  async startService(id: string) { /* 更新 runtime 并 spawn 进程 */ }

  async stopService(id: string) { /* kill 进程并更新 runtime */ }
}
```

> 注意：**Supervisor 不参与服务发现**，仅负责基于现有注册表进行启停与状态维护。

---

### 4.2 NodeAgent 使用 ServiceRegistry 生成注册与心跳数据

NodeAgent 的注册与心跳消息都不需要再单独扫描磁盘或计算服务列表，而是统一调用两个辅助函数：

```ts
type InstalledService = {
  service_id: string;
  type: string;
  device?: string;
  status: "running" | "stopped" | "error";
  version?: string;
};

export function buildInstalledServices(registry: ServiceRegistry): InstalledService[] {
  const result: InstalledService[] = [];

  for (const { def, runtime } of registry.values()) {
    result.push({
      service_id: def.id,
      type: def.type,
      device: def.device,
      status:
        runtime.status === "running"
          ? "running"
          : runtime.status === "error"
          ? "error"
          : "stopped",
      version: def.version
    });
  }

  return result;
}
```

心跳中服务信息可直接复用 `buildInstalledServices(registry)` 的结果。

如果需要构建按能力聚合的结构（例如按 type 聚合某类服务是否 ready），再基于上述结果做二次加工，而不是重新扫描文件系统。

---

## 5. UI 与「刷新服务」按钮逻辑

### 5.1 IPC 接口（主进程）

在主进程中注册两个 IPC handler：

```ts
import { ipcMain } from "electron";
import { scanServices } from "./ServiceDiscovery";
import { NodeServiceSupervisor } from "./NodeServiceSupervisor";

let registry: ServiceRegistry;
let supervisor: NodeServiceSupervisor;

export async function initServiceLayer(servicesRoot: string) {
  registry = await scanServices(servicesRoot);
  supervisor = new NodeServiceSupervisor(registry);

  ipcMain.handle("services:list", () => {
    return supervisor.listServices();
  });

  ipcMain.handle("services:refresh", async () => {
    registry = await scanServices(servicesRoot);
    supervisor = new NodeServiceSupervisor(registry); // 简单起见，重建 supervisor
    return supervisor.listServices();
  });

  ipcMain.handle("services:start", (_, id: string) => {
    return supervisor.startService(id);
  });

  ipcMain.handle("services:stop", (_, id: string) => {
    return supervisor.stopService(id);
  });
}
```

### 5.2 Renderer 侧逻辑（概念）

* 初始化时调用 `ipcRenderer.invoke("services:list")`，渲染服务列表；
* 用户点击「刷新服务」按钮：

  * 调用 `ipcRenderer.invoke("services:refresh")`，用返回的新列表覆盖本地 state；
* 用户点击「启动/停止」按钮：

  * 调用 `ipcRenderer.invoke("services:start" | "services:stop", id)`。

> UI 不再需要知道 `installed.json`、`current.json` 或其他管理器名称，所有展示信息均来自 `ServiceRegistry`。

---

## 6. 语义修复等特定类型服务的处理

对于语义修复、语音情感等特定类型服务，不再单独设计 Discovery 模块；统一使用 `ServiceDefinition.type` 进行筛选。

示例：

```ts
export function getSemanticRepairServices(registry: ServiceRegistry): ServiceEntry[] {
  return Array.from(registry.values()).filter(
    (entry) => entry.def.type === "semantic"
  );
}
```

* 语义修复服务管理模块只关心：

  * 哪些服务 `type === "semantic"`；
  * 它们是否运行中；
  * 如何调用它们的 HTTP/gRPC 接口。
* 服务发现本身**完全复用** `scanServices()`，不另起体系。

---

## 7. 需要删除 / 停用的旧逻辑（建议）

在不考虑兼容的前提下，推荐执行以下“收缩”操作：

1. **废弃 `installed.json` / `current.json` 作为强依赖**

   * 若需要，可临时保留为调试参考，但**不再由代码读写**。
   * 服务安装状态完全由目录与 `service.json` 决定。

2. **废弃或弱化复杂的 ServiceRegistryManager**

   * 如果原有 `ServiceRegistryManager` 主要职责是：

     * 读写 `installed.json` / `current.json`
     * 维护安装列表
   * 则可以：

     * 删除其读写文件逻辑；
     * 将「列出已安装服务」改为直接由 `ServiceRegistry` 提供。

3. **移除各处重复扫描 / 读取流程**

   * NodeAgent / SemanticRepair / UI Handler 等模块不再自行调用 `loadRegistry()` 或扫描文件。
   * 统一通过主进程持有的 `ServiceRegistry` 获取服务及其状态。

---

## 8. 改造 Task List（给开发用）

### P0：核心重构（必须）

* [ ] 新增 `ServiceTypes.ts`，定义：

  * `ServiceDefinition`
  * `ServiceRuntime`
  * `ServiceEntry`
  * `ServiceRegistry`
* [ ] 新增 `ServiceDiscovery.ts`，实现 `scanServices(servicesRoot): Promise<ServiceRegistry>`
* [ ] 在主进程初始化阶段，引入：

  * `let serviceRegistry = await scanServices(servicesRoot)`
* [ ] 新建 / 简化 `NodeServiceSupervisor`（或同类模块）：

  * 接收 `serviceRegistry` 引用；
  * 提供 `listServices()` / `startService(id)` / `stopService(id)`；
  * 更新 `ServiceRuntime` 状态。
* [ ] 在主进程注册 IPC：

  * `"services:list"`：返回 `supervisor.listServices()`；
  * `"services:refresh"`：重新 `scanServices()` 覆盖 `serviceRegistry`，重建 `supervisor`；
  * `"services:start"` / `"services:stop"`：调用 `supervisor` 对应方法。
* [ ] 在 NodeAgent 中引入 `buildInstalledServices(registry)`：

  * 注册与心跳都改为使用该函数的结果，不再自行读取任何 JSON 文件。

### P1：语义修复等特定服务的统一化（重要）

* [ ] 移除 / 弱化单独的 `SemanticRepairServiceDiscovery`，改为：

  * 提供 `getSemanticRepairServices(registry)` 工具函数，基于 `type === "semantic"` 过滤。
* [ ] 所有语义修复相关模块从 `ServiceRegistry` 获取服务列表，不再独立扫描目录或读 JSON。

### P2：清理与文档（建议）

* [ ] 清理旧的 `installed.json` / `current.json` 写入逻辑，避免后续误用。
* [ ] 在 README / 开发文档中说明新流程：

  * 服务安装方式：解压到 `services/`；
  * 编辑 `service.json` 即可配置服务；
  * 刷新方式：节点 UI 上点击「刷新服务」按钮。
* [ ] 为 `ServiceDiscovery` 和 `NodeServiceSupervisor` 写简单单元测试：

  * 服务目录扫描结果验证；
  * 服务启动/停止状态更新验证。

---

## 9. 总结

通过本次简化改造，节点端服务发现与服务管理将具备以下特性：

* **代码结构直观：**

  * 一个 `ServiceRegistry` 负责服务定义与状态；
  * 一个 `scanServices()` 负责服务发现；
  * 一个 Supervisor 负责启停和状态更新；
  * NodeAgent + UI 都只读这一份 Registry。

* **开包即用：**

  * 服务包解压 → `service.json` 就绪 → 点击「刷新服务」 → 立即生效。

* **易排查问题：**

  * 出现服务缺失 / 类型错误时，只需要检查：

    * `services/*/service.json` 内容是否正确；
    * `scanServices()` 是否被正确调用；
    * `ServiceRegistry` 中是否包含该服务 ID。

本方案不依赖任何历史兼容逻辑，适合当前「未上线、没有用户、优先简洁」的项目状态使用。

```
```
