# API Gateway 文档

本目录包含对外 API 网关（API Gateway）相关的设计文档和实现说明。

## 文档列表

- [对外开放 API 设计与实现](./PUBLIC_API.md) - 完整的 API 设计文档，包含 REST API 和 WebSocket API

## 相关文档

- [系统架构文档](../ARCHITECTURE.md) - API Gateway 架构说明
- [协议规范文档](../PROTOCOLS.md) - WebSocket 消息协议规范
- [项目状态](../project_management/PROJECT_STATUS.md) - API Gateway 实现状态

## 功能说明

API Gateway 提供以下功能：
- 租户管理
- API Key 鉴权
- 限流机制
- REST API 端点
- WebSocket API 端点
- Scheduler 客户端

## 实现状态

- ✅ 项目框架已创建
- ✅ 核心模块已实现
- ⏸️ 错误处理和日志完善（待完成）
- ⏸️ 单元测试和集成测试（待完成）
- ⏸️ 数据库集成（待完成）

