# API Gateway 文档

本目录包含对外 API 网关（API Gateway）相关的设计文档和实现说明。

## 文档列表

- [对外开放 API 设计与实现](./PUBLIC_API.md) - 完整的 API 设计文档，包含 REST API 和 WebSocket API

## 相关文档

- `OVERVIEW.md` - 运行方式、配置项与开发/测试说明
- `../OVERVIEW.md` - central_server 总览与启动入口
- `../README.md` - 文档索引

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
- ✅ `/health` 健康检查（无需鉴权）
- ⏸️ 单元测试和集成测试（待完成）
- ⏸️ 数据库集成（待完成）

