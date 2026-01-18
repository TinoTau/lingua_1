# electron_node/services 文档重组计划

**日期**: 2026-01-19  
**目标**: 整理 services 目录下的文档，归类到 electron_node/docs

---

## 📊 当前文档清单

### services 根目录文档（需要整理）

**服务相关**:
1. `SERVICES_STATUS.md` - 服务状态
2. `SERVICE_MIGRATION_GUIDE.md` - 服务迁移指南
3. `README.md` - 服务目录说明

**配置和安装**:
4. `GPU_CONFIGURATION_COMPLETE.md` - GPU配置完成
5. `PYTORCH_CUDA_INSTALLATION.md` - PyTorch CUDA安装
6. `PYTORCH_VERSION_ANALYSIS.md` - PyTorch版本分析
7. `MODEL_MIGRATION_COMPLETE.md` - 模型迁移完成
8. `MODEL_MIGRATION_SUMMARY.md` - 模型迁移总结
9. `MANUAL_PACKAGING_GUIDE.md` - 手动打包指南
10. `README_PACKAGING.md` - 打包说明

**问题修复**:
11. `HIGH_CPU_USAGE_FIX.md` - 高CPU使用修复
12. `STARTUP_CPU_USAGE_ANALYSIS.md` - 启动CPU使用分析

**测试**:
13. `test_results_summary.md` - 测试结果总结
14. `test_results_final.md` - 最终测试结果

**中文文档**:
15. `任务链日志说明.md` - 任务链日志说明
16. `查看新服务日志说明.md` - 新服务日志说明

**test 子目录**:
17. `test/README.md` - 测试说明
18. `test/README_UTTERANCE_INDEX_TEST.md` - 发音索引测试
19. `test/JOB_ASSIGN_FORMAT.md` - 任务分配格式

### 子服务目录文档（已归档或需评估）

**semantic_repair_zh/**:
- 已有 docs/ 子目录，包含完整文档
- 根目录还有：启动服务.md, 快速测试命令.md, GPU支持问题总结.md等
- 状态：旧服务，已被 semantic_repair_en_zh 替代

**semantic_repair_en/**:
- 快速测试命令.md, 修复说明.md
- 状态：旧服务，已被 semantic_repair_en_zh 替代

**semantic_repair_en_zh/**:
- 已完成重组，文档结构完善
- 状态：当前活跃服务

**faster_whisper_vad/**:
- 包含大量md文档（~186个）
- 需要评估是否需要整理

**nmt_m2m100/**, **piper_tts/**, **speaker_embedding/** 等:
- 各有少量文档
- 状态：活跃服务

---

## 🎯 重组方案

### 目标目录结构

```
electron_node/docs/
├── services/                      # 服务相关（新建）
│   ├── README.md                      # 服务总览
│   ├── SERVICES_STATUS.md             # 服务状态
│   ├── SERVICE_MIGRATION_GUIDE.md     # 迁移指南
│   ├── MANUAL_PACKAGING_GUIDE.md      # 打包指南
│   └── README_PACKAGING.md            # 打包说明
│
├── configuration/                 # 配置文档（新建）
│   ├── GPU_CONFIGURATION_COMPLETE.md
│   ├── PYTORCH_CUDA_INSTALLATION.md
│   ├── PYTORCH_VERSION_ANALYSIS.md
│   ├── MODEL_MIGRATION_COMPLETE.md
│   └── MODEL_MIGRATION_SUMMARY.md
│
├── troubleshooting/               # 故障排查（新建）
│   ├── HIGH_CPU_USAGE_FIX.md
│   └── STARTUP_CPU_USAGE_ANALYSIS.md
│
├── testing/                       # 测试文档（已有，扩充）
│   ├── test_results_summary.md
│   ├── test_results_final.md
│   ├── README_UTTERANCE_INDEX_TEST.md
│   └── JOB_ASSIGN_FORMAT.md
│
├── operations/                    # 运维文档（新建）
│   ├── 任务链日志说明.md
│   └── 查看新服务日志说明.md
│
└── archived/                      # 归档（新建）
    └── deprecated_services/       # 已弃用服务
        ├── semantic_repair_zh/
        │   └── (旧服务文档)
        └── semantic_repair_en/
            └── (旧服务文档)
```

---

## 📋 移动操作清单

### 1. 创建新目录
- ✅ `docs/services/`
- ✅ `docs/configuration/`
- ✅ `docs/troubleshooting/`
- ✅ `docs/operations/`
- ✅ `docs/archived/deprecated_services/`

### 2. 移动服务相关文档 → docs/services/
- `SERVICES_STATUS.md`
- `SERVICE_MIGRATION_GUIDE.md`
- `MANUAL_PACKAGING_GUIDE.md`
- `README_PACKAGING.md`
- `services/README.md` → `docs/services/SERVICES_DIRECTORY_README.md`

### 3. 移动配置文档 → docs/configuration/
- `GPU_CONFIGURATION_COMPLETE.md`
- `PYTORCH_CUDA_INSTALLATION.md`
- `PYTORCH_VERSION_ANALYSIS.md`
- `MODEL_MIGRATION_COMPLETE.md`
- `MODEL_MIGRATION_SUMMARY.md`

### 4. 移动故障排查文档 → docs/troubleshooting/
- `HIGH_CPU_USAGE_FIX.md`
- `STARTUP_CPU_USAGE_ANALYSIS.md`

### 5. 移动测试文档 → docs/testing/
- `test_results_summary.md`
- `test_results_final.md`
- `test/README.md` → `docs/testing/TEST_DIRECTORY_README.md`
- `test/README_UTTERANCE_INDEX_TEST.md`
- `test/JOB_ASSIGN_FORMAT.md`

### 6. 移动运维文档 → docs/operations/
- `任务链日志说明.md`
- `查看新服务日志说明.md`

### 7. 归档旧服务文档 → docs/archived/deprecated_services/
- `semantic_repair_zh/` 全部文档
- `semantic_repair_en/` 全部文档

---

## 🎯 重组原则

### 1. 保持服务目录整洁
- 各服务目录只保留：代码、配置、requirements.txt、service.json
- README.md 保留（服务说明）
- 其他文档移至 docs/

### 2. 文档分类清晰
- 按用途分类（服务/配置/故障排查/测试/运维）
- 历史文档归档（旧服务）

### 3. 不影响当前服务
- semantic_repair_en_zh 保持不动（已重组）
- 活跃服务的 README.md 保留
- 只整理根目录和旧服务的文档

---

## ✅ 验证清单

### 移动后验证
- ✅ 所有文档都已移动
- ✅ 没有文档丢失
- ✅ 目录结构清晰
- ✅ services 根目录整洁

### 链接更新
- ✅ 更新 electron_node/docs/README.md
- ✅ 添加新分类目录的说明

---

**状态**: 准备执行
