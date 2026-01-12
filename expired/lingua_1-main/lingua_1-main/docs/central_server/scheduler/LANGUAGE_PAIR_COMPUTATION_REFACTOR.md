# 语言对计算重构：节点端计算交集

## 重构目标

将语言对的计算逻辑从调度服务器移到节点端，节点端负责计算所有服务的交集，直接上报语言对列表。

## 设计原则

1. **节点端负责计算**：节点端最清楚自己能完成哪些完整的任务（语言对）
2. **调度服务器直接使用**：调度服务器不需要知道 ASR、TTS、NMT 各自支持什么语言
3. **简化调度逻辑**：调度服务器只需要根据节点上报的语言对列表创建 Pool

## 修改内容

### 1. 消息协议修改

#### TypeScript (`electron_node/shared/protocols/messages.ts`)

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

#### Rust (`central_server/scheduler/src/messages/common.rs`)

```rust
pub struct NodeLanguageCapabilities {
    /// @deprecated 保留用于向后兼容，优先使用 supported_language_pairs
    pub asr_languages: Option<Vec<String>>,
    /// @deprecated 保留用于向后兼容，优先使用 supported_language_pairs
    pub tts_languages: Option<Vec<String>>,
    /// @deprecated 保留用于向后兼容，优先使用 supported_language_pairs
    pub nmt_capabilities: Option<Vec<NmtCapability>>,
    /// @deprecated 保留用于向后兼容，优先使用 supported_language_pairs
    pub semantic_languages: Option<Vec<String>>,
    /// 节点支持的语言对列表（所有服务的交集，节点端计算）
    pub supported_language_pairs: Option<Vec<LanguagePair>>,
}
```

### 2. 节点端实现

#### 新增方法：`computeLanguagePairs`

**位置**：`electron_node/electron-node/main/src/agent/node-agent-language-capability.ts`

**功能**：
- 计算所有服务的交集（ASR、TTS、NMT、Semantic）
- 根据 NMT 规则生成语言对列表
- 处理 `any_to_any`、`any_to_en`、`en_to_any`、`specific_pairs` 等规则
- 检查 blocked_pairs
- 去重

**调用时机**：
- 在 `detectLanguageCapabilities` 方法中，检测完所有服务能力后调用
- 将计算结果赋值给 `capabilities.supported_language_pairs`

### 3. 调度服务器修改

#### 修改方法：`get_node_language_pairs`

**位置**：`central_server/scheduler/src/node_registry/auto_language_pool.rs`

**逻辑**：
1. **优先级1**：使用节点端计算的 `supported_language_pairs`（新方式）
2. **优先级2**：如果没有，回退到计算模式（向后兼容旧节点）

**优势**：
- 新节点直接使用节点端计算的列表，无需调度服务器计算
- 旧节点仍然可以工作（向后兼容）

## 工作流程

### 节点端

```
1. 检测 ASR 语言能力
2. 检测 TTS 语言能力
3. 检测 NMT 能力（包括规则）
4. 检测 Semantic 语言能力
5. 计算所有服务的交集 → supported_language_pairs
6. 上报给调度服务器
```

### 调度服务器

```
1. 接收节点上报的 supported_language_pairs
2. 收集所有节点的语言对
3. 统计每个语言对的节点数
4. 过滤：只保留节点数 >= min_nodes_per_pool 的语言对
5. 生成 Pool 配置
```

## 向后兼容

- 保留了 `asr_languages`、`tts_languages`、`nmt_capabilities`、`semantic_languages` 字段
- 调度服务器优先使用 `supported_language_pairs`，如果没有则回退到计算模式
- 旧节点仍然可以正常工作

## 优势

1. **职责清晰**：节点端负责计算自己的能力，调度服务器负责调度
2. **简化调度逻辑**：调度服务器不需要知道 ASR、TTS、NMT 的细节
3. **减少网络传输**：只传输语言对列表，而不是所有服务的语言列表
4. **易于扩展**：如果将来需要添加新的服务类型，只需要在节点端修改计算逻辑

## 测试建议

1. **节点端测试**：
   - 测试 `computeLanguagePairs` 方法
   - 验证不同 NMT 规则下的语言对生成
   - 验证 blocked_pairs 的处理

2. **集成测试**：
   - 节点上报 `supported_language_pairs`
   - 调度服务器使用该列表生成 Pool
   - 验证 Pool 分配正确

3. **向后兼容测试**：
   - 旧节点（不提供 `supported_language_pairs`）仍然可以工作
   - 调度服务器回退到计算模式

## 迁移计划

1. ✅ 修改消息协议（添加 `supported_language_pairs` 字段）
2. ✅ 节点端实现 `computeLanguagePairs` 方法
3. ✅ 调度服务器修改 `get_node_language_pairs` 方法
4. ⏳ 测试新实现
5. ⏳ 逐步迁移旧节点（可选，因为向后兼容）

## 注意事项

1. **语义修复服务**：当前实现中，如果节点有语义修复服务，假设它支持所有语言对。如果需要更精确的匹配，可以检查 `semanticLanguages` 是否包含 `src` 或 `tgt`。

2. **性能考虑**：如果节点支持大量语言，语言对列表可能会很大。可以考虑：
   - 限制语言对数量
   - 使用压缩格式
   - 只上报常用的语言对

3. **日志记录**：节点端应该记录计算出的语言对列表，方便调试。
