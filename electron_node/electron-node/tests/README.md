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
    └── model-manager.test.ts      # ModelManager 单元测试
└── stage3.2/              # 阶段 3.2：模块化功能实现测试
    ├── README.md          # 阶段 3.2 测试说明
    └── TEST_REPORT.md     # 测试结果报告
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

### 阶段 3.2：模块化功能实现测试

- [x] 模块管理器测试 ✅（8/8 通过，100%）
- [x] 模块依赖解析器测试 ✅（10/10 通过，100%）
- [x] capability_state 测试 ✅（4/4 通过，100%）
- [x] 总体测试结果 ✅（22/22 通过，100%）

详细说明请参考 [阶段 3.2 测试文档](./stage3.2/README.md)

## 快速运行（与 finalize/聚合 相关验证）

- **构建**：`npm run build:main`
- **TextForwardMergeManager**（forward merge 逻辑）：`npx jest main/src/agent/postprocess/text-forward-merge-manager.test.ts --config jest.config.js`（约 34 例）
- **stage3.1**：`npm run test:stage3.1`
- **stage3.2**：`npm run test:stage3.2`（部分用例需 Opus/VM 或外部服务，见各 stage 的 README）
- **聚合相关**：`powershell -ExecutionPolicy Bypass -File run-aggregation-tests.ps1`（编译 + TextForwardMergeManager + 聚合相关用例）

## 注意事项

- Electron 客户端测试需要 Electron 环境
- 部分测试需要推理服务运行
- 系统资源监控测试需要系统权限
- stage3.2 中 opus-encoder 相关测试需 Node 的 `--experimental-vm-modules`，否则可能报 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`

