# Unified Semantic Repair Service

## Architecture Review + Missing Points + Optimization + Task List

**Version:** v1.1
**Author:** ChatGPT
**Date:** 2026-01-19
**Status:** ✅ P0 任务全部完成
**Reference:** SEMANTIC_REPAIR_SERVICE_UNIFICATION_DESIGN.md
**Implementation:** UNIFIED_SEMANTIC_REPAIR_IMPLEMENTATION_SUMMARY.md

---

# 1. Overview

该文档审阅并完善《语义修复服务统一化设计方案》内容，目标是：

1. 评估方案是否存在重复、矛盾、遗漏
2. 列出需要补充与优化的部分
3. 提供可交付给开发部门的 Task List
4. 形成可执行的 v1.1 修订建议文档

---

# 2. Issues Identified

## 2.1 重复逻辑问题

### 2.1.1 路由重复（需要抽象）

`/zh/repair`、`/en/repair`、`/en/normalize` 的逻辑结构完全一致，包括：

* 日志模板
* try/except
* 计时逻辑
* 错误 fallback（返回 PASS 原文）
* 构造 `RepairResponse`

此类重复应抽象为统一 wrapper 或 decorator。

### 2.1.2 “零 if-else” 与 legacy 端点冲突

统一方案强调“路径即策略”“零 if-else”，但 legacy 兼容端点中仍存在语言判断：

```
if request.lang == "zh": ...
elif request.lang == "en": ...
```

需要在文档中说明：
此处为兼容目的，不属于架构原则范围。

---

## 2.2 矛盾/不合理点

### 2.2.1 Normalizer 的健康检查不应包含 model_loaded 字段

Normalizer 无模型，应单独输出规则引擎状态：

```
{
  "status": "healthy",
  "engine": "rule_engine",
  "rules_loaded": true
}
```

---

# 3. Missing Elements (需要补充的关键点)

## 3.1 缺少并发保护（初始化期间）

大模型加载需要数秒，若同时收到多个请求可能出现：

* 处理器未初始化 → 报错
* 多线程重复加载模型

需要在 BaseProcessor 中加入：

* `asyncio.Lock()`
* init guard
* 启动期间统一拒绝外部请求或返回 “service loading”

---

## 3.2 缺少统一请求超时控制

不同处理器推理时间不同，应提供：

* per-processor timeout
* 全局 timeout
* 超时降级策略（返回 PASS 原文）

---

## 3.3 响应格式未经严格标准化

BaseProcessor 与 FastAPI Response Model 之间目前依赖字典结构强行合并，风险：

* 任意处理器少返回一个字段 → 500
* Normalizer diff 字段未定义

需要统一格式 Normalization 层。

---

## 3.4 监控指标缺失

至少应提供：

* 处理时延（P50/P95/P99）
* 错误率
* 模型加载时长
* GPU 内存占用
* warmup 成功与否

---

## 3.5 缺少全局 Request ID

如果客户端不传 job_id，将难以排查问题。
应自动生成：`request_id = uuid4()` 并写入日志与响应体。

---

# 4. Recommended Optimizations

## 4.1 处理器决策逻辑统一化

当前：

```
decision = REPAIR if text_out != text_in else PASS
```

存在于多个处理器。
应在 BaseProcessor 中实现统一决策逻辑，避免漂移。

---

## 4.2 处理器注册表插件化

当前所有处理器手写注册：

```
processors["zh_repair"] = ZhRepairProcessor()
```

未来新增语言可能造成维护负担。
建议通过动态扫描 processors 目录自动注册。

---

## 4.3 健康检查增强

健康检查应执行：

* warmup token test
* 50ms 压测 token 推理
* 内存与 GPU 占用统计

而非仅返回 `initialized: true`。

---

## 4.4 路由包装器

减少重复代码，使所有端点具有统一行为：

* 标准日志格式
* 错误处理
* 响应包装
* 性能测量
* 响应字段补全

示例接口：

```
return await handle_processor("zh_repair", request)
```

---

# 5. Revised Architecture Notes (v1.1)

1. PATH → Processor routing（保持）
2. Zero if-else 适用于核心路径，不包含 legacy 部分
3. Processor 必须提供：

   * safe async init
   * safe shutdown
   * consistent return schema
4. 添加 ProcessorWrapper（负责统一行为）
5. 健康检查扩充
6. timeout + concurrency guard
7. 增加 request_id 自动注入

---

# 6. Task List (可直接交给开发部门)

以下按优先级排列：

## P0（必须，影响架构完整性）

1. **抽象统一 Processor Wrapper**

   * 封装日志、计时、异常、安全 fallback、返回结构
   * 应用于所有 repair/normalize 路由

2. **为 BaseProcessor 加入初始化并发保护**

   * 使用 `asyncio.Lock()`
   * 未初始化期间请求的处理策略（等待或直接 PASS）

3. **定义统一的 Processor Return Schema**

   * 全量字段：text_out / decision / confidence / diff / reason_codes
   * normalizer 需提供 diff 生成策略（最差返回 [])

4. **为所有处理器加入超时控制**

   * processor-level timeout
   * global timeout

5. **全局 request_id 注入**

   * 若 request 未附带 job_id，则自动生成 UUID

6. **修正 normalizer 健康检查字段**

   * 不再使用 model_loaded 字段
   * 输出 rule_engine 状态

---

## P1（重要，但不阻断上线）

7. **统一健康检查规范**

   * warmup_token test
   * 模型加载时间
   * GPU 内存占用（可选）

8. **处理器注册插件化**

   * 扫描 processors 目录
   * 自动加载 `*_processor.py`

9. **添加详细日志上下文**

   * request_id
   * processor_name
   * process_time_ms
   * success/error 状态

---

## P2（增强项，未来可加入）

10. **添加 Prometheus 监控端点**

    * per-processor latency
    * per-processor error count
    * service start time

11. **添加分布式 tracer（可选）**

    * 统一调用链路（OpenTelemetry）

12. **添加自动回收/重载机制（可选）**

    * 处理模型崩溃自动 reload

---

# 7. Conclusion

统一语义修复服务整体设计合理、架构清晰、扩展性强。

需要补充的重点包括：

* 并发安全
* 统一响应结构
* 健康检查增强
* 超时控制
* 去除重复路由逻辑
* 明确 Normalizer 与模型型处理器的差异

按本文 Task List 实施，即可达到可交付、可上线、可扩展的架构质量。

---

文档完毕。
