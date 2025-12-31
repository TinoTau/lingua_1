# S1/S2 效果验证清单

## 快速验证步骤

### 1. 检查日志文件
```powershell
# 在 electron-node/main 目录下运行
if (Test-Path "logs\electron-main.log") {
    $log = Get-Content "logs\electron-main.log" -Tail 2000 -Raw -Encoding UTF8
    # 检查S1 Prompt
    $s1Count = ($log | Select-String -Pattern "S1: Prompt built" -AllMatches).Matches.Count
    Write-Host "S1 Prompt built: $s1Count times"
    # 检查S2 Rescoring
    $s2Count = ($log | Select-String -Pattern "S2: Rescoring" -AllMatches).Matches.Count
    Write-Host "S2 Rescoring triggered: $s2Count times"
    # 检查重复检测
    $dupCount = ($log | Select-String -Pattern "Skipping duplicate|Detected duplicate" -AllMatches).Matches.Count
    Write-Host "Duplicates detected: $dupCount times"
}
```

### 2. 验证S1 Prompt是否工作

#### 检查点1：Prompt构建日志
- [ ] 查找日志：`S1: Prompt built and applied to ASR task`
- [ ] 检查 `promptLength` 是否在合理范围（< 600字符）
- [ ] 检查 `hasKeywords` 和 `hasRecent` 是否为 true
- [ ] 查看 `promptPreview` 确认prompt内容

#### 检查点2：ASR服务接收
- [ ] 检查 faster-whisper-vad 服务日志
- [ ] 查找：`Using text context` 或 `ASR 文本上下文`
- [ ] 确认 `context_text` 参数已传递

#### 检查点3：识别效果
- [ ] 测试包含专名的短句（如"短句"vs"短剧"）
- [ ] 对比启用前后的识别准确率
- [ ] 检查同音字错误是否减少

### 3. 验证S2 Rescoring是否工作

#### 检查点1：触发条件
- [ ] 查找日志：`S2: Rescoring condition met but skipped`
- [ ] 检查触发原因：`short_utterance`, `low_quality`, `risk_features`
- [ ] 统计触发率（应该 ≤ 5%）

#### 检查点2：当前状态
- [ ] 确认当前阶段：已暂时禁用实际rescoring（因为没有真正的候选）
- [ ] 检查日志：`S2: Rescoring skipped, no actual candidates generated`

### 4. 验证重复检测是否工作

#### 检查点1：重复检测日志
- [ ] 查找日志：`Skipping duplicate text (same as last sent after normalization)`
- [ ] 查找日志：`Skipping duplicate job result (same as last sent after normalization)`
- [ ] 查找日志：`Detected duplicate with last committed text (after normalization)`

#### 检查点2：实际效果
- [ ] 测试停止说话后是否还会重复返回
- [ ] 检查是否还有重复的文本输出

### 5. 验证音频处理

#### 检查点1：音频接收
- [ ] 查找日志：`Processing job: received audio data`
- [ ] 记录 `audioLength` 和 `utteranceIndex`

#### 检查点2：结果发送
- [ ] 查找日志：`Sending job_result to scheduler`
- [ ] 对比接收和发送的数量是否一致

---

## 预期结果

### S1 Prompt
- ✅ **Prompt构建成功率**：≥ 80%（第一次识别时可能为0，后续应该>80%）
- ✅ **Prompt长度**：< 600字符（offline模式）
- ✅ **识别准确率**：同音字错误减少 10-20%

### S2 Rescoring
- ✅ **触发率**：≤ 5%（短句、低质量、高风险特征）
- ✅ **当前状态**：已禁用实际rescoring（等待N-best实现）

### 重复检测
- ✅ **检测率**：如果停止说话后重复返回，应该检测到并阻止
- ✅ **文本规范化**：应该能检测有细微差异的重复文本

### 性能影响
- ✅ **延迟增加**：< 10ms（S1 Prompt构建）
- ✅ **内存使用**：每个session < 10KB

---

## 问题诊断

### 如果S1 Prompt未工作

**症状**：
- 日志中没有 `S1: Prompt built` 记录
- 或者有 `S1: Prompt not built` 或 `S1: Failed to build prompt`

**可能原因**：
1. AggregatorManager未正确传递
2. session_id缺失
3. recentCommittedText为空（第一次识别时）

**检查方法**：
```typescript
// 在 NodeAgent 构造函数中
const aggregatorManager = (this.aggregatorMiddleware as any).manager;
if (aggregatorManager && this.inferenceService) {
  (this.inferenceService as any).setAggregatorManager(aggregatorManager);
}
```

### 如果识别准确率未提升

**症状**：
- Prompt已构建，但识别准确率没有明显提升

**可能原因**：
1. Prompt内容不够有效
2. ASR服务未正确使用prompt
3. 关键词提取不够准确

**优化建议**：
1. 增加用户关键词配置
2. 优化关键词提取算法
3. 检查 faster-whisper-vad 服务是否正确使用 `context_text`

### 如果仍有重复返回

**症状**：
- 停止说话后仍然重复返回

**可能原因**：
1. 文本规范化不够严格
2. 相似度阈值过高
3. 更新时机问题

**检查方法**：
- 查看重复检测日志
- 检查 `lastSentText` 的更新时机
- 调整相似度阈值（从95%降低到90%）

---

## 验证报告模板

```
## S1/S2 效果验证报告

### 测试日期
2025-01-XX

### S1 Prompt验证
- Prompt构建次数: X
- Prompt构建成功率: X%
- Prompt平均长度: X 字符
- 识别准确率提升: X%

### S2 Rescoring验证
- 触发次数: X
- 触发率: X%
- 触发原因分布:
  - short_utterance: X 次
  - low_quality: X 次
  - risk_features: X 次

### 重复检测验证
- 检测到重复: X 次
- 阻止重复返回: X 次

### 性能影响
- 延迟增加: X ms
- 内存使用: X KB/session

### 问题
- [列出发现的问题]

### 建议
- [列出优化建议]
```

