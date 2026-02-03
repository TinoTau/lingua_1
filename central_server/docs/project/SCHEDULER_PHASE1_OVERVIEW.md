# Scheduler Phase 1 总览

**状态**: ✅ **已完成**

## 概述

Phase 1 完成了 Scheduler 单机稳定运行的关键拆分优化，在不引入 Redis/集群复杂度的前提下，最大化 Scheduler 稳定性、可扩展性与 Phase 2 可迁移性。

## 核心优化

### 1. Dashboard/统计快照化

**问题**: `/api/v1/stats` 请求时会触发遍历会话与节点状态，并可能引发额外开销。

**改造**:
- 新增 `DashboardSnapshotCache` 组件
- 后台任务按固定周期（默认 5 秒）生成一次 stats JSON 快照
- `/api/v1/stats` 请求只读快照
- 冷启动时若快照尚未生成，则兜底现场生成一次（SingleFlight + 频率约束）

**收益**:
- Dashboard 轮询不会再把 CPU/锁竞争推到峰值
- 控制面请求抖动显著下降

### 2. ServiceCatalogCache 缓存化

**问题**: 统计模块内包含同步 HTTP 拉取服务包列表的逻辑，当 ModelHub 不可用/抖动时，会导致 stats 请求路径不稳定。

**改造**:
- 新增 `ServiceCatalogCache` 组件
- 后台定期刷新（默认 30 秒一次，带超时保护）
- 统计快照生成时只读取缓存（无网络 IO）
- 支持本地 `services_index.json` 兜底（单机冷启动/离线场景可用）

**收益**:
- ModelHub 不稳定时，Scheduler 仍可稳定提供调度能力与基础 stats

### 3. MODEL_NOT_AVAILABLE 事件处理

**改造**:
- 主路径只入队（不做重计算/阻塞）
- 后台 worker 对节点服务做短 TTL 的"暂不可用标记"
- 支持节点级限流与去抖窗口（Phase 1 先在进程内完成）

### 4. 任务级幂等 request_id + lease

**改造**:
- `request_id` 在 lease 内重试复用同一 Job（避免重复创建/重复派发）
- 并发占用采用 `reserved_jobs` 机制补强心跳滞后，降低超卖风险

## 工程规范

### stats 冷启动兜底生成

1. **SingleFlight**: 同一时间最多允许 1 个 stats 兜底生成任务
2. **频率上限**: 在时间窗口 T 内（建议 30s）最多生成 1 次
3. **退化返回**: 其他请求返回最近一次成功快照（即使是 stale）
4. **禁止行为**:
   - ❌ 禁止在请求路径中阻塞等待兜底生成完成
   - ❌ 禁止每个请求都独立生成

### ServiceCatalogCache 规范

1. **stale-while-revalidate**: 刷新失败时必须继续使用旧缓存
2. **失败退避**: 连续失败 N 次（建议 3）后，延长刷新间隔
3. **禁止行为**:
   - ❌ 禁止刷新失败时清空缓存
   - ❌ 禁止在 stats 主路径调用 ModelHub HTTP

## 可替换接口位（为未来 cluster 改造预留）

本次新增两个"可替换组件"，后续 cluster 化可替换其实现：

- `ServiceCatalogCache`：单机为进程内缓存；未来可改为 Redis key / 独立 catalog 服务
- `DashboardSnapshotCache`：单机为进程内快照；未来可改为 Redis snapshot / 独立聚合器写入

## 当前架构

### 角色定位

Scheduler 当前同时承担：
- **会话入口（WebSocket Session）**：接收 Web 客户端音频片段/Utterance，累积音频并创建 Job
- **节点入口（WebSocket Node）**：处理节点注册、心跳、任务结果回传、错误上报
- **调度与派发**：根据节点能力与资源状况选节点，并把 Job 下发到节点执行
- **运行期统计与 Dashboard 支撑**：收集活跃会话、语言使用、节点/模型/服务包统计等信息

### 核心组件

- **节点注册表**：内存 `NodeRegistry`，保存节点状态、能力、资源使用率等
- **调度器/派发器**：`JobDispatcher` 创建 Job、选择节点
- **会话与连接管理**：会话管理、session/node 连接管理、结果队列、音频缓冲等
- **统计模块**：`DashboardStats` 聚合会话与节点信息，支撑 `/api/v1/stats` 与 Dashboard 展示

## 扩展瓶颈

主要风险来自以下三类：
- **同步耦合风险**：统计与外部服务（ModelHub HTTP）被放在同一进程、甚至可能在请求路径上执行
- **锁与遍历成本**：内存注册表受 `RwLock` 保护，节点选择需要遍历与排序
- **风暴类事件放大**：如模型缺失/版本切换引发 `MODEL_NOT_AVAILABLE` 风暴时，若在主路径做昂贵操作会放大故障

## 技术债/风险

- **Scheduler 仍承载音频 payload（数据面）**：目前会话入口会累积音频并把任务下发到节点
- **节点选择仍是全量遍历 + 排序**：当节点规模显著增大，需要进一步引入候选集索引/快照缓存/分片等策略（Phase 2/3）

## 相关文档

- [Scheduler Phase 2 总览](./SCHEDULER_PHASE2_OVERVIEW.md)
- [Scheduler 扩展与容量规划](./SCHEDULER_CAPACITY_AND_SCALING.md)
- [Scheduler 架构文档](../scheduler/ARCHITECTURE.md)

---

**最后更新**: 2025-01-XX

