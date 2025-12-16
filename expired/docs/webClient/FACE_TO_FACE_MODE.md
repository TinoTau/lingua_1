# 面对面模式（双向模式）功能文档

**日期**: 2025-01-XX  
**状态**: ✅ **已完成**

---

## 📋 功能概述

面对面模式（Face-to-Face Mode）是一种特殊的会话模式，适用于**同一物理空间、共用一台设备、两人对话**的场景。系统会自动检测说话语言，并翻译成另一种语言，实现同声传译的效果。

### 使用场景

- **面对面对话**：两个人在同一房间，共用一台设备进行对话
- **同声传译**：系统自动检测语言并翻译，无需手动切换
- **双语会议**：支持中英、日英等多种语言对

---

## 🎯 核心特性

### 1. 自动语言检测

- ✅ 系统自动检测输入语音的语言（支持中文、英文、日文、韩文）
- ✅ 根据检测结果自动选择翻译方向
- ✅ 无需手动切换语言方向

### 2. 双向翻译

- ✅ 用户 A 说中文 → 自动翻译成英文
- ✅ 用户 B 说英文 → 自动翻译成中文
- ✅ 两人可以自由切换语言，系统自动处理

### 3. 语言配置

- ✅ 指定两种语言（语言 A 和语言 B）
- ✅ 系统限制识别范围，提高准确性
- ✅ 支持中英、日英、韩英等常见语言对

---

## 🖥️ UI 界面

### 模式选择

在单会话模式界面中，用户可以选择：

1. **单向模式**：
   - 指定源语言和目标语言
   - 固定翻译方向

2. **双向模式（面对面模式）**：
   - 指定语言 A 和语言 B
   - 系统自动检测并翻译

### 配置界面

**单向模式配置**：
- 源语言选择（中文/英文）
- 目标语言选择（中文/英文）

**双向模式配置**：
- 语言 A 选择（中文/英文）
- 语言 B 选择（中文/英文）
- 提示信息：系统会自动检测说话语言并翻译

---

## 🔧 技术实现

### 前端实现

#### 1. UI 组件

```typescript
// 模式选择
<input type="radio" name="translation-mode" value="one_way"> 单向模式
<input type="radio" name="translation-mode" value="two_way_auto"> 双向模式

// 单向模式配置
<select id="src-lang">源语言</select>
<select id="tgt-lang">目标语言</select>

// 双向模式配置
<select id="lang-a">语言 A</select>
<select id="lang-b">语言 B</select>
```

#### 2. 连接方法

```typescript
// App 类
async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void>

// WebSocketClient 类
async connectTwoWay(langA: string, langB: string, features?: FeatureFlags): Promise<void>
```

#### 3. WebSocket 消息

```json
{
  "type": "session_init",
  "client_version": "web-client-v1.0",
  "platform": "web",
  "src_lang": "auto",
  "tgt_lang": "en",
  "mode": "two_way_auto",
  "lang_a": "zh",
  "lang_b": "en",
  "auto_langs": ["zh", "en"],
  "features": {}
}
```

### 后端支持

#### 1. Scheduler

- ✅ `Session` 结构支持 `mode: "two_way_auto"`
- ✅ 支持 `lang_a` 和 `lang_b` 参数
- ✅ 支持 `auto_langs` 限制识别范围

#### 2. Node（推理节点）

- ✅ `LanguageDetector` 模块自动检测语言
- ✅ 根据检测结果自动选择翻译方向
- ✅ 支持多语言模型切换

---

## 📊 工作流程

### 双向模式流程

```
用户 A 说话（中文）
    ↓
系统检测语言 → zh
    ↓
自动选择翻译方向：zh → en
    ↓
翻译并播放英文
    ↓
用户 B 说话（英文）
    ↓
系统检测语言 → en
    ↓
自动选择翻译方向：en → zh
    ↓
翻译并播放中文
```

### 与单向模式的区别

| 特性 | 单向模式 | 双向模式（面对面） |
|------|---------|------------------|
| 语言检测 | ❌ 固定源语言 | ✅ 自动检测 |
| 翻译方向 | 固定（A→B） | 自动切换（A↔B） |
| 使用场景 | 远程对话 | 面对面对话 |
| 设备数量 | 多台设备 | 一台设备 |
| 人数限制 | 2人 | 2人 |

---

## ✅ 实现状态

### 已完成

- ✅ UI 模式选择（单向/双向）
- ✅ 语言配置界面（lang_a, lang_b）
- ✅ `connectTwoWay` 方法实现
- ✅ WebSocket 消息支持双向模式参数
- ✅ 后端支持（Scheduler 和 Node）
- ✅ **单元测试**: 14个测试，全部通过 ✅
  - ✅ 连接逻辑测试（3个测试）
  - ✅ 语言配置测试（4个测试）
  - ✅ 功能标志传递测试（2个测试）
  - ✅ 消息格式验证测试（2个测试）
  - ✅ 模式对比测试（1个测试）
  - ✅ 边界情况测试（2个测试）

### 待完善

- ⏸️ 语言检测结果的可视化显示（可选）
- ⏸️ 检测置信度显示（可选）

---

## 🔗 相关文档

- [自动语言检测与双向模式设计](../node_inference/AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md)
- [会话模式功能文档](./README.md#会话模式功能文档)
- [按钮控制机制分析报告](../webRTC/BUTTON_CONTROL_MECHANISM_ANALYSIS.md)

---

**完成时间**: 2025-01-XX

