# 节点语言能力上报与调度架构方案

## 文档信息

- **版本**: v1.0
- **日期**: 2025-01-XX
- **状态**: 提案阶段
- **作者**: 技术架构组

## 执行摘要

当前系统在节点选择时仅基于 ServiceType（ASR、NMT、TTS）进行过滤，**未考虑语言对匹配**。这导致调度服务器可能将任务分配给无法处理特定语言对的节点，造成任务失败或性能下降。

本方案设计了一套完整的**语言能力上报与匹配架构**，使节点端能够明确上报支持的语言对（如中译英、英译中等），调度服务器能够基于语言对进行精确的节点选择。

## 1. 问题分析

### 1.1 当前问题

1. **节点能力信息不完整**
   - 节点仅上报 ServiceType 级别的能力（ASR、NMT、TTS）
   - 未上报支持的语言对信息
   - `InstalledModel` 中的 `src_lang` 和 `tgt_lang` 未被用于节点选择

2. **调度服务器无法进行语言匹配**
   - 节点选择逻辑只检查 `capability_by_type.ready`
   - 不检查节点是否支持请求的语言对
   - 可能导致任务分配给错误的节点

3. **多语言模型支持不明确**
   - M2M100 等模型支持多种语言对，但节点未明确上报
   - 无法区分节点支持的语言对范围

### 1.2 影响范围

- **任务失败率增加**：节点收到不支持的语言对任务
- **资源浪费**：任务被分配到错误节点后需要重试
- **用户体验下降**：翻译质量不稳定或任务延迟

## 2. 设计目标

### 2.1 核心目标

1. **精确的语言对匹配**：调度服务器能够根据 `(src_lang, tgt_lang)` 选择有能力处理的节点
2. **支持多语言模型**：能够表示节点支持的语言对集合（如 M2M100 支持 100+ 语言对）
3. **向后兼容**：新架构不影响现有节点和调度逻辑
4. **性能优化**：语言对匹配不应显著增加节点选择延迟

### 2.2 非功能性需求

- **可扩展性**：支持未来新增语言和语言对
- **可观测性**：提供语言对能力的监控和统计
- **容错性**：节点语言能力上报失败时不影响基本功能

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      节点端 (Node)                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐      ┌──────────────────┐            │
│  │  服务管理器      │      │  语言能力检测器   │            │
│  │ ServiceManager   │─────▶│ LanguageCapability│            │
│  │                  │      │    Detector       │            │
│  └──────────────────┘      └──────────────────┘            │
│         │                            │                      │
│         │                            │                      │
│         ▼                            ▼                      │
│  ┌──────────────────────────────────────────┐              │
│  │     语言能力聚合器                        │              │
│  │  LanguageCapabilityAggregator             │              │
│  │  - 从服务收集语言对信息                   │              │
│  │  - 聚合为节点级语言能力                   │              │
│  └──────────────────────────────────────────┘              │
│         │                                                  │
│         ▼                                                  │
│  ┌──────────────────────────────────────────┐              │
│  │     节点注册/心跳                        │              │
│  │  NodeRegister / NodeHeartbeat            │              │
│  │  + language_capabilities                 │              │
│  └──────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   调度服务器 (Scheduler)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────┐                │
│  │     语言能力索引                        │                │
│  │  LanguageCapabilityIndex                 │                │
│  │  - 按语言对索引节点                     │                │
│  │  - 支持快速查询                         │                │
│  └──────────────────────────────────────────┘                │
│         │                                                  │
│         ▼                                                  │
│  ┌──────────────────────────────────────────┐                │
│  │     节点选择器（增强）                   │                │
│  │  NodeSelector (Enhanced)                 │                │
│  │  - 语言对匹配过滤                        │                │
│  │  - 与现有逻辑集成                        │                │
│  └──────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据模型设计

#### 3.2.1 语言对能力定义

