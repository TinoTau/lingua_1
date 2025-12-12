# 自动大语种（中英日韩）识别与双向会话扩展设计

版本：v2.1  
适用范围：调度服务器、第三方节点（PC）、移动端客户端  
最后更新：2025-12-12

**实施状态**：框架已完成 ✅，待完善实际检测逻辑和测试

---

## 目录

1. [功能概述](#1-功能概述需求说明)
2. [需求分析](#2-需求分析)
3. [架构改动总览](#3-架构改动总览)
4. [可行性评估](#4-可行性评估)
5. [详细实现设计](#5-详细实现设计)
6. [客户端改动](#6-客户端改动)
7. [调度服务器改动](#7-调度服务器改动)
8. [模型选型建议](#8-模型选型建议)
9. [整体流程图](#9-整体流程图)
10. [实施计划](#10-实施计划)
11. [风险评估](#11-风险评估)
12. [未来可扩展功能](#12-未来可扩展功能)

---

## 1. 功能概述（需求说明）

本设计文档补充当前系统的核心能力：  
**自动识别输入语音属于中文 / 英文 / 日文 / 韩文（大语种识别），并根据识别结果自动选择翻译方向。**

同时满足以下特殊使用场景：

- **老年人只会说方言** → 输入只需归类到"中文"，不需要识别具体方言。  
- **双向实时会话** → 对话双方可随时切换说中文或英文，系统自动判断并翻译成对方语言。  
- **方言只影响输入，不影响输出** → 输出始终使用目标语的官方语言 TTS（普通话、标准英文、标准日文、标准韩文）。

---

## 2. 需求分析

### 2.1 大语种自动识别（Language ID, LID）

系统必须能自动判断输入语音是否属于以下语种：

- zh（中文及其方言）
- en（英语）
- ja（日语）
- ko（韩语）

能力要求：

| 能力 | 要求 |
|------|------|
| 自动识别 | ≥80% accuracy（短语音 0.5–2 秒） |
| 低延迟 | ≤ 100ms |
| 不识别小语种 | 未包含的语言视为最接近的大语种或按默认处理 |
| 与 Whisper 等 ASR 模型兼容 | 可利用现成模型的语言检测能力 |

---

### 2.2 方言处理需求

**方言只在输入识别阶段考虑，不需要自动细分方言。**

即：

- 广西话 / 湖南话 / 四川话 / 台湾腔 → 统一归类为 zh  
- 节点 ASR 模型负责"尽可能识别这些方言"  
- 翻译输出使用普通话或目标语言，不需要方言 TTS

---

### 2.3 双向会话需求（Two-way Auto Mode）

场景示例：

- 中英对话  
- 日英双语会议  
- 客服场景：用户用中文讲话，客服用英文回应（自动翻译）

机制：

1. 用户 A 讲话 → 识别为 zh → 翻译 → en → 播放给用户 B  
2. 用户 B 讲话 → 识别为 en → 翻译 → zh → 播放给用户 A

系统自动根据输入语言选择"翻译方向"，无需用户切换。

---

## 3. 架构改动总览

### 3.1 改动程度评估

| 模块 | 改动程度 | 影响说明 |
|------|---------|---------|
| **调度服务器** | ⭐ 极小 | 仅需支持新的配置字段，路由逻辑不变 |
| **节点推理服务** | ⭐⭐⭐ 中等 | 新增 LanguageDetector 模块，修改推理流程 |
| **客户端（移动端）** | ⭐⭐ 小 | 新增设置选项，支持新配置字段 |
| **消息协议** | ⭐⭐ 小 | 扩展 SessionInit 和 Utterance 消息 |
| **Electron Node** | ⭐⭐ 小 | 支持新的配置字段和消息类型 |

**总体评估**：✅ **中等改动（主要是扩展性改动，不破坏现有架构）**

### 3.2 新增模块：LanguageDetector（节点侧）

插入位置：

```
AudioChunk  
   ↓
LanguageDetector（新增）
   ↓
Silero VAD（现有）
   ↓
ASR（选择对应语种模型）
   ↓
NMT
   ↓
TTS
```

节点在收到前 1–2 秒音频时即可运行 LID。

---

### 3.3 SessionConfig 改动

新增配置结构：

```jsonc
{
  "mode": "one_way" | "two_way_auto",
  "srcLang": "auto" | "zh" | "en" | "ja" | "ko",
  "tgtLang": "zh" | "en" | "ja" | "ko",
  "langA": "zh",
  "langB": "en",
  "autoLangs": ["zh", "en", "ja", "ko"]
}
```

解释：

- `"srcLang": "auto"` → 节点将自动识别输入语种  
- `"mode": "two_way_auto"` → 系统根据识别结果切换翻译方向  
- `"autoLangs"` → 限制识别范围，防止被小语种干扰

---

### 3.4 WebSocket 协议改动（可选）

新增一个消息类型供客户端参考：

```json
{
  "type": "language_detected",
  "session_id": "sess-123",
  "lang": "ja",
  "confidence": 0.92
}
```

该消息不影响翻译流程，仅用于 UI 显示或调试。

---

## 4. 可行性评估

### 4.1 技术可行性

#### ✅ 语言检测（LID）实现方案

**方案1：使用 Whisper 的语言检测（推荐）** ⭐⭐⭐⭐⭐

- **优点**：
  - Whisper 模型自带语言检测能力
  - 准确率高（≥80%）
  - 延迟低（≤100ms）
  - 无需额外模型
- **实现**：
  - 在 `LanguageDetector` 中调用 Whisper 的语言检测 API
  - 或使用 Whisper 的 `detect_language` 方法

**方案2：使用独立的 LID 模型** ⭐⭐⭐

- **优点**：
  - 专门优化的语言检测模型
  - 可能更轻量
- **缺点**：
  - 需要额外的模型文件
  - 需要额外的推理时间

**推荐**：使用 Whisper 的语言检测能力（方案1）

#### ✅ 双向模式实现

**逻辑清晰，易于实现**：

```rust
if mode == "two_way_auto" {
    if detected_lang == lang_a {
        src = lang_a;
        tgt = lang_b;
    } else if detected_lang == lang_b {
        src = lang_b;
        tgt = lang_a;
    }
}
```

**评估**：✅ **实现简单，逻辑清晰**

#### ✅ 方言处理

**现有架构已支持**：

- 方言在 ASR 阶段处理（Whisper 对中文方言有一定鲁棒性）
- TTS 始终使用标准语言（普通话、标准英文等）
- 不需要额外改动

**评估**：✅ **无需改动，现有架构已支持**

### 4.2 兼容性分析

#### ✅ 向后兼容性

**完全向后兼容**：

1. **现有会话**：如果 `src_lang` 不是 `"auto"`，系统行为不变
2. **现有节点**：不支持语言检测的节点可以继续工作（如果 `src_lang != "auto"`）
3. **现有客户端**：不传递新字段时，系统使用默认行为

#### ⚠️ 需要处理的情况

1. **节点不支持语言检测**：
   - 如果节点不支持 `src_lang="auto"`，调度服务器应该：
     - 返回错误，或
     - 路由到支持语言检测的节点

2. **语言检测失败**：
   - 使用默认语言（如 `zh`）
   - 或返回错误给客户端

### 4.3 总体评估

| 维度 | 评估 |
|------|------|
| **架构改动** | ⭐⭐ 中等（主要是扩展，不破坏现有架构） |
| **技术难度** | ⭐⭐ 中等（语言检测有成熟方案） |
| **开发工作量** | ⭐⭐⭐ 中等（3-4周） |
| **兼容性** | ✅ 完全向后兼容 |
| **风险** | ⚠️ 低风险，可控 |

**结论**：✅ **该功能完全可行，对现有架构的改动中等，主要是扩展性改动。**

---

## 5. 详细实现设计

### 5.1 节点侧 LanguageDetector 实现

#### 5.1.1 模块结构

```rust
// node-inference/src/language_detector.rs
pub struct LanguageDetector {
    // 可以使用 Whisper 的语言检测能力
    // 或独立的 LID 模型（如 fairseq LID）
    whisper_ctx: Arc<WhisperContext>,  // 复用 Whisper 上下文
}

impl LanguageDetector {
    pub fn new(whisper_ctx: Arc<WhisperContext>) -> Result<Self> {
        Ok(Self {
            whisper_ctx,
        })
    }
    
    pub async fn detect(&self, audio_data: &[f32], sample_rate: u32) -> Result<LanguageDetectionResult> {
        // 使用 Whisper 的语言检测能力
        // 返回: { lang: "zh", confidence: 0.91, scores: {...} }
    }
}

pub struct LanguageDetectionResult {
    pub lang: String,  // "zh" | "en" | "ja" | "ko"
    pub confidence: f32,
    pub scores: HashMap<String, f32>,
}
```

#### 5.1.2 LanguageDetector 行为

输入：前 0.5–2 秒的 PCM16 音频  
输出：

```json
{
  "lang": "zh",
  "confidence": 0.91,
  "scores": {
    "zh": 0.91,
    "en": 0.07,
    "ja": 0.01,
    "ko": 0.01
  }
}
```

策略：

- 若最高置信度 ≥ 阈值（0.75–0.85）→ 采用该语言  
- 否则 → 使用默认语言（例如 zh）或提示客户端（可选）

---

### 5.2 与 ASR 模型的协作

LID 决定：

- 使用哪个语种的 ASR 模型  
- Whisper 系列可直接使用其 internal `language` 输出  
- 对 zh 内部不区分方言（靠模型鲁棒性处理）

---

### 5.3 Two-way Auto 模式的翻译方向判断

伪逻辑：

```rust
if mode == "two_way_auto" {
    if detected_lang == lang_a {
        src = lang_a;
        tgt = lang_b;
    } else if detected_lang == lang_b {
        src = lang_b;
        tgt = lang_a;
    } else {
        // 非主要语言，例如 ja/ko
        src = detected_lang;
        tgt = default_target;  // 可以是 lang_a 或指定语言
    }
}
```

保证：

- 用户随时说中文/英文 → 系统自动切换方向  
- 双向模式无需服务器维护额外状态

---

### 5.4 推理流程修改

```rust
// node-inference/src/inference.rs
impl InferenceService {
    pub async fn process(&self, request: InferenceRequest) -> Result<InferenceResult> {
        let mut src_lang = request.src_lang.clone();
        let mut tgt_lang = request.tgt_lang.clone();
        
        // 1. 语言检测（如果 src_lang == "auto"）
        if src_lang == "auto" {
            if let Some(ref detector) = self.language_detector {
                let detection = detector.detect(&audio_f32, 16000).await?;
                src_lang = detection.lang.clone();
                
                // 双向模式：根据检测结果选择翻译方向
                if let Some(ref mode) = request.mode {
                    if mode == "two_way_auto" {
                        if let (Some(ref lang_a), Some(ref lang_b)) = (&request.lang_a, &request.lang_b) {
                            if src_lang == *lang_a {
                                tgt_lang = lang_b.clone();
                            } else if src_lang == *lang_b {
                                tgt_lang = lang_a.clone();
                            }
                        }
                    }
                }
            }
        }
        
        // 2. ASR（使用检测到的语言）
        let transcript = self.asr_engine.transcribe_f32(&audio_f32, &src_lang).await?;
        
        // 3. NMT（使用动态确定的翻译方向）
        let translation = self.nmt_engine.translate(&transcript, &src_lang, &tgt_lang).await?;
        
        // 4. TTS（使用目标语言）
        let audio = self.tts_engine.synthesize(&translation, &tgt_lang).await?;
        
        // ... 其他处理 ...
    }
}
```

---

### 5.5 扩展 InferenceRequest

```rust
// node-inference/src/inference.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    // ... 现有字段 ...
    pub src_lang: String,  // 支持 "auto"
    pub tgt_lang: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,  // 新增: "one_way" | "two_way_auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,  // 新增
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,  // 新增
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,  // 新增
}
```

---

## 6. 客户端改动

### 6.1 iOS 客户端改动（极小）

#### 6.1.1 设置页面需新增模式选项

- "固定方向模式（one_way）"
- "双向自动翻译模式（two_way_auto）"
- "自动识别语种（srcLang=auto）"

#### 6.1.2 显示语言检测提示（可选）

```
当前检测语言：日语（92%）
```

非必须，主要用于验证功能。

---

### 6.2 React Native 客户端改动

#### 6.2.1 扩展消息协议

```typescript
// shared/protocols/messages.ts
export interface SessionInitMessage {
    // ... 现有字段 ...
    src_lang: string;  // 支持 "auto"
    tgt_lang: string;
    mode?: "one_way" | "two_way_auto";  // 新增
    lang_a?: string;  // 新增
    lang_b?: string;  // 新增
    auto_langs?: string[];  // 新增
    // ... 其他字段 ...
}
```

#### 6.2.2 扩展 WebSocketConfig

```typescript
// mobile-app/src/hooks/useWebSocket.ts
export interface WebSocketConfig {
    // ... 现有字段 ...
    srcLang?: string;  // 支持 "auto"
    tgtLang?: string;
    mode?: "one_way" | "two_way_auto";  // 新增
    langA?: string;  // 新增
    langB?: string;  // 新增
    autoLangs?: string[];  // 新增
}
```

#### 6.2.3 设置界面（可选）

```typescript
// mobile-app/App.tsx
const [mode, setMode] = useState<"one_way" | "two_way_auto">("one_way");
const [srcLang, setSrcLang] = useState<string>("auto");  // 支持 "auto"
const [langA, setLangA] = useState<string>("zh");
const [langB, setLangB] = useState<string>("en");

// 在 connect 时传递新配置
await connect(pairingCode, {
    srcLang: srcLang,
    tgtLang: langB,
    mode: mode,
    langA: langA,
    langB: langB,
    autoLangs: ["zh", "en", "ja", "ko"],
});
```

---

## 7. 调度服务器改动

### 7.1 改动概述

调度服务器只是"路由音频"。  
自动识别逻辑完全在节点中进行。

仅需确认：

- 多语言模型的节点资源标签，例如：  
  - node1 支持 zh/en  
  - node2 支持 zh/en/ja/ko  
- 调度时尽量把自动识别会话放入"多语种节点"

---

### 7.2 具体改动

#### 7.2.1 扩展 SessionInit 消息

```rust
// scheduler/src/messages.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionMessage {
    #[serde(rename = "session_init")]
    SessionInit {
        // ... 现有字段 ...
        src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,  // 新增: "one_way" | "two_way_auto"
        #[serde(skip_serializing_if = "Option::is_none")]
        lang_a: Option<String>,  // 新增: 双向模式的语言 A
        #[serde(skip_serializing_if = "Option::is_none")]
        lang_b: Option<String>,  // 新增: 双向模式的语言 B
        #[serde(skip_serializing_if = "Option::is_none")]
        auto_langs: Option<Vec<String>>,  // 新增: 限制识别范围
        // ... 其他字段 ...
    },
    // ... 其他消息类型 ...
    
    // 可选: 新增语言检测结果消息（用于 UI 显示）
    #[serde(rename = "language_detected")]
    LanguageDetected {
        session_id: String,
        lang: String,
        confidence: f32,
    },
}
```

#### 7.2.2 扩展 Session 结构

```rust
// scheduler/src/session.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    // ... 现有字段 ...
    pub src_lang: String,  // 支持 "auto"
    pub tgt_lang: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,  // 新增
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,  // 新增
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,  // 新增
    // ... 其他字段 ...
}
```

#### 7.2.3 调度逻辑（几乎无需改动）

调度服务器只需要：
- 将新的配置字段透传给节点（通过 `JobAssign` 消息）
- 不需要理解 `src_lang="auto"` 的含义，节点会处理

**改动评估**：✅ **极小改动，向后兼容**

---

## 8. 模型选型建议

### 8.1 大语种检测（zh/en/ja/ko）

推荐方案（优先级递减）：

1. **Whisper 自带语言检测**（简便、准确）  
2. Facebook fairseq LID 128-model  
3. 自训练 4 类 LID 模型（数据需求较小）

### 8.2 ASR 模型

- Whisper 系列对中英日韩都有一定支持  
- 若未来支持某方言，可配置专用方言模型（如粤语 ASR）

### 8.3 TTS 模型

不需要方言 TTS，仅保留标准语言：

- zh → 普通话  
- en → 标准北美音  
- ja → 標準語  
- ko → 표준어

---

## 9. 整体流程图

### 9.1 自动大语种识别流程

```
iOS → AudioChunk → Dispatcher → Node

Node:
  1. LanguageDetector
  2. Silero VAD
  3. ASR (selected by language)
  4. NMT
  5. TTS
  6. WebSocket PCM16 返回 iOS
```

翻译方向自动决定：

```
detectedLang == zh → zh → en
detectedLang == en → en → zh
...
```

---

## 10. 实施计划

### 阶段1：基础语言检测框架（已完成 ✅）

1. ✅ 创建 `LanguageDetector` 模块框架（`node-inference/src/language_detector.rs`）
2. ✅ 扩展消息协议（`SessionInit`、`InferenceRequest`、`JobAssign` 等）
3. ✅ 修改推理流程（支持 `src_lang="auto"`）
4. ✅ 扩展调度服务器和客户端消息类型
5. ⏸️ 实现实际的语言检测逻辑（待完善）

### 阶段2：双向模式框架（已完成 ✅）

1. ✅ 实现双向模式逻辑框架
2. ✅ 扩展配置字段（`mode`、`lang_a`、`lang_b`、`auto_langs`）
3. ✅ 更新所有相关调用点
4. ⏸️ 客户端 UI 支持新配置（待完善）
5. ⏸️ 集成测试（待完善）

### 阶段3：完善与优化（进行中）

1. ⏸️ 实现实际的语言检测逻辑（使用 Whisper 语言检测）
2. ⏸️ ASR 引擎共享 Whisper 上下文给 LanguageDetector
3. ⏸️ 性能优化（语言检测缓存）
4. ⏸️ 错误处理完善
5. ⏸️ UI 优化（语言检测结果显示）
6. ⏸️ 单元测试和集成测试
7. ✅ 文档更新

**当前状态**：框架已完成，待完善实际检测逻辑和测试

**总工作量**：3-4 周（框架 1 周已完成，剩余 2-3 周）

---

## 11. 风险评估

### 11.1 潜在风险

#### ⚠️ 语言检测准确率

- **风险**：短语音（<0.5秒）检测准确率可能较低
- **缓解**：使用置信度阈值，低置信度时使用默认语言

#### ⚠️ 性能影响

- **风险**：语言检测增加延迟
- **缓解**：使用 Whisper 的语言检测（已集成，延迟低）

#### ⚠️ 节点兼容性

- **风险**：旧节点不支持新功能
- **缓解**：向后兼容，旧节点继续支持固定语言模式

### 11.2 风险可控

所有风险都有明确的缓解措施，整体风险可控。

---

## 12. 未来可扩展功能

- 自动识别说话者身份（谁在说话，用于多人会议）
- 自动识别"情绪 + 语速 + 音色"  
- 支持多语种混合句子（如中英夹杂）
- 方言 ASR 模块（待训练）

---

## 13. 总结（给开发部门）

本功能是对现有架构的 **平滑扩展**，不会影响原有的调度服务器或手机端框架。

### 关键工作点

1. 在节点侧加入 **LanguageDetector 模块**  
2. 更新节点管线模块选择逻辑（按语种路由 ASR/NMT/TTS）  
3. 支持 `two_way_auto` 自动双向模式  
4. 更新会话配置结构（srcLang="auto" 等）  
5. iOS/React Native 增加设置入口与可选 UI 提示  

### 完成以上，即可支持

- 自动识别中/英/日/韩  
- 方言作为输入鲁棒性处理  
- 自动决定翻译方向  
- 保持现有节点 TTS 输出路径  

这是构建未来"大语种 + 方言 + 翻译调度生态"的基础能力模块。

---

## 相关文档

- [系统架构文档](./ARCHITECTURE.md) - 现有架构说明
- [消息协议规范](./PROTOCOLS.md) - WebSocket 消息协议
- [开发计划](./DEVELOPMENT_PLAN.md) - 整体开发计划
