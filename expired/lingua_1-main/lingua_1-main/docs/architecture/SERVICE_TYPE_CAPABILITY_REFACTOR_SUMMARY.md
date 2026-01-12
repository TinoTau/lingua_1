# ServiceType 能力重构总结

**版本**: v2.0  
**完成日期**: 2025-01-XX  
**状态**: ✅ 已完成

---

## 1. 改造概述

### 1.1 改造目标

将调度与能力判断从 `service_id` 粒度升级为 **ServiceType 粒度**，实现：
- 调度端只关心 ServiceType 是否可用，不再关心具体 service_id
- Node 端负责选择同类型实现（可随机/一致性随机/加权），实现热插拔
- Pool 配置稳定：仅声明"需要哪些类型"，不会因实现更换而频繁修改
- 可观测性增强：按 type 输出"缺失原因"，排障链路更短

### 1.2 改造性质

- **一次性破坏性重构**：无兼容、无过渡、无废弃字段保留
- **协议事实源**：`messages.ts / messages.js`
- **影响范围**：Node、Scheduler、协议层

---

## 2. 改造前架构（service_id 粒度）

### 2.1 现状问题

- 调度 / Pool 对具体 `service_id` 产生强耦合，新增或替换实现需要修改调度端逻辑与配置
- 同一能力（ASR/NMT/TTS/TONE）存在多实现时，调度端需要感知实现细节，复杂度与错误面扩大
- 能力可用性判断不清晰：CPU/GPU、running/stopped、健康/不健康等边界口径不统一，导致 Pool 命中不可解释

### 2.2 原有协议

```typescript
// 旧协议（已废弃）
interface NodeHeartbeat {
  installed_services: string[];  // service_id 列表
  capability_state: Record<string, ModelStatus>;  // service_id → status
}

// 调度端需要知道具体 service_id
required_models: ["node-inference", "nmt-m2m100", "piper-tts"]
```

---

## 3. 改造后架构（ServiceType 粒度）

### 3.1 ServiceType 定义

系统中"可被调度的能力类别"，定义四类：

- **ASR**：语音识别
- **NMT**：机器翻译
- **TTS**：语音合成
- **TONE**：语气/情感/风格（可选能力）

### 3.2 服务映射

| ServiceType | 实现（service_id） |
|------------|-------------------|
| **ASR** | faster-whisper-vad, node-inference |
| **NMT** | nmt-m2m100 |
| **TTS** | piper-tts, your-tts |
| **TONE** | speaker-embedding, your-tts（可选） |

### 3.3 新协议结构

```typescript
// 新协议
export enum ServiceType {
  ASR = "asr",
  NMT = "nmt",
  TTS = "tts",
  TONE = "tone",
}

export type DeviceType = "gpu" | "cpu";
export type ServiceStatus = "running" | "stopped" | "error";

export interface InstalledService {
  service_id: string;
  type: ServiceType;
  device: DeviceType;
  status: ServiceStatus;
  version?: string;
}

export interface CapabilityByType {
  type: ServiceType;
  ready: boolean;
  reason?: string;  // ready=false 时必须提供
  ready_impl_ids?: string[];  // 满足 ready 的 service_id 列表（GPU+running）
}

export interface NodeHeartbeat {
  node_id: string;
  installed_services: InstalledService[];
  capability_by_type: CapabilityByType[];
  capability_schema_version: "2.0";  // 必需，必须为 "2.0"
}
```

### 3.4 能力可用性判断规则

**本次口径**：
> 对某 ServiceType，只要 **至少一个 GPU 实现处于 running 状态**，则 `ready=true`。  
> 其余情况 `ready=false` 并给出 reason。

**Reason 枚举**：
- `no_impl`：该类型没有安装任何实现
- `no_running_impl`：该类型有安装但无运行中的实现
- `only_cpu_running`：该类型只有 CPU 实现运行中
- `gpu_impl_not_running`：该类型有 GPU 实现但未运行
- `missing_capability_entry`：节点未上报该类型的能力信息

---