```typescript
// 节点端支持的语言对能力
interface LanguagePairCapability {
  /** 源语言代码（ISO 639-1，如 "zh", "en"） */
  src_lang: string;
  
  /** 目标语言代码（ISO 639-1，如 "zh", "en"） */
  tgt_lang: string;
  
  /** 支持的服务类型（ASR、NMT、TTS） */
  service_types: ServiceType[];
  
  /** 能力质量等级（可选） */
  quality_level?: 'high' | 'medium' | 'low';
  
  /** 支持该语言对的服务实现ID列表 */
  service_ids?: string[];
}

// 节点级语言能力汇总
interface NodeLanguageCapability {
  /** 支持的语言对列表 */
  language_pairs: LanguagePairCapability[];
  
  /** 支持的语言列表（去重） */
  supported_languages: string[];
  
  /** 多语言模型支持的语言对（如 M2M100） */
  multilingual_pairs?: {
    /** 模型ID */
    model_id: string;
    /** 支持的语言对列表 */
    pairs: Array<{ src_lang: string; tgt_lang: string }>;
  }[];
}
```

#### 3.2.2 协议扩展

**节点注册消息扩展**：

```rust
// central_server/scheduler/src/messages/node.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeRegister {
    // ... 现有字段 ...
    
    /// 语言能力信息（新增，可选，向后兼容）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_capabilities: Option<NodeLanguageCapability>,
}
```

**节点心跳消息扩展**：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHeartbeat {
    // ... 现有字段 ...
    
    /// 语言能力信息（新增，可选，向后兼容）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_capabilities: Option<NodeLanguageCapability>,
}
```

### 3.3 节点端实现

#### 3.3.1 语言能力检测器

**职责**：
- 从已安装的服务和模型中提取语言对信息
- 检测多语言模型支持的语言对
- 聚合为节点级语言能力

**实现位置**：`electron_node/electron-node/main/src/agent/node-agent-language-capability.ts`

```typescript
export class LanguageCapabilityDetector {
  /**
   * 检测节点的语言能力
   */
  async detectLanguageCapabilities(
    installedServices: InstalledService[],
    installedModels: InstalledModel[]
  ): Promise<NodeLanguageCapability> {
    const languagePairs: LanguagePairCapability[] = [];
    const supportedLanguages = new Set<string>();
    const multilingualModels: MultilingualModelInfo[] = [];

    // 1. 从 NMT 服务检测语言对
    const nmtServices = installedServices.filter(s => s.type === ServiceType.NMT);
    for (const service of nmtServices) {
      const pairs = await this.detectNMTLanguagePairs(service, installedModels);
      languagePairs.push(...pairs);
      
      // 检查是否为多语言模型（如 M2M100）
      if (this.isMultilingualModel(service.model_id)) {
        multilingualModels.push({
          model_id: service.model_id,
          pairs: pairs.map(p => ({ src_lang: p.src_lang, tgt_lang: p.tgt_lang }))
        });
      }
    }

    // 2. 从 ASR 服务检测支持的语言
    const asrServices = installedServices.filter(s => s.type === ServiceType.ASR);
    for (const service of asrServices) {
      const langs = await this.detectASRLanguages(service, installedModels);
      langs.forEach(lang => supportedLanguages.add(lang));
    }

    // 3. 从 TTS 服务检测支持的语言
    const ttsServices = installedServices.filter(s => s.type === ServiceType.TTS);
    for (const service of ttsServices) {
      const langs = await this.detectTTSLanguages(service, installedModels);
      langs.forEach(lang => supportedLanguages.add(lang));
    }

    // 4. 聚合语言对（考虑 ASR + NMT + TTS 的完整链路）
    const completePairs = this.aggregateCompleteLanguagePairs(
      languagePairs,
      Array.from(supportedLanguages)
    );

    return {
      language_pairs: completePairs,
      supported_languages: Array.from(supportedLanguages),
      multilingual_pairs: multilingualModels.length > 0 ? multilingualModels : undefined
    };
  }

  /**
   * 检测 NMT 服务的语言对
   * 
   * 注意：由于 ModelHub 返回的语言信息不完整（默认 ["zh", "en"]），
   * 需要优先从服务运行时查询，回退到模型信息。
   */
  private async detectNMTLanguagePairs(
    service: InstalledService,
    models: InstalledModel[]
  ): Promise<LanguagePairCapability[]> {
    const pairs: LanguagePairCapability[] = [];

    // 优先级1：如果是多语言模型（如 M2M100），从服务查询支持的语言对
    if (this.isMultilingualModel(service.service_id)) {
      const multilingualPairs = await this.queryMultilingualModelPairs(service);
      if (multilingualPairs.length > 0) {
        return multilingualPairs;
      }
    }

    // 优先级2：从模型信息中提取语言对（可能不完整）
    const nmtModels = models.filter(m => m.kind === 'nmt');
    for (const model of nmtModels) {
      if (model.src_lang && model.tgt_lang) {
        pairs.push({
          src_lang: model.src_lang,
          tgt_lang: model.tgt_lang,
          service_types: [ServiceType.NMT],
          service_ids: [service.service_id]
        });
      }
    }

    // 优先级3：如果模型信息不完整，使用已知映射表（回退）
    if (pairs.length === 0 && this.isMultilingualModel(service.service_id)) {
      const fallbackPairs = this.getFallbackLanguagePairs(service.service_id);
      pairs.push(...fallbackPairs);
    }

    return pairs;
  }

