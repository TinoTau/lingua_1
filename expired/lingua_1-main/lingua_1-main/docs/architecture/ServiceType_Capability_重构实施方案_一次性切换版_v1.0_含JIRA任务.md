# ServiceType Capability 重构实施方案（一次性切换版）v1.0
（含 Node / Scheduler 分工与 JIRA Task 列表）

> 适用对象：Scheduler / Node / 协议层开发与评审  
> 改造性质：一次性破坏性重构（无兼容、无过渡、无废弃字段保留）  
> 协议事实源：`messages.ts / messages.js`（本次改造以其为最终传输协议定义）  
> 目标：将调度与能力判断从 `service_id` 粒度升级为 **ServiceType 粒度**，并将“同类型多实现选择”下沉到 Node。

---

## 0. 背景与动机

### 0.1 当前痛点
- 调度 / Pool 对具体 `service_id` 产生强耦合，新增或替换实现需要修改调度端逻辑与配置。
- 同一能力（ASR/NMT/TTS/TONE）存在多实现时，调度端需要感知实现细节，复杂度与错误面扩大。
- 能力可用性判断不清晰：CPU/GPU、running/stopped、健康/不健康等边界口径不统一，导致 Pool 命中不可解释。

### 0.2 改造收益（目标态优势）
- **调度端只关心 ServiceType 是否可用**，不再关心具体 service_id。
- Node 端负责选择同类型实现（可随机/一致性随机/加权），实现热插拔。
- Pool 配置稳定：仅声明“需要哪些类型”，不会因实现更换而频繁修改。
- 可观测性增强：按 type 输出“缺失原因”，排障链路更短。

---

## 1. 范围与非目标

### 1.1 范围（In Scope）
- 传输协议字段（messages.ts）重构：新增 ServiceType 能力聚合结构，删除 service_id 粒度能力字段。
- Node：实现扫描、聚合 capability_by_type、同类型多实现选择器、上报心跳。
- Scheduler：按 required_types 过滤节点、Pool 按 required_types 匹配、失败原因按 type 输出。
- Job 需求解析：features → required_types 的映射。

### 1.2 非目标（Out of Scope）
- 不在本阶段引入复杂调度算法（如全局最优、学习型调度）。
- 不在本阶段引入多实例 owner/跨实例投递（与本改造可并行但不是必要条件）。
- 不在本阶段引入自动模型下载/安装/升级流程（可由 Node 侧另行推进）。

---

## 2. 术语与核心概念（统一口径）

### 2.1 ServiceType（能力类型）
系统中“可被调度的能力类别”。本次定义四类：
- ASR：语音识别
- NMT：机器翻译
- TTS：语音合成
- TONE：语气/情感/风格（可选能力）

### 2.2 Implementation（实现 / Impl）
同一 ServiceType 下的某个“具体实现”，例如：
- ASR：whisper-large-v3、faster-whisper、whisper.cpp
- NMT：marian-zh-en、nllb、m2m100
- TTS：yourtts、vits、fastspeech2

Implementation 由 `service_id` 标识，且具备运行状态、设备信息等元数据。

### 2.3 Capability（可用性）
对调度而言，我们只需要判断某个 type 是否“可用（ready）”。

**本次口径：**
> 对某 ServiceType，只要 **至少一个 GPU 实现处于 running 状态**，则 `ready=true`。  
> 其余情况 `ready=false` 并给出 reason。

---

## 3. 协议设计（最终态，无兼容）

> 以下为协议“目标结构”。实际落地以 messages.ts 中的类型/字段命名为准。  
> 要求：删除所有旧的 `required_services`、`capability_by_service_id`、调度侧依赖 service_id 的字段。

### 3.1 枚举定义
```ts
export enum ServiceType {
  ASR = "asr",
  NMT = "nmt",
  TTS = "tts",
  TONE = "tone",
}

export type DeviceType = "gpu" | "cpu";
export type ServiceStatus = "running" | "stopped" | "error";
```

### 3.2 InstalledService（实现明细）
```ts
export interface InstalledService {
  service_id: string;
  type: ServiceType;
  device: DeviceType;
  status: ServiceStatus;

  // 建议字段（可选但强烈建议，便于观测/排障/排序）
  version?: string;
  model_id?: string;
  engine?: string;
  mem_mb?: number;
  warmup_ms?: number;
  last_error?: string;
}
```

