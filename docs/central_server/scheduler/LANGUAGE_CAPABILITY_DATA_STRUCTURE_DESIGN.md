# 语言能力数据结构设计文档

## 文档信息

- **版本**: v1.0
- **日期**: 2025-01-XX
- **状态**: 设计阶段
- **目的**: 基于决策部门意见和官方模型信息，设计语言能力数据结构

## 1. 方案可行性评估

### 1.1 决策部门方案（v1.1）可行性分析

**✅ 完全可行**

决策部门提出的 v1.1 方案具有以下优势：

1. **避免语言对爆炸**：使用规则（`any_to_any`、`any_to_en`、`en_to_any`）而非枚举所有语言对
2. **拆分维度清晰**：ASR、TTS、NMT 分别处理，符合实际服务架构
3. **向后兼容**：`language_capabilities` 为可选字段，不影响现有节点
4. **实施简单**：不破坏现有 ServiceType 调度逻辑

### 1.2 实施要点

1. **语言代码规范化**：统一使用 ISO 639-1 标准（如 `zh`、`en`）
2. **能力来源优先级**：manual_override > service_capabilities_endpoint > installed_model_inference
3. **索引结构优化**：分别建立 ASR、TTS、NMT 的索引，提高查询效率

## 2. 模型官方语言支持信息

### 2.1 Whisper（ASR 模型）

**官方信息**：
- **支持语言数量**：99 种语言
- **语言列表**：包括但不限于以下语言

**主要支持语言**（ISO 639-1 代码）：
```
af, am, ar, as, az, ba, be, bg, bn, bo, br, bs, ca, cs, cy, da, de, el, en, es, et, eu, fa, fi, fo, fr, gl, gu, ha, haw, he, hi, hr, ht, hu, hy, id, is, it, ja, jw, ka, kk, km, kn, ko, la, lb, ln, lo, lt, lv, mg, mi, mk, ml, mn, mr, ms, mt, my, ne, nl, nn, no, oc, pa, pl, ps, pt, ro, ru, sa, sd, si, sk, sl, sn, so, sq, sr, su, sv, sw, ta, te, tg, th, tk, tl, tr, tt, uk, ur, uz, vi, yi, yo, zh
```

**特点**：
- 多语言模型，支持自动语言检测
- 所有语言共享同一个模型
- 支持的语言列表固定，不会因模型版本变化

### 2.2 M2M100（NMT 模型）

**官方信息**：
- **支持语言数量**：100 种语言
- **翻译能力**：支持任意语言对之间的翻译（any-to-any）

**主要支持语言**（ISO 639-1 代码）：
```
af, am, ar, as, az, be, bg, bn, br, bs, ca, cs, cy, da, de, el, en, es, et, fa, ff, fi, fr, ga, gl, gu, ha, he, hi, hr, hu, hy, id, ig, is, it, ja, jv, ka, kk, km, kn, ko, lb, lg, ln, lo, lt, lv, mg, mk, ml, mn, mr, ms, mt, my, ne, nl, no, ns, om, or, pa, pl, ps, pt, ro, ru, sd, si, sk, sl, so, sq, sr, ss, su, sv, sw, ta, te, tg, th, tk, tl, tr, tt, uk, ur, uz, vi, wo, xh, yi, yo, zh, zu
```

**特点**：
- 真正的多语言模型，支持任意语言对之间的翻译
- 规则：`any_to_any`（任意语言到任意语言）
- 无需枚举所有语言对，只需列出支持的语言列表

### 2.3 Piper TTS（TTS 模型）

**官方信息**：
- **模型类型**：单语言模型（每个模型只支持一种语言）
- **支持语言**：通过不同的语音模型支持多种语言

**主要支持语言**（通过不同的语音模型）：
```
en, zh, de, es, fr, it, nl, pl, pt, ru, uk, cs, tr, ar, ja, ko, vi, th, hi, bn, ta, te, kn, ml, mr, gu, pa, or, as, ne, si, my, km, lo, ka, hy, az, be, bg, mk, sr, hr, bs, sl, sk, ro, hu, fi, et, lv, lt, is, ga, cy, br, eu, ca, gl, oc, co, sc, it, mt, sq, el, mk, bg, sr, hr, bs, sl, sk, ro, hu, fi, et, lv, lt, is, ga, cy, br, eu, ca, gl, oc, co, sc, it, mt, sq, el
```