## 4. 改造实施过程

### 4.1 阶段1：协议重构

**任务**：
- 修改 `messages.ts`：新增 ServiceType、InstalledService、CapabilityByType
- 删除旧字段：`required_services`、`capability_by_service_id`、`installed_models`、`capability_state`
- 同步 `messages.js`（若为生成物则走构建产出）

**验收**：
- ✅ Node / Scheduler 编译通过
- ✅ 心跳 payload 可序列化/反序列化

### 4.2 阶段2：Node 端改造

**任务**：
1. **InstalledService 清单生成**：
   - 实现 service_id → ServiceType 映射
   - 生成 `installed_services` 列表（包含 type、device、status）

2. **capability_by_type 聚合计算**：
   - 按 type 聚合 installed_services
   - ready 判定仅 GPU+running
   - 输出 reason + ready_impl_ids

3. **心跳上报改造**：
   - Heartbeat payload 按新协议发送 `installed_services` + `capability_by_type`
   - 包含 `capability_schema_version: "2.0"`
   - 删除旧字段上报

4. **ServiceType → Implementation 选择器**：
   - candidates = type+gpu+running
   - selected = hash(job_id) % candidates.length（一致性随机）

5. **执行链路接入选择器**：
   - 在执行每个 job 前选择 impl
   - 记录 job_id/type/selected_service_id/candidates_count

**验收**：
- ✅ ready 口径正确（仅 GPU+running）
- ✅ 多实现可分摊且可追踪
- ✅ 心跳包含新字段且格式正确

### 4.3 阶段3：Scheduler 端改造

**任务**：
1. **Heartbeat 解析与存储更新**：
   - 解析并存储 `installed_services`、`capability_by_type`
   - 删除旧字段解析与存储
   - 验证 `capability_schema_version` 必须为 "2.0"

2. **features → required_types 生成函数替换**：
   - 默认 ASR+NMT+TTS，TONE 可选
   - 删除旧 `required_models`/`required_services` 逻辑

3. **节点过滤逻辑改为按 type**：
   - eligible = ∀type: `capability_by_type[type].ready==true`
   - 缺失条目视为 `missing_capability_entry`

4. **Pool schema 改为 required_types**：
   - 重写 PoolConfig：`required_types: ServiceType[]`
   - 删除 `required_services` 配置、解析与校验

5. **不可调度原因输出**：
   - 当 pool miss / node miss 时输出 `missing_types` 与 `reason`
   - reason 优先 node 上报，否则 `missing_capability_entry`

**验收**：
- ✅ 不再引用 service_id 做调度判断
- ✅ pool miss 可解释
- ✅ 日志/metrics 按 type 输出

### 4.4 阶段4：测试与验证

**测试内容**：
1. **Node 单测**：
   - `computeCapabilityByType` 覆盖所有 reason 场景
   - `selectImpl` 覆盖 candidates=0 和 hash 一致性

2. **Scheduler 单测**：
   - `eligible(node, required_types)` 覆盖缺失/ready=false
   - `poolMatch` 逻辑正确
   - `missing_types` 输出正确

3. **集成测试**：
   - 单节点单实现/多实现
   - 多节点不同缺失类型
   - error/stopped 场景
   - Pool 测试：配置按 type 的 pool，验证分桶与 fallback

---

## 5. 改造结果

### 5.1 协议变更

**删除的字段**：
- ❌ `installed_models: InstalledModel[]`
- ❌ `capability_state: Record<string, ModelStatus>`
- ❌ `required_services: string[]`
- ❌ `required_models: string[]`

**新增的字段**：
- ✅ `installed_services: InstalledService[]`（包含 type、device、status）
- ✅ `capability_by_type: CapabilityByType[]`
- ✅ `capability_schema_version: "2.0"`（必需）

### 5.2 Node 端变更

**新增功能**：
- ✅ `getInstalledServices()`：生成 InstalledService 列表
- ✅ `getCapabilityByType()`：聚合 capability_by_type
- ✅ ServiceType → Implementation 选择器（一致性随机）
- ✅ 服务状态变化时立即触发心跳更新