### 3.3 CapabilityByType（聚合能力）
```ts
export interface CapabilityByType {
  type: ServiceType;
  ready: boolean;
  reason?: string;             // ready=false 时必须提供

  // 建议字段：用于可观测与排障，但调度不依赖
  ready_impl_ids?: string[];   // 满足 ready 的 service_id 列表（GPU+running）
}
```

### 3.4 NodeHeartbeat（Node → Scheduler）
```ts
export interface NodeHeartbeat {
  node_id: string;
  installed_services: InstalledService[];
  capability_by_type: CapabilityByType[];

  // 建议字段：便于调度容量规划（可选）
  gpu_name?: string;
  gpu_vram_mb?: number;
  cpu_cores?: number;
  ram_mb?: number;
}
```

### 3.5 Job Requirement（Scheduler 内部与可选下发字段）
```ts
export interface JobRequirement {
  required_types: ServiceType[];
}
```

---

## 4. Node 侧实现方案（技术细节）

### 4.1 installed_services 的生成
建议优先采用 **静态配置文件**（JSON/YAML）作为第一版，原因：
- 改造期快速落地、可控性强
- 便于模拟 status/device 场景做联调
- 后续再扩展为模型库扫描或服务发现机制

输出必须满足协议字段：`service_id/type/device/status`。

---

### 4.2 聚合 capability_by_type（关键逻辑）
伪代码（实现语言可为 Rust/TS，逻辑一致）：
```ts
function computeCapabilityByType(installed: InstalledService[]): CapabilityByType[] {
  const types = [ASR, NMT, TTS, TONE];
  const res = [];

  for (const t of types) {
    const runningGpu = installed.filter(s => s.type === t && s.device === "gpu" && s.status === "running");
    if (runningGpu.length > 0) {
      res.push({ type: t, ready: true, ready_impl_ids: runningGpu.map(x => x.service_id) });
      continue;
    }

    // reason 生成（建议枚举化）
    const anyInstalled = installed.some(s => s.type === t);
    const anyRunning = installed.some(s => s.type === t && s.status === "running");
    const anyGpu = installed.some(s => s.type === t && s.device === "gpu");

    let reason = "no_impl";
    if (anyInstalled && !anyRunning) reason = "no_running_impl";
    else if (anyInstalled && anyRunning && !anyGpu) reason = "only_cpu_running";
    else if (anyInstalled && anyGpu && !anyRunning) reason = "gpu_impl_not_running";

    res.push({ type: t, ready: false, reason });
  }

  return res;
}
```

---

### 4.3 同类型多实现选择器（Node 内部）
**最低要求：一致性随机（推荐默认）**
```ts
function selectImpl(type: ServiceType, job_id: string, installed: InstalledService[]): string {
  const candidates = installed
    .filter(s => s.type === type && s.device === "gpu" && s.status === "running");
  if (candidates.length === 0) throw new Error("no_candidate_impl");
  const idx = hash(job_id) % candidates.length;
  return candidates[idx].service_id;
}
```

**必须日志**
- `node_id, job_id, service_type, selected_service_id, candidates_count`
- 建议追加：推理耗时 / 排队耗时

---

## 5. Scheduler 侧实现方案（技术细节）

### 5.1 required_types 生成（features → types）
规则固化：
- 默认：`[ASR, NMT, TTS]`
- TONE：feature 显式开启才加入

```ts
function getRequiredTypesForFeatures(features: FeatureFlags): ServiceType[] {
  const required = [ServiceType.ASR, ServiceType.NMT, ServiceType.TTS];
  if (features.enable_tone === true) required.push(ServiceType.TONE);
  return required;
}
```

---

### 5.2 Node 过滤（Eligibility）
Node 可选 iff：
- 对每个 required_type：
  - `capability_by_type[type].ready === true`

缺失条目等同 ready=false（reason=missing_capability_entry）。

---

### 5.3 Pool 匹配（按 type）
Pool schema：
```ts
interface PoolConfig {
  pool_id: string;
  required_types: ServiceType[];
}
```
匹配逻辑与 Node 过滤一致。

---

### 5.4 不可调度原因输出（统一格式）
输出结构（日志/返回体按你们系统规范落地）：
```json
{
  "missing_types": ["tts"],
  "detail": {
    "tts": "gpu_impl_not_running"
  }
}
```