**特点**：
- 每个语音模型只支持一种语言
- 需要根据目标语言选择对应的语音模型
- 语言列表：列出节点已安装的语音模型对应的语言

## 3. 数据结构设计

### 3.1 节点语言能力数据结构（符合 v1.1 方案）

```typescript
/**
 * 节点语言能力（符合决策部门 v1.1 方案）
 */
interface NodeLanguageCapabilities {
  /** ASR 支持的语言列表 */
  asr_languages?: string[];
  
  /** TTS 支持的语言列表 */
  tts_languages?: string[];
  
  /** NMT 能力列表（支持多个 NMT 模型） */
  nmt_capabilities?: NmtCapability[];
}

/**
 * NMT 能力（避免语言对爆炸）
 */
interface NmtCapability {
  /** 模型ID（如 "m2m100-418M"） */
  model_id: string;
  
  /** 支持的语言列表（ISO 639-1 代码） */
  languages: string[];
  
  /** 翻译规则 */
  rule: "any_to_any" | "any_to_en" | "en_to_any" | "specific_pairs";
  
  /** 被阻止的语言对（当 rule 为 "any_to_any" 时使用） */
  blocked_pairs?: Array<{ src: string; tgt: string }>;
  
  /** 明确支持的语言对（当 rule 为 "specific_pairs" 时使用） */
  supported_pairs?: Array<{ src: string; tgt: string }>;
}
```

### 3.2 模型语言能力元数据（用于节点端生成能力）

```typescript
/**
 * 模型语言能力元数据（存储在节点端或 ModelHub）
 * 用于节点端自动生成语言能力
 */
interface ModelLanguageMetadata {
  /** 模型ID */
  model_id: string;
  
  /** 模型类型 */
  model_type: "asr" | "nmt" | "tts";
  
  /** 模型名称 */
  model_name: string;
  
  /** 支持的语言列表（ISO 639-1 代码） */
  supported_languages: string[];
  
  /** NMT 专用：翻译规则 */
  nmt_rule?: "any_to_any" | "any_to_en" | "en_to_any" | "specific_pairs";
  
  /** NMT 专用：被阻止的语言对 */
  nmt_blocked_pairs?: Array<{ src: string; tgt: string }>;
  
  /** NMT 专用：明确支持的语言对（当 rule 为 "specific_pairs" 时） */
  nmt_supported_pairs?: Array<{ src: string; tgt: string }>;
  
  /** 数据来源 */
  source: "official" | "manual" | "inferred";
  
  /** 最后更新时间 */
  last_updated: string; // ISO 8601
}
```

### 3.3 模型语言能力数据库（JSON 格式）

