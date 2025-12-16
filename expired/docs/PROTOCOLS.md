# WebSocket 消息协议规范

版本：v0.1  
适用对象：调度服务器、移动端会话设备、Electron Node 客户端开发人员。

本文档定义了：

- **移动端（手机 App） ↔ 调度服务器** 的 WebSocket 消息格式；
- **第三方节点（Electron Node 客户端） ↔ 调度服务器** 的 WebSocket 消息格式。

> 说明：以下示例及接口命名与当前 `ARCHITECTURE.md`、`modular/MODULAR_FEATURES.md` 中的设计保持一致，实际开发中可根据代码实现做微调与补充。

---

## 📋 文档导航

本文档已拆分为多个子文档以便阅读：

- **[会话端协议](./PROTOCOLS_SESSION.md)** - 移动端 ↔ 调度服务器协议详细说明
- **[节点端协议](./PROTOCOLS_NODE.md)** - 第三方节点 ↔ 调度服务器协议详细说明
- **[实现状态](./PROTOCOLS_IMPLEMENTATION.md)** - 协议规范的实现状态和待完成工作

---

## 1. 通用约定

### 1.1 传输格式

- 所有消息以 **JSON 文本** 通过 WebSocket 发送。
- 每条消息必须包含一个顶层字段：

```jsonc
{
  "type": "string",  // 消息类型，用于区分不同语义
  "...": "其他字段"
}
```

### 1.2 ID 与语言码

- `session_id`：字符串，由服务器生成并在会话建立时返回。
- `node_id`：字符串，由节点在首次注册时生成（或服务器分配）。
- `job_id`：字符串，由调度服务器生成，用于标识句级任务。
- 语言码：
  - `src_lang` / `tgt_lang` 使用简化语言标识（如 `"zh"`, `"en"`），后续可扩展为 BCP-47。

### 1.3 错误处理

- 协议层错误使用 `type = "error"` 消息返回。
- 对于无法解析的消息，推荐做法：
  - 日志记录；
  - 返回 `error` 消息（如果能识别基础结构）；
  - 必要时关闭连接。

### 1.4 错误码建议（草案）

统一错误码枚举（可在实现中放入 shared 库）：

- 通用：
  - `INVALID_MESSAGE`
  - `INTERNAL_ERROR`
- 会话相关：
  - `INVALID_SESSION`
  - `SESSION_CLOSED`
- 节点相关：
  - `NODE_UNAVAILABLE`
  - `NODE_OVERLOADED`
- 模型相关：
  - `MODEL_NOT_AVAILABLE`
  - `MODEL_LOAD_FAILED`
- 功能/模块相关：
  - `UNSUPPORTED_FEATURE`

---

## 2. 后续工作

- 本协议为 **草稿版本 v0.1**，建议在以下阶段同步更新：
  1. Scheduler / Node / Mobile 实现过程中，若字段名或结构调整，请更新本文件；
  2. 若新增消息类型（例如：实时部分结果 `partial_result`、会话中断通知等），也应在此处补充；
  3. 实现完首个端到端 Demo 后，可将本协议标记为 v1.0，并冻结核心字段。

开发团队在实现时，可将上述 JSON 示例对应为 TypeScript / Rust struct / Go struct 等，以保证前后端统一。

---

## 📚 相关文档

- [架构文档](./ARCHITECTURE.md)
- [模块化功能设计文档](./modular/MODULAR_FEATURES.md)
- [实现状态文档](./PROTOCOLS_IMPLEMENTATION.md)
