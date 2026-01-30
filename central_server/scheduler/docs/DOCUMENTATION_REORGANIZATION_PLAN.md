# 文档整理计划

**日期**: 2026-01-24  
**目的**: 系统性地整理和重组 `central_server/scheduler/docs` 目录下的所有文档

---

## 📋 整理策略

### 1. 模块分类

文档按以下模块分类整理：

1. **finalize/** - Finalize 处理机制（✅ 已完成）
2. **node_registry/** - 节点注册和管理（🔄 进行中）
3. **job/** - 任务管理和处理流程
4. **audio/** - 音频处理、AudioAggregator、Buffer
5. **aggregator/** - AggregatorMiddleware、UtteranceAggregator
6. **integration_test/** - 集成测试相关
7. **architecture/** - 架构文档（POOL_ARCHITECTURE, REDIS_DATA_MODEL, MULTI_INSTANCE_DEPLOYMENT 等）
8. **backup_comparison/** - 备份代码对比（归档，不删除）

### 2. 处理原则

- ✅ **保留核心文档**：架构、协议、流程文档
- ✅ **合并重复内容**：多个版本的同一文档合并为最新版本
- ✅ **删除过期文档**：Pause Finalize 相关（已删除功能）
- ✅ **归档备份对比**：移动到 backup_comparison 目录
- ✅ **更新链接**：所有文档中的内部链接更新为新路径

---

## 📁 模块详细规划

### finalize/ (✅ 已完成)

**文档**:
- README.md
- scheduler_finalize_types.md
- scheduler_finalize_processing.md
- node_finalize_processing.md
- timeout_finalize.md
- maxduration_finalize.md

**待删除**:
- Pause_Finalize*.md (所有 Pause Finalize 相关文档)
- Timeout_Finalize_vs_Pause_Finalize*.md
- Pause和Timeout_Finalize覆盖关系分析*.md

---

### node_registry/ (🔄 进行中)

**文档**:
- README.md ✅
- node_registration.md ✅ (从 NODE_REGISTRATION.md 复制)
- node_and_job_management.md (待创建，合并"调度服务器节点注册节点管理和任务管理流程详细分析_2026_01_24.md")
- session_affinity.md (待创建，合并"select_node_timeout_node_id支持_2026_01_24.md")

**待删除**:
- NODE_REGISTRATION.md (已复制到 node_registry/)
- 调度服务器节点注册节点管理和任务管理流程详细分析_2026_01_24.md (合并后删除)
- select_node_timeout_node_id支持_2026_01_24.md (合并后删除)

---

### job/ (待处理)

**文档**:
- README.md
- job_processing_flow.md (合并多个 Job 处理流程文档)
- job_management.md

**待合并文档**:
- Job处理流程详细分析_2026_01_24.md
- 节点端任务处理流程完整分析_2026_01_24.md
- 节点端Job处理流程分析.md

---

### audio/ (待处理)

**文档**:
- README.md
- audio_aggregator.md (合并 AudioAggregator 相关文档)
- buffer_management.md (合并 Buffer 相关文档)
- audio_quality.md

**待合并文档**:
- 节点端AudioAggregator完整流程与代码逻辑分析_2026_01_24.md
- AudioAggregator处理流程分析_2026_01_24.md
- 音频处理流程和Buffer清除逻辑分析_2026_01_24.md
- Buffer清除逻辑修复_2026_01_24.md
- 音频质量检查逻辑分析_2026_01_24.md

**注意**: 节点端流式 ASR 相关文档应迁移到 `electron_node/services/faster_whisper_vad/docs/streaming_asr/`（已迁移）

---

### aggregator/ (待处理)

**文档**:
- README.md
- aggregator_middleware.md (合并 AggregatorMiddleware 相关文档)
- utterance_aggregator.md

**待合并文档**:
- AggregatorMiddleware功能说明_2026_01_24.md
- AggregatorMiddleware未合并问题修复_2026_01_24.md
- AggregatorMiddleware未合并问题详细分析_2026_01_24.md
- AggregatorMiddleware生效但未合并问题分析_2026_01_24.md
- UtteranceAggregator配置对比分析_2026_01_24.md
- AudioAggregator和AggregatorMiddleware连续性判断对比_2026_01_24.md

---

### integration_test/ (待处理)

**文档**:
- README.md
- integration_test_summary.md (合并所有集成测试分析文档)

**待合并文档**:
- 集成测试Job处理过程完整分析报告_2026_01_24.md
- 集成测试Job处理过程完整分析_2026_01_24_v2_最终版.md
- 集成测试Job处理过程完整分析_2026_01_24_v2.md
- 集成测试Job处理过程完整分析_2026_01_24.md
- 集成测试Job处理过程详细分析_2026_01_24_v2.md
- 集成测试Job处理过程详细分析_2026_01_24.md
- 集成测试Job处理过程详细分析报告_2026_01_24.md
- 集成测试完整分析报告_2026_01_24.md
- 集成测试日志分析结果_2026_01_24.md
- 集成测试前半句丢失问题分析_2026_01_24.md
- 集成测试问题诊断_2026_01_22.md
- 集成测试job处理分析_2026_01_23.md
- 集成测试job处理分析_2026_01_24.md

---

### architecture/ (待处理)

**文档**:
- README.md
- ARCHITECTURE.md (保留)
- POOL_ARCHITECTURE.md (保留)
- REDIS_DATA_MODEL.md (保留)
- MULTI_INSTANCE_DEPLOYMENT.md (保留)
- OPTIMIZATION_HISTORY.md (保留)

---

### backup_comparison/ (待处理)

**文档**:
- README.md
- 所有"备份代码"开头的文档
- 所有"vs当前代码"的对比文档

**待归档文档**:
- 备份代码AggregatorMiddleware日志分析_2026_01_24.md
- 备份代码AggregatorMiddleware逻辑对比_2026_01_24.md
- 备份代码ASR性能分析_2026_01_23.md
- 备份代码ASR性能对比分析_2026_01_23.md
- 备份代码MaxDuration处理机制分析_2026_01_24.md
- 备份代码timeout_finalize分析_2026_01_24.md
- 备份代码vs当前代码ASR性能对比_2026_01_23.md
- 备份代码vs当前代码完整差异对比_2026_01_23.md
- 备份代码为什么不会ASR过载_2026_01_23.md
- 备份代码对比分析_2026_01_23.md
- 备份代码配置覆盖机制分析_2026_01_23.md

---

## 🗑️ 待删除文档

### Pause Finalize 相关（功能已删除）

- Pause_Finalize删除完成_2026_01_24.md
- Pause_Finalize删除完成总结_2026_01_24.md
- Pause_Finalize完全删除完成_2026_01_24.md
- Pause_Finalize完整流程和依赖分析_2026_01_24.md
- Pause和Timeout_Finalize覆盖关系分析_2026_01_24.md
- Timeout_Finalize_vs_Pause_Finalize对比分析_2026_01_24.md
- Timeout_Finalize完全替代Pause_Finalize确认_2026_01_24.md
- Timeout_Finalize完全替代确认_最终版_2026_01_24.md
- 节点端Pause_vs_Timeout_Finalize效果对比_2026_01_24.md
- 节点端Pause_vs_Timeout_Finalize流程步骤说明_2026_01_24.md

### 已合并的文档（合并后删除）

- finalize类型和触发条件分析_2026_01_24.md (已合并到 finalize/)
- Finalize类型说明_2026_01_24.md (已合并到 finalize/)
- timeout_finalize生成条件分析_2026_01_24.md (已合并到 finalize/)
- timeout_finalize音频数据分析_2026_01_24.md (已合并到 finalize/)
- MaxDuration_Finalize处理机制分析_2026_01_24.md (已合并到 finalize/)
- 节点端Finalize处理流程总结_2026_01_24.md (已合并到 finalize/)
- 调度服务器finalize逻辑对比分析_2026_01_24.md (已合并到 finalize/)

---

## 📝 下一步行动

1. ✅ 完成 finalize/ 模块整理
2. 🔄 完成 node_registry/ 模块整理
3. ⏳ 整理 job/ 模块
4. ⏳ 整理 audio/ 模块
5. ⏳ 整理 aggregator/ 模块
6. ⏳ 整理 integration_test/ 模块
7. ⏳ 整理 architecture/ 模块
8. ⏳ 归档 backup_comparison/ 模块
9. ⏳ 删除过期文档
10. ⏳ 更新主 README.md

---

## 📅 更新历史

- **2026-01-24**: 创建整理计划文档