```json
{
  "version": "1.0",
  "last_updated": "2025-01-XX",
  "models": [
    {
      "model_id": "faster-whisper-large-v3",
      "model_type": "asr",
      "model_name": "Faster Whisper Large V3",
      "supported_languages": [
        "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs",
        "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi",
        "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy",
        "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb",
        "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt",
        "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru",
        "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw",
        "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi",
        "yi", "yo", "zh"
      ],
      "source": "official",
      "last_updated": "2025-01-XX"
    },
    {
      "model_id": "m2m100-418M",
      "model_type": "nmt",
      "model_name": "M2M100 418M",
      "supported_languages": [
        "af", "am", "ar", "as", "az", "be", "bg", "bn", "br", "bs", "ca", "cs",
        "cy", "da", "de", "el", "en", "es", "et", "fa", "ff", "fi", "fr", "ga",
        "gl", "gu", "ha", "he", "hi", "hr", "hu", "hy", "id", "ig", "is", "it",
        "ja", "jv", "ka", "kk", "km", "kn", "ko", "lb", "lg", "ln", "lo", "lt",
        "lv", "mg", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "no",
        "ns", "om", "or", "pa", "pl", "ps", "pt", "ro", "ru", "sd", "si", "sk",
        "sl", "so", "sq", "sr", "ss", "su", "sv", "sw", "ta", "te", "tg", "th",
        "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "wo", "xh", "yi", "yo",
        "zh", "zu"
      ],
      "nmt_rule": "any_to_any",
      "source": "official",
      "last_updated": "2025-01-XX"
    },
    {
      "model_id": "m2m100-1.2B",
      "model_type": "nmt",
      "model_name": "M2M100 1.2B",
      "supported_languages": [
        "af", "am", "ar", "as", "az", "be", "bg", "bn", "br", "bs", "ca", "cs",
        "cy", "da", "de", "el", "en", "es", "et", "fa", "ff", "fi", "fr", "ga",
        "gl", "gu", "ha", "he", "hi", "hr", "hu", "hy", "id", "ig", "is", "it",
        "ja", "jv", "ka", "kk", "km", "kn", "ko", "lb", "lg", "ln", "lo", "lt",
        "lv", "mg", "mk", "ml", "mn", "mr", "ms", "mt", "my", "ne", "nl", "no",
        "ns", "om", "or", "pa", "pl", "ps", "pt", "ro", "ru", "sd", "si", "sk",
        "sl", "so", "sq", "sr", "ss", "su", "sv", "sw", "ta", "te", "tg", "th",
        "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "wo", "xh", "yi", "yo",
        "zh", "zu"
      ],
      "nmt_rule": "any_to_any",
      "source": "official",
      "last_updated": "2025-01-XX"
    },
    {
      "model_id": "piper-tts-zh",
      "model_type": "tts",
      "model_name": "Piper TTS Chinese",
      "supported_languages": ["zh"],
      "source": "official",
      "last_updated": "2025-01-XX"
    },
    {
      "model_id": "piper-tts-en",
      "model_type": "tts",
      "model_name": "Piper TTS English",
      "supported_languages": ["en"],
      "source": "official",
      "last_updated": "2025-01-XX"
    }
  ]
}
```

## 4. 节点端能力生成逻辑

### 4.1 能力生成流程

