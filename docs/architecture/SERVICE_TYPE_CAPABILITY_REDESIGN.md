# 服务类型化能力改造方案（ASR/NMT/TTS/TONE）

## 背景
- 现状：调度以具体服务包 `service_id`（如 `node-inference`、`nmt-m2m100`、`piper-tts`）为粒度进行健康检查、Pool 匹配和节点选择。节点心跳上报 `installed_services` 与 `capability_state`（均按 service_id）。
- 诉求：改为按“类型”维度判断可用性，类型枚举：`ASR`、`NMT`、`TTS`、`TONE`。同类型下的多个实现支持热插拔，接口/协议一致。节点选择时只需确认类型可用；同类型多实现时随机选（仅 GPU 启动的服务）。
- 给定映射：`ASR`→ faster_whisper_vad、node-inference；`NMT`→ nmt_m2m100；`TTS`→ piper_tts；`TONE`→ speaker_embedding、your_tts（可选）。

## 现状架构与关键实现（service_id 粒度）
- 心跳（Node → Scheduler）
  - `installed_services`: 只含当前 ready 的服务，字段为 `service_id`。
  - `capability_state`: `service_id` → `ready/not_installed`。
- 节点选择（Scheduler）
  - 解析 pipeline/features 得到必需 `required_models`（核心三件：ASR=node-inference，NMT=nmt-m2m100，TTS=piper-tts）。
  - 过滤条件：`status==Ready`、online、有 GPU、`installed_services` 覆盖 required_models、`capability_state` 全部 `Ready`、容量/资源阈值、Pool（若启用）。
  - Pool（two-level）：Pool 配置的 `required_services` 用 service_id，节点分桶时检查 `installed_services` 是否包含这些 service_id。
- Web 端：任务发起未区分类型，默认需要 ASR/NMT/TTS。

## 目标架构（type 粒度）
- 类型枚举：`ASR`、`NMT`、`TTS`、`TONE`（可选）。
- 节点心跳按类型上报可用性；调度按类型做健康检查、Pool 匹配、节点选择；Pool 配置改为 type。
- 同类型多实现：运行中即可被选；仅选择已用 GPU 启动的实现；随机挑选（或后续可加权）。

## 节点端改造点
1) 类型映射与枚举
   - 定义 `ServiceType` 枚举 + service_id → type 映射（包含上面给定的表）。
2) 心跳结构调整
   - `installed_services`：为每个条目增加 `type` 字段；若某 type 有多个 ready 实现，可全部上报。
   - 新增 `capability_by_type`（或改造 `capability_state` 为按 type）：`type` → `ready/not_ready`，规则：同类型只要有一条 ready（且 GPU 启动）即为 `ready`。
   - 仍可保留原 `capability_state`（service_id 粒度）作为调试字段，但调度将只看按 type 聚合后的字段（本次可直接切换，无需兼容）。
3) 运行状态聚合
   - 检查服务运行时增加 type 维度；同一 type 下选用“已运行且 GPU 启动”的实现；如果同一 type 多实例，随机选或轮询。
4) 立即心跳
   - 服务状态变更时重新计算 type 可用性并触发心跳（现有防抖机制可复用）。

## 调度端改造点
1) 协议与存储模型
   - `NodeHeartbeatMessage`、`Node` 结构新增 `installed_services.type` 字段。
   - 新增 `capability_by_type: Record<ServiceType, ModelStatus>`（或改造现有字段），作为主要健康判断来源。
2) 需求解析
   - `get_required_models_for_features` 改为输出 `required_types`（默认 pipeline：ASR+NMT+TTS；TONE 仅在对应 feature 需要时加入）。
3) 节点过滤
   - `node_has_installed_services` / `node_has_required_services_ready` 改为按 type 判断：某 type 只要 `capability_by_type[type]==Ready` 即通过。
   - breakdown 维度改为 type（或在日志中输出缺失的 type）。
4) Pool 机制
   - Pool 配置 `required_services` 改为 `required_types`；Pool 索引构建、两级调度匹配改为检查节点的 type 可用性。
5) 多实现选择
   - 选节点时只需确认类型 ready；具体服务实例由节点端内部随机（对上游透明）。
6) 观测与日志
   - 调试日志、metrics、告警文案从 service_id 改为 type。

## Web 端改造点
- 若前端有显式模型选择或展示，需要改为展示/请求类型（大部分情况下可不改；默认 ASR/NMT/TTS 需求不变，TONE 由 feature 控制）。

## 实现建议（无兼容要求，可一次性切换）
1) 定义与协议
   - 在 shared 协议中新增 `ServiceType` 枚举与映射；心跳与节点存储结构加入 `capability_by_type`。
2) 节点端
   - 补充 service_id→type 映射，聚合 type 可用性（仅 GPU 运行算 ready），心跳带 type。
3) 调度端
   - 需求解析输出 required_types；过滤与 Pool 改为按 type；日志/metrics 更新。
4) Web 端（如需要）
   - UI/请求参数按 type 展示或开关 TONE。
5) 验证
   - 单节点自测：不同类型启停，心跳 type 状态正确；任务能派发。
   - Pool 测试：配置按 type 的 pool，验证分桶与 fallback。
   - 多实现测试：ASR 同时有 node-inference 与 faster_whisper_vad，随机可用。

## 变更规模评估
- 节点端：中等（新增映射、聚合逻辑、协议字段、心跳生成调整）。
- 调度端：偏大（协议模型、需求解析、过滤逻辑、Pool、日志/metrics 全链路修改）。
- Web 端：小（若仅保持默认链路，可最小化改动）。

## 风险与注意
- Pool 配置需要一次性迁移到 type，否则无法匹配。
- Type 聚合需确保“仅 GPU 启动的实例”计入 ready，避免选到 CPU。
- 多实现随机策略需可观测（在节点日志中记录实际选用的实现）。

