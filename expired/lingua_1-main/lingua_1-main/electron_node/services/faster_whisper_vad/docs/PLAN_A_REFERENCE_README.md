# 方案A 参考代码说明（下载包内）

本目录包含两类交付：
1) `PLAN_A_TASK_LIST_JIRA.md`：可直接拆分到 JIRA 的任务清单  
2) `node_opus_decode_reference.py`：节点端“按 packet 解码 Opus → PCM16”的参考结构代码

## 运行环境（仅供参考）
- Python 3.10+
- `pip install websockets pyogg`

> 说明：pyogg 的 API 在不同版本可能略有差异，你们应以实际 lockfile/版本为准做微调。
> 如果你们不使用 pyogg，也可将 `OpusPacketDecoder` 替换为其它 Opus 解码绑定，但协议与 framing 设计保持不变。

## 协议要点（务必实现）
- Web → Node 音频必须是 **binary frame**
- 数据必须是：`uint16_le packet_len + packet_bytes (+ optional uint32_le seq)`
- packet_bytes 必须是 **单个完整 Opus packet**（不能是“连续 raw bytes stream”）

## 建议接入方式
- 将 `PacketFramer` 与 `OpusPacketDecoder` 的逻辑嵌入你们现有 Node 端会话/任务框架
- 将解码输出 PCM16 写入你们现有 ASR 输入缓冲（建议 ring/jitter buffer）
- 增加结构化日志与降级闭环（见 Task List 的 EPIC-A3）

