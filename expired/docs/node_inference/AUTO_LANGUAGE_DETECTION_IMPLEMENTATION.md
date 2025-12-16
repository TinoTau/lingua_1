# 自动语种识别实现设计详情

本文档是 [自动语种识别与双向模式设计](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md) 的子文档，包含详细实现设计、客户端改动和调度服务器改动。

**返回**: [自动语种识别主文档](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md)

---

## 5. 详细实现设计

### 5.1 节点侧 LanguageDetector 实现

#### 5.1.1 模块结构

**文件**：`node-inference/src/language_detector.rs`

```rust
pub struct LanguageDetector {
    // 配置
    auto_langs: Vec<String>,  // 限制的识别范围
    confidence_threshold: f32, // 置信度阈值
}

pub struct LanguageDetectionResult {
    pub detected_lang: String,  // 检测到的语言
    pub confidence: f32,        // 置信度
    pub method: String,         // 检测方法（"whisper" | "text" | "fallback"）
}
```

#### 5.1.2 LanguageDetector 行为

1. **接收输入**：音频数据或 ASR 文本
2. **语言检测**：
   - 优先使用 Whisper 的语言检测能力
   - 如果 Whisper 未提供，使用文本特征推断
   - 如果检测失败，使用回退策略
3. **返回结果**：LanguageDetectionResult

### 5.2 与 ASR 模型的协作

- LanguageDetector 可以共享 Whisper 的上下文
- 避免重复推理，降低延迟
- 提高检测准确率

### 5.3 Two-way Auto 模式的翻译方向判断

**判断逻辑**：
1. 检测输入语言（detected_lang）
2. 如果 detected_lang == lang_a，则 tgt_lang = lang_b
3. 如果 detected_lang == lang_b，则 tgt_lang = lang_a
4. 如果 detected_lang 不在 [lang_a, lang_b] 中，使用默认方向

### 5.4 推理流程修改

**修改位置**：`node-inference/src/inference_service.rs`

**流程**：
1. 接收 InferenceRequest（包含 mode, lang_a, lang_b, auto_langs）
2. 如果 mode == "two_way_auto"：
   - 调用 LanguageDetector 检测语言
   - 根据检测结果确定翻译方向
3. 执行 ASR → NMT → TTS 流程
4. 返回结果（包含 detected_lang）

### 5.5 扩展 InferenceRequest

**新增字段**：
- `mode: Option<String>` - 翻译模式
- `lang_a: Option<String>` - 双向模式的语言 A
- `lang_b: Option<String>` - 双向模式的语言 B
- `auto_langs: Option<Vec<String>>` - 自动识别时限制的语言范围

---

## 6. 客户端改动

### 6.1 Web 客户端改动 ✅

**已完成**：
- ✅ UI 支持：添加单向/双向模式选择
- ✅ 语言配置：支持 lang_a 和 lang_b 配置
- ✅ 连接逻辑：实现 connectTwoWay 方法
- ✅ WebSocket 消息：支持双向模式参数
- ✅ 单元测试：14个测试，全部通过

详细内容请参考：[面对面模式功能文档](../webClient/FACE_TO_FACE_MODE.md)

### 6.2 移动端客户端改动（待实现）

**待实现**：
- [ ] 扩展消息协议
- [ ] 扩展 WebSocketConfig
- [ ] 设置界面（可选）

---

## 7. 调度服务器改动

### 7.1 改动概述

**改动量**：小

- 扩展 SessionInit 消息（添加 mode, lang_a, lang_b, auto_langs）
- 扩展 Session 结构（添加相应字段）
- 调度逻辑几乎无需改动（直接传递参数给节点）

### 7.2 具体改动

#### 7.2.1 扩展 SessionInit 消息

**文件**：`scheduler/src/messages/session.rs`

**新增字段**：
- `mode: Option<String>` - 翻译模式
- `lang_a: Option<String>` - 双向模式的语言 A
- `lang_b: Option<String>` - 双向模式的语言 B
- `auto_langs: Option<Vec<String>>` - 自动识别时限制的语言范围

#### 7.2.2 扩展 Session 结构

**文件**：`scheduler/src/session.rs`

**新增字段**：
- `mode: Option<String>`
- `lang_a: Option<String>`
- `lang_b: Option<String>`
- `auto_langs: Option<Vec<String>>`

#### 7.2.3 调度逻辑（几乎无需改动）

调度服务器只需将 mode、lang_a、lang_b、auto_langs 参数传递给节点，无需特殊处理。

---

**返回**: [自动语种识别主文档](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md) | [设计概述](./AUTO_LANGUAGE_DETECTION_OVERVIEW.md) | [模型选型与实施计划](./AUTO_LANGUAGE_DETECTION_PLANNING.md)

