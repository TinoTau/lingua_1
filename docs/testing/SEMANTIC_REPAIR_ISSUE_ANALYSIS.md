# 语义修复未执行问题分析

## 问题描述

在集成测试中，中文语音识别质量评分较低（0.5），但没有进行语义修复。

测试文本：
- **ASR 文本**: "接下来让我们继续说一些话 然后看到了一些重复的内容 问题也不是特别大"
- **文本长度**: 34 字符
- **质量评分**: 0.5 (suspect)
- **语义修复**: ❌ 未执行

## 决策逻辑

### 节点端语义修复决策条件

语义修复需要**同时满足**以下两个条件：

1. **`semanticRepairStage` 必须存在**（不为 `null`）
   - 检查：语义修复服务是否已安装并初始化
   - 初始化逻辑：`postprocess-semantic-repair-initializer.ts`
   - 需要安装以下服务之一：
     - `semantic-repair-zh`（中文语义修复）
     - `semantic-repair-en`（英文语义修复）
     - `en-normalize`（英文规范化）

2. **`shouldSendToSemanticRepair !== false`**
   - 由 `text-forward-merge-manager.ts` 根据文本长度决定：
     - **< 6 字符**: `false`（丢弃）
     - **6-16 字符**: 
       - 手动发送：`true`
       - 自动触发：`false`（等待合并）
     - **> 16 字符**: `true`（发送给语义修复）

### 当前情况

- ✅ **文本长度**: 34 字符 > 16 字符
- ✅ **`shouldSendToSemanticRepair`**: 应该是 `true`
- ❓ **`semanticRepairStage`**: 需要检查是否为 `null`

## 可能的原因

### 最可能：语义修复服务未安装或未初始化

如果 `semanticRepairStage` 为 `null`，节点端会跳过语义修复，并记录日志：
```
PostProcessCoordinator: Semantic repair stage skipped (not available)
```

**检查方法**：
1. 检查节点日志中是否有 "Semantic repair stage skipped" 或 "not available" 的信息
2. 检查节点日志中是否有 "SemanticRepairInitializer" 的初始化日志
3. 检查节点端是否安装了 `semantic-repair-zh` 服务
4. 检查节点配置中 `servicePreferences.semanticRepairZhEnabled` 是否为 `true`

### 其他可能原因

1. **初始化失败**：语义修复服务初始化过程中出错，但被静默处理
2. **版本不匹配**：语义修复 Stage 版本在处理过程中发生变化（热插拔场景）

## 中文语义修复的执行逻辑

即使满足上述条件，中文语义修复的执行还需要：

1. **服务可用性检查**：
   - 检查 `semantic-repair-zh` 服务是否运行
   - 检查服务健康状态（只有 WARMED 状态才可用）

2. **文本处理**：
   - 中文语义修复：**对每句话都进行修复，跳过质量评分**（已改为强制修复）
   - 英文语义修复：根据质量评分决定是否触发

## 建议检查步骤

1. **检查节点日志**：
   ```bash
   # 查找语义修复相关的日志
   grep -i "semantic.*repair\|SemanticRepair" electron-node/logs/electron-main.log | tail -20
   ```

2. **检查服务状态**：
   - 在节点端检查 `semantic-repair-zh` 服务是否安装
   - 检查服务是否正在运行（状态应为 RUNNING 或 WARMED）

3. **检查配置**：
   - 检查 `electron-node-config.json` 中的 `servicePreferences.semanticRepairZhEnabled` 配置
   - 检查 `features.semanticRepair.zh` 配置

4. **查看节点端日志**：
   - 查找 "SemanticRepairInitializer" 初始化日志
   - 查找 "Semantic repair stage skipped" 跳过日志

## 修复建议

如果语义修复服务未安装或未启动：

1. **安装语义修复服务**：
   - 确保 `semantic-repair-zh` 服务已安装到节点端

2. **启动服务**：
   - 在节点端启动 `semantic-repair-zh` 服务
   - 等待服务进入 WARMED 状态

3. **检查配置**：
   - 确保 `servicePreferences.semanticRepairZhEnabled` 为 `true`
   - 重启节点端以重新初始化语义修复 Stage