  /**
   * 判断是否为多语言模型
   * 注意：通过 service_id 判断，因为 model_id 可能未填充
   */
  private isMultilingualModel(serviceId: string): boolean {
    // M2M100 是多语言模型
    if (serviceId === 'nmt-m2m100') return true;
    // Whisper 是多语言模型
    if (serviceId === 'faster-whisper-vad' || serviceId === 'node-inference') return true;
    return false;
  }

  /**
   * 查询多语言模型支持的语言对
   * 优先从服务运行时查询，如果失败则使用回退方案
   */
  private async queryMultilingualModelPairs(
    service: InstalledService
  ): Promise<LanguagePairCapability[]> {
    // 尝试从服务查询能力接口
    try {
      // 需要获取服务的 baseUrl（需要从 TaskRouter 或 ServiceEndpoint 获取）
      const baseUrl = await this.getServiceBaseUrl(service.service_id);
      if (baseUrl) {
        const response = await fetch(`${baseUrl}/capabilities`, {
          timeout: 2000 // 2秒超时
        });
        if (response.ok) {
          const data = await response.json();
          if (data.supported_pairs && Array.isArray(data.supported_pairs)) {
            return data.supported_pairs.map((pair: any) => ({
              src_lang: pair.src_lang || pair.src,
              tgt_lang: pair.tgt_lang || pair.tgt,
              service_types: [ServiceType.NMT],
              service_ids: [service.service_id]
            }));
          }
        }
      }
    } catch (error) {
      logger.debug({ 
        serviceId: service.service_id, 
        error: error instanceof Error ? error.message : String(error) 
      }, 'Failed to query service capabilities, will use fallback');
    }
    
    // 查询失败，返回空数组，让调用者使用回退方案
    return [];
  }

  /**
   * 获取服务的 baseUrl
   * 需要从 TaskRouter 或 ServiceEndpoint 获取
   */
  private async getServiceBaseUrl(serviceId: string): Promise<string | null> {
    // TODO: 实现从 TaskRouter 获取服务的 baseUrl
    // 这需要注入 TaskRouter 或 ServiceEndpoint 查询器
    return null;
  }

  /**
   * 获取回退语言对列表（当服务查询失败时使用）
   */
  private getFallbackLanguagePairs(serviceId: string): LanguagePairCapability[] {
    // 已知的多语言模型语言对映射表
    const fallbackMap: Record<string, Array<{ src_lang: string; tgt_lang: string }>> = {
      'nmt-m2m100': [
        { src_lang: 'zh', tgt_lang: 'en' },
        { src_lang: 'en', tgt_lang: 'zh' },
        { src_lang: 'zh', tgt_lang: 'ja' },
        { src_lang: 'ja', tgt_lang: 'zh' },
        { src_lang: 'zh', tgt_lang: 'ko' },
        { src_lang: 'ko', tgt_lang: 'zh' },
        // 注意：M2M100 实际支持更多语言对，这里只列出常用的
        // 完整列表需要从服务查询或模型配置获取
      ],
      'faster-whisper-vad': [], // ASR 不返回语言对，只返回支持的语言列表
      'node-inference': [], // ASR 不返回语言对
    };

    const pairs = fallbackMap[serviceId] || [];
    return pairs.map(pair => ({
      src_lang: pair.src_lang,
      tgt_lang: pair.tgt_lang,
      service_types: [ServiceType.NMT],
      service_ids: [serviceId]
    }));
  }

