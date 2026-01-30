# 调度端：语义修复作为节点核心服务的确认

## 结论

**当前调度架构已保证「语义修复服务作为节点端核心服务」**，无需在节点端或调度端增加额外逻辑、流程或硬编码。

## 依据

1. **节点注册（入池前置条件）**
   - **Rust**（`central_server/scheduler/src/websocket/node_handler/message/register.rs`）：
     - `extract_langs` 要求 `semantic_languages` 必填且非空。
     - 若为空则返回错误：`"semantic_languages cannot be empty. Semantic service is mandatory for all nodes."`
   - **Lua**（`central_server/scheduler/scripts/lua/register_node_v2.lua`）：
     - 若 `semantic_langs_json` 为空或缺失，返回：`ERROR:semantic_langs_json_required_Semantic_service_is_mandatory`
   - 因此：**不提供语义能力（semantic_languages 非空）的节点无法完成注册**，也就无法进入后续池分配与调度。

2. **池分配与调度**
   - 池的维度是**有向语言对**，由 `(asr_langs × tts_langs)` 生成（与任务查找 src:tgt 一致）；Semantic 在文档中明确为「能力校验用」。
   - 心跳与选节点只针对**已注册**的节点；注册已强制要求 semantic 非空。
   - 因此：**能进入任意池、被调度到的节点，都已在注册时声明了语义能力**，即调度端已把「具备语义修复能力」视为入池前提。

3. **与节点端的关系**
   - 节点端不因本澄清增加任何新逻辑、流程或硬编码。
   - 节点端设计仍是：所有需发送的 ASR 必须经语义修复（见 `SEMANTIC_REPAIR_REQUIRED_2026_01_29.md`）；调度端通过注册契约保证「入池节点都具备语义能力」，与节点端设计一致。

## 相关文件（调度端）

- `central_server/scheduler/src/websocket/node_handler/message/register.rs`：注册时校验 semantic_languages 必填且非空。
- `central_server/scheduler/scripts/lua/register_node_v2.lua`：Redis 侧注册同样强制 semantic_langs_json。
- `central_server/scheduler/docs/node_registry/node_registration.md`：文档写明 semantic_languages 必填、Semantic 服务必需。