**修改功能**：
- ✅ `sendRegisterNode()`：发送新格式的注册消息
- ✅ `sendHeartbeatOnce()`：发送新格式的心跳消息
- ✅ 移除对旧字段的依赖

### 5.3 Scheduler 端变更

**新增功能**：
- ✅ `get_required_types_for_features()`：features → required_types
- ✅ `node_has_installed_types()`：按 type 检查节点是否有安装
- ✅ `node_has_required_types_ready()`：按 type 检查节点是否 ready
- ✅ `select_node_with_types_*()`：按 type 选择节点

**修改功能**：
- ✅ `NodeRegistry`：存储 `installed_services` 和 `capability_by_type`
- ✅ `Phase3PoolConfig`：`required_services` → `required_types`
- ✅ `determine_pool_for_node()`：按 type 匹配 Pool
- ✅ 日志/metrics：从 service_id 改为 type

**删除功能**：
- ❌ `get_required_models_for_features()`
- ❌ `node_has_installed_services()`
- ❌ `node_has_required_services_ready()`
- ❌ `select_node_with_models_*()`

### 5.4 验证结果

**Go/No-Go 验收清单**：
- ✅ messages.ts 中不再出现 `required_services` / `capability_by_service_id` 等旧字段
- ✅ Node heartbeat 必含 `installed_services` + `capability_by_type`
- ✅ Node heartbeat 必含 `capability_schema_version: "2.0"`
- ✅ Scheduler 调度逻辑仅依赖 `required_types` + `capability_by_type`
- ✅ Pool 仅配置 `required_types`
- ✅ Node 能选择同 type 的具体 impl 并记录 selected_service_id
- ✅ pool miss / node miss 可输出 `missing_types` 与 `reason`

---

## 6. 改造收益

### 6.1 架构优势

1. **解耦**：
   - 调度端不再依赖具体 service_id
   - 新增或替换实现无需修改调度端逻辑

2. **扩展性**：
   - Pool 配置稳定：仅声明"需要哪些类型"
   - 新增同类型服务包开包即用，无需修改核心代码

3. **可观测性**：
   - 按 type 输出"缺失原因"，排障链路更短
   - 日志/metrics 更清晰

### 6.2 功能优势

1. **热插拔**：
   - 同类型多实现支持热插拔
   - Node 端负责选择同类型实现（一致性随机）

2. **灵活性**：
   - 支持同类型多实现同时运行
   - 支持服务级别的负载均衡和故障转移

---

## 7. 相关文档

### 7.1 实施文档

- [ServiceType Capability 重构实施方案](./ServiceType_Capability_重构实施方案_一次性切换版_v1.0_含JIRA任务.md) - 详细实施方案（含JIRA任务列表）

### 7.2 架构文档

- [服务类型化能力改造方案](./SERVICE_TYPE_CAPABILITY_REDESIGN.md) - 改造方案概述
- [节点服务独立性重构方案 - 决策文档](./NODE_SERVICE_INDEPENDENCE_REFACTOR_DECISION.md) - 节点服务独立运行方案

### 7.3 相关实现

- **Node 端**：`electron_node/electron-node/main/src/agent/node-agent.ts`
- **Scheduler 端**：`central_server/scheduler/src/node_registry/`
- **协议定义**：`shared/protocols/messages.ts`

---

## 8. 注意事项

### 8.1 版本要求

- **capability_schema_version** 必须为 "2.0"
- Scheduler 严格验证，不接受 "1.0" 或缺失版本
- Node 端必须发送 `capability_schema_version: "2.0"`

### 8.2 向后兼容

- **无向后兼容**：本次改造为一次性破坏性重构
- 旧版本节点无法与新版本调度服务器通信
- 需要同时升级 Node 和 Scheduler

### 8.3 迁移建议

- 所有节点必须升级到支持 ServiceType 的版本
- Pool 配置需要一次性迁移到 `required_types`
- 监控和告警需要更新为按 type 输出

---

**文档结束**