  /**
   * 聚合完整的语言对（考虑 ASR + NMT + TTS 链路）
   */
  private aggregateCompleteLanguagePairs(
    nmtPairs: LanguagePairCapability[],
    supportedLanguages: string[]
  ): LanguagePairCapability[] {
    const completePairs: LanguagePairCapability[] = [];

    for (const pair of nmtPairs) {
      // 检查 ASR 是否支持源语言
      const asrSupportsSrc = supportedLanguages.includes(pair.src_lang);
      // 检查 TTS 是否支持目标语言
      const ttsSupportsTgt = supportedLanguages.includes(pair.tgt_lang);

      // 构建完整的服务类型列表
      const serviceTypes: ServiceType[] = [];
      if (asrSupportsSrc) serviceTypes.push(ServiceType.ASR);
      serviceTypes.push(ServiceType.NMT);
      if (ttsSupportsTgt) serviceTypes.push(ServiceType.TTS);

      completePairs.push({
        ...pair,
        service_types: serviceTypes
      });
    }

    return completePairs;
  }
}
```

#### 3.3.2 节点注册/心跳集成

**修改位置**：`electron_node/electron-node/main/src/agent/node-agent-registration.ts`

```typescript
export class RegistrationHandler {
  private languageCapabilityDetector: LanguageCapabilityDetector;

  async registerNode(): Promise<void> {
    // ... 现有代码 ...

    // 检测语言能力
    const languageCapabilities = await this.languageCapabilityDetector
      .detectLanguageCapabilities(installedServicesAll, installedModels);

    const message: NodeRegisterMessage = {
      // ... 现有字段 ...
      language_capabilities: languageCapabilities, // 新增
    };

    // ... 发送注册消息 ...
  }
}
```

### 3.4 调度服务器实现

#### 3.4.1 语言能力索引

**职责**：
- 维护节点语言能力的索引结构
- 支持快速查询支持特定语言对的节点
- 处理节点能力更新

**实现位置**：`central_server/scheduler/src/node_registry/language_capability_index.rs`

```rust
use std::collections::{HashMap, HashSet};
use crate::messages::ServiceType;

/// 语言对（源语言 -> 目标语言）
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct LanguagePair {
    pub src_lang: String,
    pub tgt_lang: String,
}

/// 语言能力索引
pub struct LanguageCapabilityIndex {
    /// 按语言对索引的节点ID集合
    /// (src_lang, tgt_lang) -> Set<node_id>
    pair_to_nodes: HashMap<LanguagePair, HashSet<String>>,
    
    /// 节点支持的语言对集合
    /// node_id -> Set<LanguagePair>
    node_to_pairs: HashMap<String, HashSet<LanguagePair>>,
    
    /// 节点支持的语言列表
    /// node_id -> Set<lang>
    node_to_languages: HashMap<String, HashSet<String>>,
}

impl LanguageCapabilityIndex {
    pub fn new() -> Self {
        Self {
            pair_to_nodes: HashMap::new(),
            node_to_pairs: HashMap::new(),
            node_to_languages: HashMap::new(),
        }
    }

    /// 更新节点的语言能力
    pub fn update_node_capabilities(
        &mut self,
        node_id: &str,
        capabilities: &Option<NodeLanguageCapability>,
    ) {
        // 先清除旧的能力信息
        self.remove_node(node_id);

        if let Some(caps) = capabilities {
            let mut node_pairs = HashSet::new();
            let mut node_languages = HashSet::new();

            // 处理语言对
            for pair in &caps.language_pairs {
                let lang_pair = LanguagePair {
                    src_lang: pair.src_lang.clone(),
                    tgt_lang: pair.tgt_lang.clone(),
                };

                // 添加到索引
                self.pair_to_nodes
                    .entry(lang_pair.clone())
                    .or_insert_with(HashSet::new)
                    .insert(node_id.to_string());

                node_pairs.insert(lang_pair);
                node_languages.insert(pair.src_lang.clone());
                node_languages.insert(pair.tgt_lang.clone());
            }

            // 处理多语言模型
            if let Some(multilingual) = &caps.multilingual_pairs {
                for model in multilingual {
                    for pair in &model.pairs {
                        let lang_pair = LanguagePair {
                            src_lang: pair.src_lang.clone(),
                            tgt_lang: pair.tgt_lang.clone(),
                        };

                        self.pair_to_nodes
                            .entry(lang_pair.clone())
                            .or_insert_with(HashSet::new)
                            .insert(node_id.to_string());

                        node_pairs.insert(lang_pair);
                        node_languages.insert(pair.src_lang.clone());
                        node_languages.insert(pair.tgt_lang.clone());
                    }
                }
            }

            // 更新节点到语言对的映射
            if !node_pairs.is_empty() {
                self.node_to_pairs.insert(node_id.to_string(), node_pairs);
            }

            // 更新节点到语言的映射
            if !node_languages.is_empty() {
                self.node_to_languages.insert(node_id.to_string(), node_languages);
            }
        }
    }