---

## 6. 实施步骤（一次性切换，无废弃字段）

### Step 1：协议一次性重构（必须先做）
- 修改 messages.ts：
  - 新增 ServiceType / InstalledService / CapabilityByType / NodeHeartbeat
  - 删除旧字段与旧类型
- 同步 messages.js（若为生成物则走构建产出）

**验收**
- Node / Scheduler 编译通过
- 心跳 payload 可序列化/反序列化

---

### Step 2：Node 完成能力上报与选择器
- installed_services 生成
- capability_by_type 聚合
- 心跳上报新字段
- job 执行调用选择器并记录日志

**验收**
- ready 口径正确（仅 GPU+running）
- 多实现可分摊且可追踪

---

### Step 3：Scheduler 完成按 type 调度
- required_types 替换旧逻辑
- node/pool 匹配按 type
- 输出 missing_types 与 reason

**验收**
- 不再引用 service_id 做调度判断
- pool miss 可解释

---

### Step 4：联调与回归（必做）
- 单节点单实现/多实现
- 多节点不同缺失类型
- error/stopped 场景

---

## 7. 测试与质量保障（必须）

### 7.1 Node 单测
- computeCapabilityByType 覆盖：
  - no_impl
  - no_running_impl
  - only_cpu_running
  - gpu_impl_not_running
- selectImpl 覆盖：
  - candidates=0 报错
  - hash 一致性

### 7.2 Scheduler 单测
- eligible(node, required_types)：
  - 缺失条目视为不可选
  - ready=false 不可选
- poolMatch 逻辑正确
- missing_types 输出正确

### 7.3 集成测试（推荐）
- JSON fixtures（固定心跳样本）验证：
  - 节点筛选结果
  - pool miss 原因一致

---

## 8. JIRA Task 列表（Node / Scheduler / Protocol 分工）

> 以下为建议拆分与描述，可直接导入 JIRA（或手工创建）。  
> 估时为粗略人日（d）。

### 8.1 Protocol

**PROTO-1：messages.ts 协议一次性重构**
- Component：Protocol
- Description：
  - 定义 ServiceType、InstalledService、CapabilityByType、NodeHeartbeat、JobRequirement（最终态）
  - 删除所有旧 capability/service_id 依赖字段与类型
  - 更新 messages.js（若为生成物则确保构建可产出）
- Acceptance Criteria：
  - Node/Scheduler 编译通过
  - 心跳 JSON 可序列化/反序列化
  - 代码库中不再引用 removed types/fields
- Estimate：1–2d
- Dependencies：None（第一优先级）

**PROTO-2：协议示例与 reason 枚举文档**
- Component：Protocol
- Description：
  - 输出 NodeHeartbeat 示例 JSON（ready/非 ready 各 1）
  - 输出 reason 推荐枚举（no_impl/no_running_impl/only_cpu_running/gpu_impl_not_running/missing_capability_entry）
- Acceptance Criteria：
  - 联调人员可直接用示例构造测试数据
- Estimate：0.5–1d
- Dependencies：PROTO-1

---

### 8.2 Node

**NODE-1：InstalledService 清单生成（第一版用静态配置）**
- Component：Node
- Description：
  - 新增 services 配置文件（JSON/YAML）描述 installed_services
  - 输出字段：service_id/type/device/status (+可选元数据)
- Acceptance Criteria：
  - 可生成 InstalledService[]
  - 可通过配置模拟多实现/不同 device/status
- Estimate：1–2d
- Dependencies：PROTO-1

**NODE-2：capability_by_type 聚合计算**
- Component：Node
- Description：
  - 按 type 聚合 installed_services
  - ready 判定仅 GPU+running
  - 输出 reason + ready_impl_ids（建议）
- Acceptance Criteria：
  - 单测覆盖四类 reason
  - ready_impl_ids 输出正确
- Estimate：1–2d
- Dependencies：NODE-1

**NODE-3：心跳上报改造（新字段）**
- Component：Node
- Description：
  - Heartbeat payload 按新协议发送 installed_services + capability_by_type
  - 删除旧字段上报
- Acceptance Criteria：
  - Scheduler 可正确解析
  - wire payload 不含旧字段
