# 语言能力功能测试指南

本文档提供针对语言能力检测、Pool 自动生成和语言任务分配的完整测试指南。

## 一、测试前准备

### 1.1 启动服务

1. **启动调度服务器**
   ```bash
   cd central_server/scheduler
   cargo run
   ```

2. **启动节点端**
   ```bash
   cd electron_node/electron-node
   npm run dev
   ```

### 1.2 检查配置

确保调度服务器的配置文件中启用了自动 Pool 生成：

```toml
[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true

[phase3.auto_pool_config]
min_nodes_per_pool = 1  # 测试时可以设置为 1
max_pools = 50
require_semantic = true
```

## 二、测试步骤

### 2.1 测试节点注册和语言能力上报

#### 步骤 1：检查节点注册日志

**调度服务器端日志**应该显示：
```
[INFO] Processing node registration: capability_schema_version=Some("2.0"), ...
[INFO] 开始自动生成语言对 Pool
[INFO] 使用配置的自动 Pool 生成参数: min_nodes_per_pool=1, max_pools=50, require_semantic=true
[DEBUG] 开始收集节点的语言对
[INFO] 收集到 X 个语言对
[INFO] 生成语言对 Pool: zh-en (zh -> en)
[INFO] 自动生成完成，共生成 X 个语言对 Pool
[INFO] Pool 配置已更新：0 -> X
[DEBUG] 使用自动生成模式分配 Pool
[DEBUG] 节点分配到 Pool 1
[INFO] Node node-XXXX registered, status: registering
```

**节点端日志**应该显示：
```
[DEBUG] Detecting language capabilities...
[DEBUG] Language capabilities detected: asr_languages=2, tts_languages=2, nmt_capabilities=1, semantic_languages=2
[INFO] Sending node registration message
```

#### 步骤 2：验证语言能力索引

可以通过调度服务器的 API 或日志验证：
- 节点是否正确上报了语言能力
- 语言能力索引是否正确更新

### 2.2 测试 Pool 自动生成

#### 步骤 1：检查 Pool 生成

**调度服务器端日志**应该显示：
```
[INFO] 开始自动生成语言对 Pool
[INFO] 收集到 X 个语言对
[INFO] 生成语言对 Pool: zh-en (zh -> en)
[INFO] 生成语言对 Pool: en-zh (en -> zh)
[INFO] 自动生成完成，共生成 X 个语言对 Pool
```

#### 步骤 2：验证 Pool 配置

检查生成的 Pool 是否包含：
- 正确的 `pool_id`（从 1 开始）
- 正确的 `name`（格式：`{src_lang}-{tgt_lang}`）
- 正确的 `required_services`（ASR、NMT、TTS、可选 SEMANTIC）
- 正确的 `language_requirements`

#### 步骤 3：验证节点分配到 Pool

**调度服务器端日志**应该显示：
```
[DEBUG] 使用自动生成模式分配 Pool
[DEBUG] 节点分配到 Pool 1
```

### 2.3 测试语言任务分配

#### 步骤 1：发送测试任务请求

可以通过以下方式发送测试任务：

**方式 1：使用 HTTP API（如果可用）**
```bash
curl -X POST http://localhost:5010/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "src_lang": "zh",
    "tgt_lang": "en",
    "audio": "...",
    "session_id": "test-session-1",
    "utterance_index": 1
  }'
```

**方式 2：通过 WebSocket（如果实现了）**

**方式 3：使用测试脚本**

#### 步骤 2：验证任务分配日志

**调度服务器端日志**应该显示：
```
[DEBUG] 自动生成模式：根据语言对选择 Pool
[DEBUG] 找到匹配的 Pool: zh-en
[DEBUG] pool_id=1, pool_name=zh-en, src_lang=zh, tgt_lang=en
[INFO] Selected node: node-XXXX for job: job-XXXX
```

#### 步骤 3：验证节点选择逻辑

检查节点选择是否：
1. 首先根据语言对选择 Pool
2. 在 Pool 内选择节点
3. 考虑节点的语言能力匹配

### 2.4 测试不同语言对

#### 测试用例 1：中文到英文（zh -> en）
- 请求：`src_lang="zh"`, `tgt_lang="en"`
- 预期：选择 `zh-en` Pool 中的节点

#### 测试用例 2：英文到中文（en -> zh）
- 请求：`src_lang="en"`, `tgt_lang="zh"`
- 预期：选择 `en-zh` Pool 中的节点

