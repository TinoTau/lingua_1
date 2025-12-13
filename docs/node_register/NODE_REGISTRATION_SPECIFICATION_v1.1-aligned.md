# NODE REGISTRATION SPECIFICATION v1.1-aligned
## Third-Party Node Registration (Implementation-Aligned)

版本：v1.1-aligned  
状态：**可直接开发（与现有实现对齐）**  
适用范围：Third-Party Client（Electron Node） / Scheduler / Web UI  
强制前提：**GPU 为注册硬性要求（v1.x 冻结，不可降级）**

---

## 0. 文档定位说明（重要）

本规范是在 **NODE_REGISTRATION_SPECIFICATION v1.1** 的基础上，
结合现有稳定实现与开发部门可行性评估，形成的 **implementation-aligned 版本**。

原则如下：

- **架构语义不回退**（GPU 强制、NodeStatus、注册 ≠ 可调度）
- **协议 wire format 向现有实现靠拢**
- 新能力采用 **软引入（optional / default）**
- 避免对已有稳定代码造成破坏性修改

本文件作为 **当前开发与联调的唯一参考文档（SSOT）**。

---

## 1. 设计原则（冻结）

- Node 为被动注册方，Scheduler 为唯一权威
- Node 注册仅表示 **能力声明完成**
- 是否参与调度、何时参与调度，由 Scheduler 决定
- **GPU 为 v1.x 强制要求**
- UI 仅展示状态，不参与协议判断
- 允许多 GPU Node，但 **至少一张 GPU 必须可用**

---

## 2. Node 生命周期状态机（核心，不回退）

### 2.1 NodeStatus（Scheduler 权威）

```text
registering   // 已完成注册，尚未参与调度
ready         // 已就绪，可被调度
degraded      // 能力下降（模型缺失 / GPU 异常）
draining      // 准备下线，不再接新任务
offline       // 心跳丢失或主动下线
```

### 2.2 状态规则

- node_register_ack ≠ ready
- **仅 status=ready 的 Node 进入调度池**
- NodeStatus 只能由 Scheduler 维护
- Node / UI 不得自行声明状态

---

## 3. 注册协议（对齐现有实现）

### 3.1 node_register（Node → Scheduler）

```json
{
  "type": "node_register",
  "version": "1.0.0",
  "capability_schema_version": "1.0",
  "node_id": "optional-client-id",
  "hardware": {
    "gpus": [
      {
        "name": "RTX 4090",
        "memory_gb": 24
      }
    ],
    "cpu_cores": 16,
    "memory_gb": 64
  },
  "accept_public_jobs": true,
  "installed_models": [
    {
      "model_id": "whisper-large-v3",
      "version": "1.0.0",
      "enabled": true
    }
  ],
  "advanced_features": [
    "batched_inference",
    "kv_cache"
  ]
}
```

### 3.2 GPU 强制规则（冻结）

- `hardware.gpus` 必须存在且长度 ≥ 1
- 任一 GPU `memory_gb > 0`
- 否则注册失败：`node_error(GPU_REQUIRED)`
- **不允许 CPU-only Node 注册（v1.x 不变）**

---

## 4. node_register_ack（Scheduler → Node）

```json
{
  "type": "node_register_ack",
  "node_id": "node_8f92ab",
  "status": "registering"
}
```

说明：

- node_id 为 Scheduler 最终裁定
- status 初始恒为 registering
- 后续状态变化通过 node_status / ui_event 下发

---

## 5. capability_schema_version（软引入）

### 5.1 语义

- 描述 node_register payload 的结构版本
- 与客户端版本（version）解耦

### 5.2 兼容策略

- 可选字段
- 缺失时默认视为 `"1.0"`
- 不支持的版本 → `node_error(INVALID_CAPABILITY_SCHEMA)`

---

## 6. accept_public_jobs 的调度语义（冻结）

```text
true  → 可进入公共调度池
false → 不参与公共调度，仅用于私有 / 指定任务
```

该字段在注册后即写入 Scheduler 的 capability state。

---

## 7. advanced_features 的语义（调整说明）

- `advanced_features` 用于描述 **非基础能力**
  - 如 batched inference、kv cache、streaming tts
- **基础能力（ASR / NMT / TTS）不通过该字段声明**
- Scheduler 通过 `installed_models` 推断基础能力

---

## 8. node_id 冲突处理（规范保留，分阶段实现）

### 8.1 原则

- Scheduler 不信任客户端提供的 node_id
- node_id 仅作为“建议值”

### 8.2 冲突处理（v1.1-aligned）

- 若 node_id 已存在：
  - 可先拒绝注册：`NODE_ID_CONFLICT`
  - 或要求客户端清除本地 node_id 后重试
- 硬件指纹绑定为 **v2+ 扩展项**

---

## 9. installed_models 状态说明（非强制）

```json
{
  "model_id": "whisper-large-v3",
  "version": "1.0.0",
  "enabled": true,
  "status": "ready"
}
```

- v1.x：status 可忽略，默认 ready
- v2+：由 ModelManager 动态上报

---

## 10. UI 约束（冻结）

- UI 只读展示：
  - NodeStatus
  - GPU / 模型信息
- UI 不得：
  - 修改 NodeStatus
  - 直接干预调度逻辑
- “重试注册” = 再次发送 node_register

---

## 11. 重要声明（重申）

> **Node 注册 ≠ Node 上线 ≠ 可调度**

- 注册成功：能力声明完成
- 是否调度：由 Scheduler 决定
- 该规则为 v1.x 不可回退约束

---

## 12. 验收标准（开发对齐）

- 无 GPU → 注册失败
- 多 GPU Node → 允许注册
- 注册后初始状态 = registering
- status=ready 才能接任务
- accept_public_jobs=false 不进入公共池
- advanced_features 不影响基础能力判断

---

**END OF NODE REGISTRATION SPEC v1.1-aligned**
