# 文档库

本目录包含项目的长期维护文档。

## 核心文档

### 架构与设计

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构详细说明
- [MODULAR_FEATURES.md](./MODULAR_FEATURES.md) - 模块化功能设计（包含快速参考）

### 协议规范

- [PROTOCOLS.md](./PROTOCOLS.md) - WebSocket 消息协议规范（包含实现状态）

### 扩展设计

- [PUBLIC_API.md](./PUBLIC_API.md) - 对外开放 API 设计与实现（完整文档）

### 使用指南

- [GETTING_STARTED.md](./GETTING_STARTED.md) - 快速开始指南

### 协议规范

- [PROTOCOLS.md](./PROTOCOLS.md) - WebSocket 消息协议规范（包含实现状态）

### 参考文档

- [v0.1版本项目架构与技术报告.md](./v0.1版本项目架构与技术报告.md) - 原项目技术架构参考

## 文档维护原则

1. **长期文档**: 本目录仅存放需要长期维护的文档
2. **临时文档**: 脚本使用说明、迁移指南等临时文档请放在 `scripts/` 目录
3. **及时更新**: 文档应与代码保持同步，及时更新
4. **清晰分类**: 按功能模块组织文档结构

## 文档结构说明

```
docs/
├── README.md                    # 本文件
├── ARCHITECTURE.md              # 系统架构文档
├── GETTING_STARTED.md           # 快速开始指南
├── MODULAR_FEATURES.md          # 模块化功能设计（包含快速参考）
├── PROTOCOLS.md                 # WebSocket 消息协议规范（包含实现状态）
├── PUBLIC_API.md                # 对外开放 API 设计与实现
└── v0.1版本项目架构与技术报告.md  # 参考文档
```

## 添加新文档

添加新文档时，请：

1. 确定文档类型（长期/临时）
2. 长期文档放在 `docs/` 目录
3. 临时文档放在 `scripts/` 或相应目录
4. 更新本 README.md 的文档列表
5. 在 README.md 中添加链接

