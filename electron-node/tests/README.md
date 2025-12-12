# Electron Node 客户端测试

## 测试结构

测试文件按阶段组织在独立路径中：

```
electron-node/tests/
├── README.md              # 本文件
└── stage2.2/              # 阶段 2.2：Electron Node 客户端测试
    ├── README.md          # 阶段 2.2 测试说明
    └── TEST_REPORT.md     # 测试结果报告
```

## 测试阶段

### 阶段 2.2：Electron Node 客户端功能测试

- [ ] HTTP 推理服务集成测试
- [ ] 系统资源监控测试
- [ ] 功能模块管理测试
- [ ] 模型管理测试
- [ ] 节点注册和心跳测试
- [ ] 流式 ASR 支持测试

详细说明请参考 [阶段 2.2 测试文档](./stage2.2/README.md)

## 注意事项

- Electron 客户端测试需要 Electron 环境
- 部分测试需要推理服务运行
- 系统资源监控测试需要系统权限

