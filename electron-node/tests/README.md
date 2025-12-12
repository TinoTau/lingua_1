# Electron Node 客户端测试

## 测试结构

测试文件按阶段组织在独立路径中：

```
electron-node/tests/
├── README.md              # 本文件
├── stage2.2/              # 阶段 2.2：Electron Node 客户端测试
│   ├── README.md          # 阶段 2.2 测试说明
│   └── TEST_REPORT.md     # 测试结果报告
└── stage3.1/              # 阶段 3.1：模型管理功能测试
    ├── README.md          # 阶段 3.1 测试说明
    ├── TEST_REPORT.md     # 测试结果报告
    ├── model-manager.test.ts      # ModelManager 单元测试
    └── model-hub-api.test.ts      # 模型库服务 API 测试
```

## 测试阶段

### 阶段 2.2：Electron Node 客户端功能测试

- [x] HTTP 推理服务集成 ✅
- [x] 系统资源监控 ✅
- [x] 功能模块管理 UI ✅
- [x] 流式 ASR 支持 ✅
- [x] 消息格式对齐 ✅
- [x] 编译测试 ✅（全部通过）

详细说明请参考 [阶段 2.2 测试文档](./stage2.2/README.md)

### 阶段 3.1：模型管理功能测试

- [ ] 服务器端模型库 API 测试
- [ ] ModelManager 核心功能测试
- [ ] 模型下载和安装测试
- [ ] 断点续传测试
- [ ] 多文件并发下载测试
- [ ] 锁机制测试
- [ ] registry.json 原子写入测试
- [ ] 错误处理测试
- [ ] IPC 进度事件推送测试

详细说明请参考 [阶段 3.1 测试文档](./stage3.1/README.md)

## 注意事项

- Electron 客户端测试需要 Electron 环境
- 部分测试需要推理服务运行
- 系统资源监控测试需要系统权限