```typescript
/**
 * 生成节点语言能力
 */
async function generateNodeLanguageCapabilities(
  installedServices: InstalledService[],
  installedModels: InstalledModel[],
  modelMetadata: ModelLanguageMetadata[],
  capability_by_type: CapabilityByType[]  // P0-3: 需要检查 ready 状态
): Promise<NodeLanguageCapabilities> {
  const capabilities: NodeLanguageCapabilities = {
    asr_languages: [],
    tts_languages: [],
    nmt_capabilities: []
  };

  // P0-3: 只处理 READY 状态的服务
  const readyServices = installedServices.filter(s => {
    // 检查服务状态为 running
    if (s.status !== 'running') return false;
    // 检查 capability_by_type 中对应类型为 ready
    const capability = capability_by_type.find(c => c.type === s.type);
    return capability?.ready === true;
  });

  // 1. 处理 ASR 服务（P0-3: 只统计 READY 状态）
  const asrServices = readyServices.filter(s => s.type === ServiceType.ASR);
  for (const service of asrServices) {
    // 优先级1：从服务查询
    const serviceLangs = await queryServiceLanguages(service.service_id);
    if (serviceLangs.length > 0) {
      capabilities.asr_languages.push(...serviceLangs);
      continue;
    }
    
    // 优先级2：从模型元数据获取
    const modelMeta = findModelMetadata(service.model_id, modelMetadata, 'asr');
    if (modelMeta) {
      capabilities.asr_languages.push(...modelMeta.supported_languages);
      continue;
    }
    
    // 优先级3：从已安装模型推断
    const asrModels = installedModels.filter(m => m.kind === 'asr');
    for (const model of asrModels) {
      if (model.src_lang) {
        capabilities.asr_languages.push(model.src_lang);
      }
    }
    
    // 优先级4：使用默认值（Whisper 支持的语言）
    if (capabilities.asr_languages.length === 0) {
      capabilities.asr_languages = getWhisperDefaultLanguages();
    }
  }

  // 2. 处理 TTS 服务（P0-3: 只统计 READY 状态）
  const ttsServices = readyServices.filter(s => s.type === ServiceType.TTS);
  for (const service of ttsServices) {
    // 优先级1：从服务查询
    const serviceLangs = await queryServiceLanguages(service.service_id);
    if (serviceLangs.length > 0) {
      capabilities.tts_languages.push(...serviceLangs);
      continue;
    }
    
    // 优先级2：从模型元数据获取
    const modelMeta = findModelMetadata(service.model_id, modelMetadata, 'tts');
    if (modelMeta) {
      capabilities.tts_languages.push(...modelMeta.supported_languages);
      continue;
    }
    
    // 优先级3：从已安装模型推断
    const ttsModels = installedModels.filter(m => m.kind === 'tts');
    for (const model of ttsModels) {
      if (model.tgt_lang) {
        capabilities.tts_languages.push(model.tgt_lang);
      }
    }
  }

  // 3. 处理 NMT 服务（P0-3: 只统计 READY 状态）
  const nmtServices = readyServices.filter(s => s.type === ServiceType.NMT);
  for (const service of nmtServices) {
    // 优先级1：从服务查询
    const serviceCapability = await queryServiceNmtCapability(service.service_id);
    if (serviceCapability) {
      capabilities.nmt_capabilities.push(serviceCapability);
      continue;
    }
    
    // 优先级2：从模型元数据获取
    const modelMeta = findModelMetadata(service.model_id, modelMetadata, 'nmt');
    if (modelMeta) {
      capabilities.nmt_capabilities.push({
        model_id: service.model_id || modelMeta.model_id,
        languages: modelMeta.supported_languages,
        rule: modelMeta.nmt_rule || 'any_to_any',
        blocked_pairs: modelMeta.nmt_blocked_pairs,
        supported_pairs: modelMeta.nmt_supported_pairs
      });
      continue;
    }
    
    // 优先级3：从已安装模型推断
    const nmtModels = installedModels.filter(m => m.kind === 'nmt');
    for (const model of nmtModels) {
      if (model.src_lang && model.tgt_lang) {
        // 推断为 specific_pairs 规则
        capabilities.nmt_capabilities.push({
          model_id: model.model_id,
          languages: [model.src_lang, model.tgt_lang],
          rule: 'specific_pairs',
          supported_pairs: [
            { src: model.src_lang, tgt: model.tgt_lang }
          ]
        });
      }
    }
  }

  // 去重和规范化
  capabilities.asr_languages = normalizeLanguages([...new Set(capabilities.asr_languages)]);
  capabilities.tts_languages = normalizeLanguages([...new Set(capabilities.tts_languages)]);

  return capabilities;
}
```

### 4.2 语言代码规范化（P1-1: 增强版）

```typescript
/**
 * 规范化语言代码（ISO 639-1）
 * P1-1: 统一大小写、处理别名、排除 auto
 */
function normalizeLanguageCode(lang: string): string {
  // 统一转为小写
  const lower = lang.toLowerCase();
  
  // 处理语言代码变体
  const normalizationMap: Record<string, string> = {
    'zh-cn': 'zh',
    'zh-tw': 'zh',
    'zh-hans': 'zh',
    'zh-hant': 'zh',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    'en-us': 'en',
    'en-gb': 'en',
    'in': 'id',  // 印尼语旧代码
    'iw': 'he',  // 希伯来语旧代码
  };
  
  return normalizationMap[lower] || lower;
}

/**
 * 规范化语言列表
 */
function normalizeLanguages(languages: string[]): string[] {
  return languages
    .map(lang => normalizeLanguageCode(lang))
    .filter(lang => lang !== 'auto')  // P1-1: auto 不进入索引
    .filter((lang, index, self) => self.indexOf(lang) === index); // 去重
}
```

## 5. 调度端索引构建（修订版 - 基于审阅反馈）

### 5.1 索引结构实现（优化后）