- Estimate：0.5–1d
- Dependencies：NODE-2

**NODE-4：ServiceType → Implementation 选择器（一致性随机）**
- Component：Node
- Description：
  - candidates = type+gpu+running
  - selected = hash(job_id) % candidates.length
- Acceptance Criteria：
  - 同 job_id 多次选择一致
  - candidates>1 时分摊
  - candidates=0 明确报错
- Estimate：1–2d
- Dependencies：NODE-1

**NODE-5：执行链路接入选择器 + 关键日志**
- Component：Node
- Description：
  - 在执行每个 job 前选择 impl
  - 记录 job_id/type/selected_service_id/candidates_count
- Acceptance Criteria：
  - 日志可追踪到每个 job 实际实现
- Estimate：1–2d
- Dependencies：NODE-4

**NODE-6：联调调试开关（dev 模式模拟 status 变化）**
- Component：Node
- Description：
  - 提供 dev-only 接口或命令切换某 impl status
  - 便于验证 capability_by_type 动态变化
- Acceptance Criteria：
  - 切换后下一次心跳反映变化
- Estimate：0.5–1d
- Dependencies：NODE-2

---

### 8.3 Scheduler

**SCH-1：Heartbeat 解析与存储更新**
- Component：Scheduler
- Description：
  - 解析并存储 installed_services、capability_by_type
  - 删除旧字段解析与存储
- Acceptance Criteria：
  - 新字段可入库/入内存结构
  - 旧字段无引用
- Estimate：1–2d
- Dependencies：PROTO-1

**SCH-2：features → required_types 生成函数替换**
- Component：Scheduler
- Description：
  - 默认 ASR+NMT+TTS，TONE 可选
  - 删除旧 required_models/required_services 逻辑
- Acceptance Criteria：
  - 所有 job 创建入口使用 required_types
- Estimate：0.5–1d
- Dependencies：SCH-1

**SCH-3：节点过滤逻辑改为按 type**
- Component：Scheduler
- Description：
  - eligible = ∀type: capability_by_type[type].ready==true
  - 缺失条目视为 missing_capability_entry
- Acceptance Criteria：
  - 单测覆盖缺失/ready=false
- Estimate：1–2d
- Dependencies：SCH-2

**SCH-4：Pool schema 改为 required_types**
- Component：Scheduler
- Description：
  - 重写 PoolConfig：required_types
  - 删除 required_services 配置、解析与校验
- Acceptance Criteria：
  - 全部 pool 配置可加载
  - pool match 按 type
- Estimate：1–2d
- Dependencies：SCH-3

**SCH-5：不可调度原因输出（missing_types + detail）**
- Component：Scheduler
- Description：
  - 当 pool miss / node miss 时输出 missing_types 与 reason
  - reason 优先 node 上报，否则 missing_capability_entry
- Acceptance Criteria：
  - 日志/返回体可解释，可用于排障与统计
- Estimate：1–2d
- Dependencies：SCH-3，SCH-4

**SCH-6：回归测试 fixtures（JSON 样本）**
- Component：Scheduler
- Description：
  - 固定心跳样本覆盖：全 ready/缺 ASR/缺 TTS/only_cpu/gpu stopped/error
  - 验证调度结果与 missing_types 输出一致
- Acceptance Criteria：
  - CI 可跑通
- Estimate：1–2d
- Dependencies：SCH-5，PROTO-2

---

## 9. 里程碑（建议）

- M1：PROTO-1 完成（协议编译通过）
- M2：NODE-3 + SCH-1 完成（心跳新字段全链路通）
- M3：SCH-3/4/5 完成（调度与 Pool 全按 type）
- M4：NODE-5 完成（执行链路按 type 选择 impl）
- M5：SCH-6 + 联调压测完成（可验收）

---

## 10. 最终 Go/No-Go 验收清单
- [ ] messages.ts 中不再出现 required_services / capability_by_service_id 等旧字段
- [ ] Node heartbeat 必含 installed_services + capability_by_type
- [ ] Scheduler 调度逻辑仅依赖 required_types + capability_by_type
- [ ] Pool 仅配置 required_types
- [ ] Node 能选择同 type 的具体 impl 并记录 selected_service_id
- [ ] pool miss / node miss 可输出 missing_types 与 reason

---

**文档结束**
