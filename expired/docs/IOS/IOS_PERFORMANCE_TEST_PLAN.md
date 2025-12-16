# iOS 语音翻译 App 性能测试方案（CPU / 内存 / 带宽 / 延迟）

版本：v1.0

本方案为项目上线前的性能验证标准。

---

# 1. 测试环境

设备：
- iPhone X / 11 / 12 / SE2 / 14 / 15 系列  
系统：iOS 15–17  
网络：  
- WiFi 5G  
- 4G  
- 弱网环境（30% packet loss / 高延迟 300ms）

---

# 2. 测试项目

## 2.1 CPU 使用率
测量点：
- AudioCaptureService
- AudioChunker
- WebSocket encode/decode
- AudioPlayerService

目标：
- CPU 峰值 < 35%  
- 连续 2 分钟录音无 spike（< 50%）

工具：
- Xcode Instruments → Time Profiler

---

## 2.2 内存占用
目标：
- 常驻 < 150 MB  
- TTS 播放期间 spike < 200 MB

检查点：
- Audio buffers 是否释放  
- WebSocket 数据结构是否堆积  

---

## 2.3 带宽

测试场景：
- 正常语速讲话 2 分钟  
- 快速讲话  
- 讲话 + 背景噪音  
- 长静音

目标：
- 上行平均 ≤ 30 KB/s  
- 静音时 ≤ 10 KB/s  

Monitor：
- 使用 DebugOverlay 实时观察

---

## 2.4 延迟（RTT）

测试内容：
- 端到端延迟 = 音频发送 → 翻译 → TTS 返回

目标：
- 本地网络 RTT ≤ 250 ms  
- 弱网 RTT ≤ 500 ms  

---

# 3. 压力测试（Stress Test）

## 3.1 连续 30 分钟实时翻译
- 检查内存、CPU、网络是否持续上升（泄漏风险）  

## 3.2 多会话切换
流程：
```
打开会话 A
10s 后切换到 B
再切回 A
重复 20 次
```
目标：
- WebSocket 不崩溃  
- AudioEngine 不卡死  

---

# 4. 崩溃测试（对关键组件进行异常注入）

## 4.1 强制断网（飞行模式）
预期：
- WS 状态变为 reconnecting  
- 恢复网络自动继续  

## 4.2 服务器返回非法 JSON
预期：
- 不崩溃  
- 写入日志  
- 向用户显示友好错误提示  

---

# 5. 验收标准

- 全流程延迟满足要求  
- 长时间稳定运行  
- 无崩溃/严重 UI 卡顿  
- DebugOverlay 全部指标可用  

