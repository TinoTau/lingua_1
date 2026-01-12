# 增强诊断日志

**日期**: 2025-12-25  
**状态**: ✅ **已添加详细诊断日志**

---

## 目的

在transcribe之后的关键步骤添加详细日志，帮助定位崩溃发生的具体位置。

---

## 添加的日志点

### 1. 文本提取阶段 (Step 8.1)

**位置**: `faster_whisper_vad_service.py` - 提取文本和分段

**日志**:
- 开始提取文本
- 成功提取文本（段数、文本长度）
- 提取失败（异常信息）

### 2. ASR结果处理阶段 (Step 9)

**位置**: `faster_whisper_vad_service.py` - ASR识别完成

**日志**:
- 开始ASR结果处理
- 文本trimmed
- 括号检查
- ASR识别完成

### 3. 文本验证阶段 (Step 10)

**位置**: `faster_whisper_vad_service.py` - 检查文本是否为无意义

**日志**:
- 开始文本验证
- 检查空文本
- 检查无意义文本
- 返回空响应（如果文本为空或无意义）

### 4. 文本上下文更新阶段 (Step 11)

**位置**: `faster_whisper_vad_service.py` - 更新文本上下文缓存

**日志**:
- 开始文本上下文更新
- 分割句子
- 更新文本上下文
- 文本上下文更新完成

### 5. 上下文缓冲区更新阶段 (Step 12)

**位置**: `faster_whisper_vad_service.py` - 更新上下文缓冲区

**日志**:
- 开始上下文缓冲区更新
- VAD检测（用于上下文）
- 更新上下文缓冲区
- 上下文缓冲区更新完成

### 6. 响应构建阶段 (Step 13)

**位置**: `faster_whisper_vad_service.py` - 返回结果

**日志**:
- 开始响应构建
- 响应构建成功
- 返回响应

### 7. VAD检测函数

**位置**: `vad.py` - `detect_speech()`

**日志**:
- 开始VAD检测
- 帧处理计数
- VAD检测完成（帧数、段数）
- VAD检测失败（异常信息）

### 8. 上下文更新函数

**位置**: `context.py` - `update_context_buffer()` 和 `update_text_context()`

**日志**:
- 开始更新
- 更新完成（缓冲区长度）
- 更新失败（异常信息）

---

## 日志格式

所有日志都包含：
- `trace_id`: 用于追踪单个请求
- `Step X.Y`: 步骤编号，便于定位
- 操作描述和关键数据
- 异常信息（如果失败）

**示例**:
```
INFO:__main__:[concurrent_test_1766593570_4] Step 8.1: Starting to extract text from segments (count=1)
INFO:__main__:[concurrent_test_1766593570_4] Step 8.1: Successfully extracted text, segments=0, full_text_len=0
INFO:__main__:[concurrent_test_1766593570_4] Step 9: Starting ASR result processing
INFO:__main__:[concurrent_test_1766593570_4] Step 10: Starting text validation
INFO:__main__:[concurrent_test_1766593570_4] Step 10.1: Returning empty response (empty transcript)
```

---

## 使用方法

1. **运行测试**: 运行并发测试脚本
2. **查看日志**: 检查服务日志，找到最后一个成功的步骤
3. **定位崩溃**: 崩溃发生在最后一个成功步骤之后

---

## 预期效果

1. **精确定位**: 能够确定崩溃发生在哪个具体步骤
2. **问题诊断**: 通过日志了解崩溃前的状态
3. **修复指导**: 根据崩溃位置，有针对性地修复问题

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/OPUS_CONCURRENCY_TEST_RESULTS.md` - Opus并发测试结果
- `electron_node/services/faster_whisper_vad/docs/CRASH_ROOT_CAUSE_ANALYSIS.md` - 崩溃根本原因分析
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 主服务文件
- `electron_node/services/faster_whisper_vad/vad.py` - VAD模块
- `electron_node/services/faster_whisper_vad/context.py` - 上下文模块