**重要修订**：根据审阅反馈，`any_to_any` 规则**不展开为 N×N pairs**，改为规则匹配模式。

```rust
// central_server/scheduler/src/node_registry/language_capability_index.rs

pub struct LanguageCapabilityIndex {
    /// ASR 语言索引: lang -> Set<node_id>
    by_asr_lang: HashMap<String, HashSet<String>>,
    
    /// TTS 语言索引: lang -> Set<node_id>
    by_tts_lang: HashMap<String, HashSet<String>>,
    
    /// NMT 节点能力列表（不展开语言对，使用规则匹配）
    nmt_nodes: Vec<NmtNodeCapability>,
}

/// NMT 节点能力（存储规则而非展开的语言对）
struct NmtNodeCapability {
    node_id: String,
    model_id: String,
    languages: HashSet<String>,  // 支持的语言集合
    rule: NmtRule,
    blocked_pairs: HashSet<(String, String)>,  // P0-2: 使用 HashSet 而非 Vec
}

enum NmtRule {
    AnyToAny,
    AnyToEn,
    EnToAny,
    SpecificPairs(HashSet<(String, String)>),  // 明确支持的语言对
}

impl LanguageCapabilityIndex {
    pub fn update_node_capabilities(
        &mut self,
        node_id: &str,
        capabilities: &Option<NodeLanguageCapabilities>,
    ) {
        // 先清除旧的能力信息
        self.remove_node(node_id);

        if let Some(caps) = capabilities {
            // 更新 ASR 索引
            if let Some(asr_langs) = &caps.asr_languages {
                for lang in asr_langs {
                    let normalized_lang = normalize_language_code(lang);
                    if normalized_lang != "auto" {  // P1-1: auto 不进入索引
                        self.by_asr_lang
                            .entry(normalized_lang)
                            .or_insert_with(HashSet::new)
                            .insert(node_id.to_string());
                    }
                }
            }

            // 更新 TTS 索引
            if let Some(tts_langs) = &caps.tts_languages {
                for lang in tts_langs {
                    let normalized_lang = normalize_language_code(lang);
                    if normalized_lang != "auto" {
                        self.by_tts_lang
                            .entry(normalized_lang)
                            .or_insert_with(HashSet::new)
                            .insert(node_id.to_string());
                    }
                }
            }

            // 更新 NMT 索引（P0-1: 不展开 any_to_any，存储规则）
            if let Some(nmt_caps) = &caps.nmt_capabilities {
                for nmt_cap in nmt_caps {
                    let languages: HashSet<String> = nmt_cap.languages
                        .iter()
                        .map(|l| normalize_language_code(l))
                        .filter(|l| l != "auto")
                        .collect();
                    
                    // P0-2: blocked_pairs 预处理为 HashSet
                    let blocked_pairs: HashSet<(String, String)> = nmt_cap.blocked_pairs
                        .as_ref()
                        .map(|bp| {
                            bp.iter()
                                .map(|p| (
                                    normalize_language_code(&p.src),
                                    normalize_language_code(&p.tgt)
                                ))
                                .collect()
                        })
                        .unwrap_or_default();
                    
                    let rule = match nmt_cap.rule.as_str() {
                        "any_to_any" => NmtRule::AnyToAny,
                        "any_to_en" => NmtRule::AnyToEn,
                        "en_to_any" => NmtRule::EnToAny,
                        "specific_pairs" => {
                            let pairs: HashSet<(String, String)> = nmt_cap.supported_pairs
                                .as_ref()
                                .map(|sp| {
                                    sp.iter()
                                        .map(|p| (
                                            normalize_language_code(&p.src),
                                            normalize_language_code(&p.tgt)
                                        ))
                                        .collect()
                                })
                                .unwrap_or_default();
                            NmtRule::SpecificPairs(pairs)
                        }
                        _ => continue,
                    };
                    
                    self.nmt_nodes.push(NmtNodeCapability {
                        node_id: node_id.to_string(),
                        model_id: nmt_cap.model_id.clone(),
                        languages,
                        rule,
                        blocked_pairs,
                    });
                }
            }
        }
    }

    /// 查找支持特定 NMT 语言对的节点（P0-1: 规则匹配而非索引查找）
    pub fn find_nodes_for_nmt_pair(
        &self,
        src_lang: &str,
        tgt_lang: &str,
    ) -> HashSet<String> {
        let normalized_src = normalize_language_code(src_lang);
        let normalized_tgt = normalize_language_code(tgt_lang);
        
        if normalized_src == "auto" || normalized_tgt == "auto" {
            return HashSet::new();
        }
        
        let mut result = HashSet::new();
        
        for nmt_node in &self.nmt_nodes {
            // P0-2: O(1) 判断 blocked_pairs
            let pair = (normalized_src.clone(), normalized_tgt.clone());
            if nmt_node.blocked_pairs.contains(&pair) {
                continue;
            }
            
            let matches = match &nmt_node.rule {
                NmtRule::AnyToAny => {
                    // 任意语言到任意语言：检查两个语言都在支持列表中
                    nmt_node.languages.contains(&normalized_src) 
                        && nmt_node.languages.contains(&normalized_tgt)
                }
                NmtRule::AnyToEn => {
                    // 任意语言到英文：源语言在列表中，目标语言是 en
                    nmt_node.languages.contains(&normalized_src) 
                        && normalized_tgt == "en"
                }
                NmtRule::EnToAny => {
                    // 英文到任意语言：源语言是 en，目标语言在列表中
                    normalized_src == "en" 
                        && nmt_node.languages.contains(&normalized_tgt)
                }
                NmtRule::SpecificPairs(pairs) => {
                    // 明确支持的语言对：直接查找
                    pairs.contains(&pair)
                }
            };
            
            if matches {
                result.insert(nmt_node.node_id.clone());
            }
        }
        
        result
    }
    
    /// 语言代码规范化（P1-1: 统一大小写、处理别名）
    fn normalize_language_code(lang: &str) -> String {
        let normalized = lang.to_lowercase();
        
        // 处理语言代码变体
        match normalized.as_str() {
            "zh-cn" | "zh-tw" | "zh-hans" | "zh-hant" => "zh".to_string(),
            "pt-br" | "pt-pt" => "pt".to_string(),
            "en-us" | "en-gb" => "en".to_string(),
            "in" => "id".to_string(),  // 印尼语旧代码
            "iw" => "he".to_string(),  // 希伯来语旧代码
            _ => normalized,
        }
    }

    /// 查找支持特定 ASR 语言的节点
    pub fn find_nodes_for_asr_lang(&self, lang: &str) -> HashSet<String> {
        self.by_asr_lang
            .get(lang)
            .cloned()
            .unwrap_or_default()
    }

    /// 查找支持特定 TTS 语言的节点
    pub fn find_nodes_for_tts_lang(&self, lang: &str) -> HashSet<String> {
        self.by_tts_lang
            .get(lang)
            .cloned()
            .unwrap_or_default()
    }
}
```

## 6. 实施建议

### 6.1 数据文件位置

**模型语言能力元数据文件**：
- 位置：`electron_node/electron-node/main/src/config/model-language-metadata.json`
- 格式：JSON
- 更新频率：当模型更新或新增时更新

### 6.2 数据维护

1. **初始数据填充**：基于官方文档填充模型语言信息
2. **定期更新**：当模型版本更新时，检查并更新语言支持信息
3. **验证机制**：节点端上报能力时，与元数据对比验证

### 6.3 向后兼容

- 如果节点未上报 `language_capabilities`，调度服务器回退到现有逻辑
- 如果模型元数据缺失，使用默认值或从服务查询

## 7. 总结

本数据结构设计：

1. ✅ **符合决策部门 v1.1 方案**：使用规则避免语言对爆炸
2. ✅ **基于官方信息**：从模型官方文档获取准确的语言支持信息
3. ✅ **支持多源聚合**：服务查询 > 模型元数据 > 模型推断 > 默认值
4. ✅ **易于维护**：集中管理模型语言能力元数据
5. ✅ **向后兼容**：不影响现有节点和调度逻辑

**建议立即开始实施。**
