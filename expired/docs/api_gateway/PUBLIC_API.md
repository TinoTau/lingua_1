# 对外开放 API 设计与实现

版本：v1.0  
适用对象：后端开发、架构师、移动端/SDK 开发团队

本文档描述了如何将 Lingua 实时语音翻译平台对外开放，包括设计思路、架构方案、实现细节和开发指南。

---

## 📋 文档导航

本文档已拆分为多个子文档以便阅读：

- **[API 设计与架构](./PUBLIC_API_DESIGN.md)** - 背景、目标、架构设计和实现方案
- **[API 规范与使用](./PUBLIC_API_SPEC.md)** - 外部 API 规范、使用示例和快速开始
- **[实现状态与部署](./PUBLIC_API_STATUS.md)** - 实现状态、安全考虑和部署建议

---

## 快速开始

### 背景与目标

**扩展为一个可对外开放的语音翻译服务平台，使外部 APP / 网站 / 即时通信工具也可调用本系统。**

此扩展不改变核心推理与调度逻辑，只添加面向第三方使用的外壳、鉴权与多租户能力。

### 核心能力

- ✅ Public API Gateway（对外 API 网关）
- ✅ 多租户系统 (Multi-Tenant)
- ✅ REST API + WebSocket API
- ✅ API Key 鉴权
- ✅ 限流机制

### 实施状态

✅ **核心功能已完成**：
- ✅ API Gateway 项目框架
- ✅ 核心模块实现（租户管理、鉴权、限流等）
- ✅ Scheduler 扩展（tenant_id 支持）

详细内容请参考子文档。

---

## 📚 相关文档

- [API 设计与架构](./PUBLIC_API_DESIGN.md)
- [API 规范与使用](./PUBLIC_API_SPEC.md)
- [实现状态与部署](./PUBLIC_API_STATUS.md)
- [系统架构文档](../ARCHITECTURE.md)
- [协议规范](../PROTOCOLS.md)
