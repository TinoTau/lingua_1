# 文档重组计划

**日期**: 2026-01-19  
**目标**: 整理 semantic_repair_en_zh 服务的文档结构

---

## 📊 当前文档清单

### 根目录下的文档（需要整理）
1. README.md - 主文档
2. ASR_COMPATIBILITY.md - ASR兼容性说明
3. TEST_SUMMARY.md - 测试总结
4. LOGGING_SUMMARY.md - 日志总结
5. DOCUMENTATION_SUMMARY.md - 文档整理总结
6. DEPLOYMENT_CHECKLIST.md - 部署检查清单
7. MODELS_SETUP_GUIDE.md - 模型安装指南
8. FILE_MANIFEST.md - 文件清单
9. SERVICE_REGISTRATION.md - 服务注册说明

### docs/ 目录现有文档
1. README.md - docs 目录索引
2. API_REFERENCE.md - API参考
3. ARCHITECTURE.md - 架构设计
4. CONFIGURATION.md - 配置说明
5. TESTING_GUIDE.md - 测试指南
6. MAINTENANCE_GUIDE.md - 维护指南
7. TROUBLESHOOTING.md - 故障排查
8. PERFORMANCE_OPTIMIZATION.md - 性能优化
9. LLAMACPP_ENGINE.md - LlamaCpp引擎说明
10. SCRIPTS_USAGE_GUIDE.md - 脚本使用指南
11. README_SCRIPTS.md - 脚本说明

### 历史/实现文档（需要归档）
1. CLEANUP_SUMMARY.md - 清理总结
2. CURRENT_ISSUE_AND_SOLUTION.md - 当前问题和解决方案
3. GPTQ_QUANTIZATION_ISSUE_REPORT.md - GPTQ量化问题报告
4. IMPLEMENTATION_DECISION.md - 实现决策
5. LLAMACPP_IMPLEMENTATION_PLAN.md - LlamaCpp实现计划
6. LLAMACPP_IMPLEMENTATION_STATUS.md - LlamaCpp实现状态
7. MODEL_DOWNLOAD_COMPLETE.md - 模型下载完成
8. OPTIMIZATION_SUMMARY.md - 优化总结
9. SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md - 双引擎自动调优规范
10. SEMANTIC_REPAIR_FALLBACK_PLANS_BCD.md - 降级方案
11. SERVICE_COMPATIBILITY_VERIFICATION.md - 服务兼容性验证
12. SOLUTION_SUMMARY.md - 解决方案总结
13. 决策报告_技术方案变更.md - 技术方案变更决策报告
14. 问题报告_中文.md - 问题报告（中文）

---

## 🎯 重组方案

### 📁 新的文档结构

```
semantic_repair_en_zh/
├── README.md                      # 主文档（保持不变）
├── MODELS_SETUP_GUIDE.md          # 模型安装指南（保持在根目录）
├── ASR_COMPATIBILITY.md           # ASR兼容性（保持在根目录）
│
├── docs/
│   ├── README.md                  # 文档索引（更新）
│   │
│   ├── core/                      # 核心文档
│   │   ├── ARCHITECTURE.md
│   │   ├── API_REFERENCE.md
│   │   ├── CONFIGURATION.md
│   │   └── LLAMACPP_ENGINE.md
│   │
│   ├── operations/                # 运维文档
│   │   ├── MAINTENANCE_GUIDE.md
│   │   ├── TROUBLESHOOTING.md
│   │   ├── PERFORMANCE_OPTIMIZATION.md
│   │   └── DEPLOYMENT_CHECKLIST.md (从根目录移入)
│   │
│   ├── testing/                   # 测试文档
│   │   ├── TESTING_GUIDE.md
│   │   └── TEST_SUMMARY.md (从根目录移入)
│   │
│   ├── scripts/                   # 脚本文档
│   │   ├── SCRIPTS_USAGE_GUIDE.md
│   │   └── README_SCRIPTS.md
│   │
│   ├── development/               # 开发文档
│   │   ├── LOGGING_SUMMARY.md (从根目录移入)
│   │   ├── FILE_MANIFEST.md (从根目录移入)
│   │   └── SERVICE_REGISTRATION.md (从根目录移入)
│   │
│   ├── summaries/                 # 总结报告
│   │   └── DOCUMENTATION_SUMMARY.md (从根目录移入)
│   │
│   └── archived/                  # 历史文档（归档）
│       ├── implementation/
│       │   ├── IMPLEMENTATION_DECISION.md
│       │   ├── LLAMACPP_IMPLEMENTATION_PLAN.md
│       │   ├── LLAMACPP_IMPLEMENTATION_STATUS.md
│       │   ├── SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md
│       │   ├── SEMANTIC_REPAIR_FALLBACK_PLANS_BCD.md
│       │   └── 决策报告_技术方案变更.md
│       │
│       ├── issues/
│       │   ├── CURRENT_ISSUE_AND_SOLUTION.md
│       │   ├── GPTQ_QUANTIZATION_ISSUE_REPORT.md
│       │   ├── SERVICE_COMPATIBILITY_VERIFICATION.md
│       │   └── 问题报告_中文.md
│       │
│       └── summaries/
│           ├── CLEANUP_SUMMARY.md
│           ├── MODEL_DOWNLOAD_COMPLETE.md
│           ├── OPTIMIZATION_SUMMARY.md
│           └── SOLUTION_SUMMARY.md
│
└── tests/
    └── README.md                  # 测试说明（保持不变）
```