#### 测试用例 3：自动检测源语言（auto -> en）
- 请求：`src_lang="auto"`, `tgt_lang="en"`
- 预期：选择具有 READY ASR 的节点，按 ASR 覆盖度排序

#### 测试用例 4：不支持的语言对
- 请求：`src_lang="ja"`, `tgt_lang="ko"`
- 预期：如果没有匹配的 Pool，返回 `NoAvailableNodeBreakdown`，包含 `lang_pair_unsupported` 原因

### 2.5 测试 Pool 动态更新

#### 步骤 1：添加新节点

启动第二个节点端，支持不同的语言对（如 `ja-en`）

#### 步骤 2：验证 Pool 更新

检查是否：
- 新节点注册后，Pool 列表是否更新
- 新节点是否分配到正确的 Pool

#### 步骤 3：移除节点

停止一个节点，检查：
- Pool 是否仍然存在（如果还有其他节点）
- Pool 索引是否正确更新

## 三、验证检查点

### 3.1 节点注册验证

- [ ] 节点成功注册到调度服务器
- [ ] 节点上报了语言能力信息
- [ ] 语言能力索引正确更新
- [ ] 节点被分配到正确的 Pool

### 3.2 Pool 生成验证

- [ ] Pool 自动生成成功
- [ ] Pool 命名正确（格式：`{src_lang}-{tgt_lang}`）
- [ ] Pool 包含正确的服务要求
- [ ] Pool 包含正确的语言要求
- [ ] 节点正确分配到 Pool

### 3.3 任务分配验证

- [ ] 任务根据语言对选择正确的 Pool
- [ ] 在 Pool 内选择节点
- [ ] 节点选择考虑语言能力匹配
- [ ] 不支持的语言对返回正确的错误信息

### 3.4 日志验证

- [ ] 所有关键步骤都有日志记录
- [ ] 日志包含足够的信息用于调试
- [ ] 错误情况有明确的日志说明

## 四、常见问题排查

### 4.1 Pool 未生成

**可能原因**：
1. `auto_generate_language_pools = false`
2. `pools` 已存在（不会重新生成）
3. 节点没有完整的服务（ASR、NMT、TTS、可选 SEMANTIC）
4. 节点数少于 `min_nodes_per_pool`

**排查方法**：
- 检查配置
- 检查节点服务状态
- 检查日志中的过滤信息

### 4.2 节点未分配到 Pool

**可能原因**：
1. 节点的语言能力不匹配 Pool 要求
2. 节点缺少必需的服务
3. Pool 匹配逻辑错误

**排查方法**：
- 检查节点的语言能力
- 检查 Pool 的语言要求
- 查看调试日志

### 4.3 任务分配失败

**可能原因**：
1. 没有匹配的 Pool
2. Pool 内没有可用节点
3. 节点资源不足
4. 语言能力不匹配

**排查方法**：
- 检查 `NoAvailableNodeBreakdown` 中的详细原因
- 查看节点选择日志
- 检查节点的语言能力和资源状态

## 五、测试脚本示例

### 5.1 检查 Pool 状态

```bash
# 通过调度服务器 API 检查 Pool 配置（如果实现了）
curl http://localhost:5010/api/pools
```

### 5.2 检查节点语言能力

```bash
# 通过调度服务器 API 检查节点信息（如果实现了）
curl http://localhost:5010/api/nodes/{node_id}
```

### 5.3 发送测试任务

```bash
# 发送测试任务请求
curl -X POST http://localhost:5010/api/jobs \
  -H "Content-Type: application/json" \
  -d @test-job-zh-en.json
```

## 六、预期结果

### 6.1 正常流程

1. **节点注册** → 语言能力上报 → Pool 自动生成 → 节点分配到 Pool
2. **任务请求** → 根据语言对选择 Pool → 在 Pool 内选择节点 → 分配任务

### 6.2 日志输出

所有关键步骤都应该有清晰的日志输出，包括：
- Pool 生成过程
- 节点分配过程
- 任务选择过程
- 错误和警告信息

## 七、性能验证

### 7.1 Pool 生成性能

- Pool 生成应该在合理时间内完成（< 1 秒，即使有 100+ 节点）
- 不应该阻塞节点注册

### 7.2 任务分配性能

- 任务分配应该快速（< 100ms）
- 语言能力匹配不应该成为性能瓶颈