    /// 查找支持特定语言对的节点
    pub fn find_nodes_for_language_pair(
        &self,
        src_lang: &str,
        tgt_lang: &str,
    ) -> HashSet<String> {
        let lang_pair = LanguagePair {
            src_lang: src_lang.to_string(),
            tgt_lang: tgt_lang.to_string(),
        };

        self.pair_to_nodes
            .get(&lang_pair)
            .cloned()
            .unwrap_or_default()
    }

    /// 检查节点是否支持特定语言对
    pub fn node_supports_language_pair(
        &self,
        node_id: &str,
        src_lang: &str,
        tgt_lang: &str,
    ) -> bool {
        let lang_pair = LanguagePair {
            src_lang: src_lang.to_string(),
            tgt_lang: tgt_lang.to_string(),
        };

        self.node_to_pairs
            .get(node_id)
            .map(|pairs| pairs.contains(&lang_pair))
            .unwrap_or(false)
    }

    /// 移除节点的能力信息
    pub fn remove_node(&mut self, node_id: &str) {
        // 从所有语言对索引中移除该节点
        if let Some(pairs) = self.node_to_pairs.remove(node_id) {
            for pair in pairs {
                if let Some(nodes) = self.pair_to_nodes.get_mut(&pair) {
                    nodes.remove(node_id);
                    if nodes.is_empty() {
                        self.pair_to_nodes.remove(&pair);
                    }
                }
            }
        }

        self.node_to_languages.remove(node_id);
    }
}
```

#### 3.4.2 节点选择增强

**修改位置**：`central_server/scheduler/src/node_registry/selection/selection_types.rs`

```rust
impl NodeRegistry {
    pub async fn select_node_with_types(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_types: &[ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        // ... 现有代码 ...

        // 新增：语言对匹配过滤
        let language_capable_nodes: HashSet<String> = if src_lang != "auto" {
            // 如果源语言不是 auto，进行语言对匹配
            self.language_capability_index
                .read()
                .await
                .find_nodes_for_language_pair(src_lang, tgt_lang)
        } else {
            // 如果源语言是 auto，暂时不进行语言对过滤
            // 或者可以根据目标语言过滤
            HashSet::new()
        };

        for node in nodes.values() {
            // ... 现有过滤逻辑 ...

            // 新增：语言对匹配检查
            if src_lang != "auto" {
                if !language_capable_nodes.contains(&node.node_id) {
                    // 节点不支持该语言对，但不在 breakdown 中单独计数
                    // 因为这是新增的过滤条件，不影响现有统计
                    continue;
                }
            }

            available_nodes.push(node);
        }

        // ... 后续代码 ...
    }
}
```

### 3.5 双向模式支持

对于双向翻译模式（`two_way_auto`），需要支持两个方向的语言对：

```rust
// 双向模式：检查节点是否支持两个方向
pub fn node_supports_bidirectional(
    &self,
    node_id: &str,
    lang_a: &str,
    lang_b: &str,
) -> bool {
    // 检查 A -> B 和 B -> A 两个方向
    self.node_supports_language_pair(node_id, lang_a, lang_b)
        && self.node_supports_language_pair(node_id, lang_b, lang_a)
}
```

## 4. 实施计划

### 4.1 阶段一：基础架构（2周）

**目标**：建立语言能力数据模型和索引结构

**任务**：
1. 定义语言能力数据模型（TypeScript + Rust）
2. 实现调度服务器端的语言能力索引
3. 扩展节点注册/心跳协议
4. 单元测试

**交付物**：
- 数据模型定义
- 语言能力索引实现
- 协议扩展

### 4.2 阶段二：节点端实现（2周）

**目标**：节点端能够检测并上报语言能力

**任务**：
1. 实现语言能力检测器
2. 集成到节点注册和心跳流程
3. 从服务/模型配置中提取语言对信息
4. 端到端测试

**交付物**：
- 语言能力检测器实现
- 节点注册/心跳集成
- 测试报告

### 4.3 阶段三：调度服务器集成（2周）

**目标**：调度服务器基于语言对进行节点选择

**任务**：
1. 在节点选择逻辑中集成语言对匹配
2. 处理 `src_lang="auto"` 的特殊情况
3. 支持双向模式
4. 性能优化

**交付物**：
- 增强的节点选择逻辑
- 性能测试报告
- 集成测试报告

### 4.4 阶段四：监控和优化（1周）

**目标**：完善监控和可观测性

**任务**：
1. 添加语言对匹配的监控指标
2. 添加语言能力统计
3. 优化索引查询性能
4. 文档完善

**交付物**：
- 监控仪表板
- 性能优化报告
- 完整文档

## 5. 向后兼容性

### 5.1 协议兼容

- `language_capabilities` 字段为可选（`Option`）
- 旧版本节点不提供该字段时，调度服务器回退到现有逻辑
- 新版本节点必须提供该字段

### 5.2 渐进式部署

1. **第一阶段**：新节点上报语言能力，调度服务器记录但不使用
2. **第二阶段**：调度服务器使用语言能力进行节点选择，但允许回退
3. **第三阶段**：完全启用语言能力匹配，移除回退逻辑

## 6. 风险评估与缓解

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 语言能力检测不准确 | 高 | 中 | 提供手动配置覆盖，增加验证逻辑 |
| 性能影响 | 中 | 低 | 使用高效索引结构，进行性能测试 |
| 多语言模型查询失败 | 中 | 中 | 提供默认语言对列表，缓存查询结果 |

### 6.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 节点选择失败率增加 | 高 | 低 | 提供回退机制，逐步启用 |
| 部署复杂度增加 | 中 | 中 | 分阶段部署，充分测试 |

## 7. 成功指标

### 7.1 功能指标

- ✅ 节点能够准确上报支持的语言对
- ✅ 调度服务器能够基于语言对选择节点
- ✅ 任务分配准确率提升（支持语言对的节点被选中）

### 7.2 性能指标

- 节点选择延迟增加 < 10ms
- 语言能力索引内存占用 < 100MB（1000节点）
- 查询性能：O(1) 时间复杂度

### 7.3 业务指标

- 任务失败率降低 20%（因语言不匹配导致的失败）
- 节点利用率提升 15%（更精确的节点选择）

## 8. 后续优化方向

1. **语言对质量评分**：根据历史任务质量对语言对进行评分
2. **动态语言对发现**：运行时检测节点实际支持的语言对
3. **语言对负载均衡**：考虑各语言对的负载分布
4. **多语言模型优化**：针对 M2M100 等模型进行特殊优化

## 9. 重要说明

### 9.1 模型信息限制

**重要发现**：经过代码审查，发现节点端**无法完全直接从模型信息中获取准确的语言支持信息**。

**主要问题**：
1. ModelHub 返回的语言信息不完整（通过简单规则推断，默认 `["zh", "en"]`）
2. 多语言模型（M2M100、Whisper）支持100+语言，但模型信息中无法体现
3. 服务与模型关联不明确（`InstalledService.model_id` 字段未填充）

**解决方案**：
- 采用**多源信息聚合**策略：服务查询 > 模型配置 > ModelHub > 推断
- 为多语言模型添加能力查询接口
- 提供回退机制（已知映射表）

**详细分析**：请参考 [语言能力检测可行性分析](./LANGUAGE_CAPABILITY_DETECTION_ANALYSIS.md)

## 10. 附录

### 10.1 参考文档

- [节点选择失败诊断指南](./NODE_SELECTION_FAILURE_DIAGNOSIS.md)
- [ServiceType 能力模型文档](../architecture/SERVICE_TYPE_CAPABILITY_REFACTOR_SUMMARY.md)
- [语言能力检测可行性分析](./LANGUAGE_CAPABILITY_DETECTION_ANALYSIS.md)

### 9.2 相关代码位置

- 节点注册：`electron_node/electron-node/main/src/agent/node-agent-registration.ts`
- 节点选择：`central_server/scheduler/src/node_registry/selection/`
- 协议定义：`central_server/scheduler/src/messages/node.rs`

---

## 决策要点

**本方案需要决策的关键点**：

1. **是否采用本架构**：是否同意实施语言能力上报与匹配机制？
2. **实施优先级**：是否作为高优先级任务推进？
3. **资源分配**：开发、测试、部署的资源分配计划
4. **时间表**：是否同意 7 周的实施计划？

**建议**：建议采用本架构，分阶段实施，优先完成基础架构和节点端实现，确保向后兼容。