---

## 📋 移动操作清单

### 从根目录移动到 docs/operations/
- ✅ DEPLOYMENT_CHECKLIST.md

### 从根目录移动到 docs/testing/
- ✅ TEST_SUMMARY.md

### 从根目录移动到 docs/development/
- ✅ LOGGING_SUMMARY.md
- ✅ FILE_MANIFEST.md
- ✅ SERVICE_REGISTRATION.md

### 从根目录移动到 docs/summaries/
- ✅ DOCUMENTATION_SUMMARY.md

### 从 docs/ 移动到 docs/core/
- ✅ ARCHITECTURE.md
- ✅ API_REFERENCE.md
- ✅ CONFIGURATION.md
- ✅ LLAMACPP_ENGINE.md

### 从 docs/ 移动到 docs/operations/
- ✅ MAINTENANCE_GUIDE.md
- ✅ TROUBLESHOOTING.md
- ✅ PERFORMANCE_OPTIMIZATION.md

### 从 docs/ 移动到 docs/testing/
- ✅ TESTING_GUIDE.md

### 从 docs/ 移动到 docs/scripts/
- ✅ SCRIPTS_USAGE_GUIDE.md
- ✅ README_SCRIPTS.md

### 从 docs/ 移动到 docs/archived/implementation/
- ✅ IMPLEMENTATION_DECISION.md
- ✅ LLAMACPP_IMPLEMENTATION_PLAN.md
- ✅ LLAMACPP_IMPLEMENTATION_STATUS.md
- ✅ SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md
- ✅ SEMANTIC_REPAIR_FALLBACK_PLANS_BCD.md
- ✅ 决策报告_技术方案变更.md

### 从 docs/ 移动到 docs/archived/issues/
- ✅ CURRENT_ISSUE_AND_SOLUTION.md
- ✅ GPTQ_QUANTIZATION_ISSUE_REPORT.md
- ✅ SERVICE_COMPATIBILITY_VERIFICATION.md
- ✅ 问题报告_中文.md

### 从 docs/ 移动到 docs/archived/summaries/
- ✅ CLEANUP_SUMMARY.md
- ✅ MODEL_DOWNLOAD_COMPLETE.md
- ✅ OPTIMIZATION_SUMMARY.md
- ✅ SOLUTION_SUMMARY.md

---

## 🎯 重组后的优势

### 1. 清晰的分类 ⭐⭐⭐
- **核心文档** - 架构、API、配置等技术文档
- **运维文档** - 维护、故障排查、部署等
- **测试文档** - 测试指南和总结
- **脚本文档** - 脚本使用说明
- **开发文档** - 日志、文件清单等开发者需要的信息
- **归档文档** - 历史决策、问题报告、实现过程文档

### 2. 更好的可维护性 ⭐⭐
- 相关文档聚合在一起
- 历史文档归档，不影响当前文档
- 易于查找特定类型的文档

### 3. 符合最佳实践 ⭐⭐
- 根目录保持简洁（只有主README、快速入门、兼容性说明）
- docs/ 目录结构化组织
- 归档文档单独存放

---

## ✅ 执行步骤

1. 创建新的目录结构
2. 移动文件到对应目录
3. 更新 docs/README.md 索引
4. 更新主 README.md 的文档链接
5. 验证所有链接是否正确

---

**状态**: 等待执行
