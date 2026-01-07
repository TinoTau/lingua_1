# 节点端语言对列表上报格式

## 消息格式

### TypeScript 接口定义

```typescript
export interface NodeLanguageCapabilities {
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  asr_languages?: string[];
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  tts_languages?: string[];
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  nmt_capabilities?: NmtCapability[];
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  semantic_languages?: string[];
  
  /** 节点支持的语言对列表（所有服务的交集，节点端计算） */
  supported_language_pairs?: Array<{ src: string; tgt: string }>;
}
```

### JSON 格式示例

```json
{
  "language_capabilities": {
    "asr_languages": ["zh", "en", "ja", "ko"],
    "tts_languages": ["zh", "en", "ja", "ko"],
    "nmt_capabilities": [
      {
        "model_id": "nmt-m2m100",
        "languages": ["zh", "en", "ja", "ko", "fr", "de"],
        "rule": "any_to_any"
      }
    ],
    "semantic_languages": ["zh", "en"],
    "supported_language_pairs": [
      { "src": "zh", "tgt": "en" },
      { "src": "zh", "tgt": "ja" },
      { "src": "en", "tgt": "zh" },
      { "src": "en", "tgt": "ja" },
      { "src": "ja", "tgt": "zh" },
      { "src": "ja", "tgt": "en" }
    ]
  }
}
```

## 语言对格式说明

### 字段说明

- **`src`**: 源语言代码（ISO 639-1 格式，如 "zh", "en", "ja"）
- **`tgt`**: 目标语言代码（ISO 639-1 格式）

### 语言对生成规则

语言对列表是节点端计算所有服务能力的**交集**：

1. **ASR 语言**：节点能识别的源语言
2. **TTS 语言**：节点能合成的目标语言
3. **NMT 能力**：节点能翻译的语言对（根据 NMT 规则）
4. **Semantic 语言**：节点能进行语义修复的语言（可选）

### NMT 规则说明

- **`any_to_any`**: 任意语言到任意语言
  - 生成所有 ASR 和 TTS 语言的组合（排除相同语言）
  - 检查 NMT 是否支持该语言对
  - 排除 blocked_pairs

- **`any_to_en`**: 任意语言到英文
  - 生成所有 ASR 语言到 "en" 的语言对
  - 排除 blocked_pairs

- **`en_to_any`**: 英文到任意语言
  - 生成 "en" 到所有 TTS 语言的语言对
  - 排除 blocked_pairs

- **`specific_pairs`**: 明确支持的语言对
  - 只生成 supported_pairs 中定义的语言对
  - 检查 ASR 和 TTS 是否支持

## 日志记录

### 节点端日志

#### 1. 语言能力检测日志（INFO 级别）

**位置**：`node-agent-language-capability.ts::detectLanguageCapabilities`

**日志内容**：
```json
{
  "level": "info",
  "message": "Language capabilities detected",
  "asr_languages": 14,
  "tts_languages": 14,
  "nmt_capabilities": 1,
  "semantic_languages": 2,
  "supported_language_pairs": 42,
  "language_pairs_detail": "zh-en, zh-ja, en-zh, en-ja, ..."
}
```

#### 2. 语言对计算日志（INFO 级别）

**位置**：`node-agent-language-capability.ts::computeLanguagePairs`

**日志内容**：
```json
{
  "level": "info",
  "message": "计算完成，生成语言对列表",
  "total_pairs": 42,
  "pairs": [
    { "src": "zh", "tgt": "en" },
    { "src": "zh", "tgt": "ja" },
    ...
  ],
  "pair_summary": "zh-en, zh-ja, en-zh, en-ja, ..."
}
```

#### 3. 心跳上报日志（INFO 级别）

**位置**：`node-agent-heartbeat.ts::sendHeartbeatOnce`

**日志内容**：
```json
{
  "level": "info",
  "message": "上报语言对列表到调度服务器",
  "nodeId": "node-XXXX",
  "pair_count": 42,
  "pairs": "zh-en, zh-ja, en-zh, en-ja, ..."
}
```

### 调度服务器日志

#### 1. 接收语言对列表日志

**位置**：`websocket/node_handler/message/register.rs`

**日志内容**：
```
[INFO] Processing node registration: capability_schema_version=Some("2.0"), ...
[DEBUG] 使用自动生成模式分配 Pool
[DEBUG] 节点分配到 Pool 1
```

#### 2. Pool 生成日志

**位置**：`node_registry/auto_language_pool.rs`

**日志内容**：
```
[INFO] 开始自动生成语言对 Pool
[INFO] 收集到 42 个语言对
[INFO] 生成语言对 Pool: zh-en (zh -> en)
[INFO] 自动生成完成，共生成 10 个语言对 Pool
```

## 查看日志

### 节点端日志

**日志文件位置**：
- Windows: `electron_node/electron-node/logs/`
- Linux/Mac: `electron_node/electron-node/logs/`

**查看命令**：
```bash
# 查看语言对相关日志
grep -i "language.*pair\|supported_language_pairs" logs/*.log

# 查看语言能力检测日志
grep -i "Language capabilities detected" logs/*.log

# 查看上报日志
grep -i "上报语言对列表" logs/*.log
```

### 调度服务器日志

**日志文件位置**：
- `central_server/scheduler/logs/scheduler.log`

**查看命令**：
```bash
# 查看 Pool 生成日志
grep -i "自动生成\|语言对\|pool" logs/scheduler.log

# 查看节点注册日志
grep -i "node_register\|语言能力" logs/scheduler.log
```

## 调试建议

1. **检查节点端日志**：
   - 确认 `supported_language_pairs` 是否生成
   - 检查语言对数量是否合理
   - 验证语言对格式是否正确

2. **检查调度服务器日志**：
   - 确认是否接收到 `supported_language_pairs`
   - 检查 Pool 是否成功生成
   - 验证节点是否分配到正确的 Pool

3. **常见问题**：
   - **语言对为空**：检查 ASR、TTS、NMT 服务是否都正常
   - **语言对数量异常**：检查 NMT 规则是否正确
   - **Pool 未生成**：检查 `min_nodes_per_pool` 配置

## 示例

### 完整消息示例

```json
{
  "type": "node_heartbeat",
  "node_id": "node-E9E60742",
  "timestamp": 1767692034615,
  "resource_usage": {
    "cpu_percent": 18.72,
    "gpu_percent": 7,
    "gpu_mem_percent": 88.40,
    "mem_percent": 85.45,
    "running_jobs": 0
  },
  "installed_services": [...],
  "capability_by_type": [...],
  "language_capabilities": {
    "asr_languages": ["zh", "en", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "ar", "hi", "th", "vi"],
    "tts_languages": ["zh", "en", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "ar", "hi", "th", "vi"],
    "nmt_capabilities": [
      {
        "model_id": "nmt-m2m100",
        "languages": ["zh", "en", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "ar", "hi", "th", "vi"],
        "rule": "any_to_any"
      }
    ],
    "semantic_languages": ["zh", "en"],
    "supported_language_pairs": [
      { "src": "zh", "tgt": "en" },
      { "src": "zh", "tgt": "ja" },
      { "src": "zh", "tgt": "ko" },
      { "src": "en", "tgt": "zh" },
      { "src": "en", "tgt": "ja" },
      { "src": "en", "tgt": "ko" },
      { "src": "ja", "tgt": "zh" },
      { "src": "ja", "tgt": "en" },
      { "src": "ja", "tgt": "ko" },
      { "src": "ko", "tgt": "zh" },
      { "src": "ko", "tgt": "en" },
      { "src": "ko", "tgt": "ja" }
    ]
  }
}
```
