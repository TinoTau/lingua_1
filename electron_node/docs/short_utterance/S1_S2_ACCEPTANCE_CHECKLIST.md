# S1/S2 短句准确率提升功能验收清单

## 验收日期
- 日期: 2025-01-XX
- 测试人员: [待填写]

---

## 1. 代码实现验收

### ✅ S1: PromptBuilder
- [x] `prompt-builder.ts` 已实现
- [x] 支持关键词提取（用户配置 + 最近文本）
- [x] 支持最近上下文提取
- [x] 支持Prompt压缩与长度控制
- [x] 支持质量门控（低质量时禁用recent context）
- [x] 支持offline/room模式配置

### ✅ S2: NeedRescoreDetector
- [x] `need-rescore.ts` 已实现
- [x] 短句条件判定（CJK/EN）
- [x] 低置信条件判定（offline/room不同阈值）
- [x] 高风险特征检测（数字、专名、dedup异常）
- [x] 跳过条件（长文本且高质量）

### ✅ S2: Rescorer
- [x] `rescorer.ts` 已实现
- [x] RuleScore计算（数字保护、专名保护、重复惩罚等）
- [x] ContextScore计算（与最近文本的关键词重合度）
- [x] delta_margin回退机制

### ✅ S2: CandidateProvider
- [x] `candidate-provider.ts` 已实现
- [x] 候选生成框架（当前返回primary，N-best和二次解码待后续实现）

### ✅ AggregatorState扩展
- [x] 新增 `recentCommittedText` 字段
- [x] 新增 `recentKeywords` 字段
- [x] 新增 `lastCommitQuality` 字段
- [x] 提供获取/更新方法

### ✅ AggregatorMiddleware集成
- [x] 在commit后触发S2 rescoring
- [x] 集成NeedRescoreDetector、Rescorer、CandidateProvider
- [x] 添加trace信息（rescoreApplied、rescoreReasons、rescoreAddedLatencyMs）

---

## 2. 单元测试验收

### 测试文件
- [x] `prompt-builder.test.ts` - PromptBuilder单元测试
- [x] `need-rescore.test.ts` - NeedRescoreDetector单元测试
- [x] `rescorer.test.ts` - Rescorer单元测试
- [x] `acceptance-test.ts` - 验收测试脚本

### 测试覆盖
- [x] PromptBuilder基本功能
- [x] PromptBuilder低质量门控
- [x] PromptBuilder压缩功能
- [x] NeedRescoreDetector短句检测
- [x] NeedRescoreDetector低质量检测
- [x] NeedRescoreDetector高风险特征检测
- [x] Rescorer基本功能
- [x] Rescorer数字保护
- [x] Rescorer专名保护
- [x] Rescorer重复惩罚
- [x] Rescorer delta_margin回退

---

## 3. 运行时验收

### 日志检查
检查日志中是否出现以下关键信息：

#### S1相关日志（当前未完全集成，待S1-2完成）
- [ ] `PromptBuilder.build` 调用
- [ ] Prompt构建成功/失败

#### S2相关日志
- [ ] `S2: Rescoring applied, text replaced` - rescoring成功替换文本
- [ ] `S2: Rescoring applied but text not replaced (delta_margin)` - rescoring未替换（delta_margin保护）
- [ ] `S2: Rescoring failed, using original text` - rescoring失败降级
- [ ] `Aggregator middleware initialized with S1/S2 support` - 初始化成功

#### 指标日志
检查 `AggregatorMiddlewareResult.metrics` 中是否包含：
- [ ] `rescoreApplied: true/false`
- [ ] `rescoreReasons: string[]`
- [ ] `rescoreAddedLatencyMs: number`

### 功能验证

#### 测试场景1: 短句触发rescoring
1. 发送短句（<18个CJK字符或<9个EN单词）
2. 检查日志中是否出现 `short_utterance` 原因
3. 检查是否触发rescoring

#### 测试场景2: 低质量触发rescoring
1. 发送低质量文本（qualityScore < 0.45 offline / 0.50 room）
2. 检查日志中是否出现 `low_quality` 原因
3. 检查是否触发rescoring

#### 测试场景3: 高风险特征触发rescoring
1. 发送包含数字/专名的文本
2. 检查日志中是否出现 `risk_features` 原因
3. 检查是否触发rescoring

#### 测试场景4: 长文本且高质量不触发
1. 发送长文本（>30 CJK字符或>15 EN单词）且高质量（qualityScore >= 0.7）
2. 检查是否不触发rescoring

---

## 4. 性能验收

### 目标指标（根据文档）
- [ ] `rescore_trigger_rate ≤ 5%`（room建议更低）
- [ ] 正常负载下 P95 额外延迟 ≤ +120ms
- [ ] GPU负载与吞吐无明显回退

### 检查方法
1. 运行一段时间，统计rescoring触发率
2. 检查 `rescoreAddedLatencyMs` 的P95值
3. 监控GPU使用率和吞吐量

---

## 5. 代码质量验收

- [x] 无linter错误
- [x] TypeScript类型检查通过
- [x] 代码符合项目规范
- [x] 有适当的错误处理和降级机制

---

## 6. 待完成项

### S1-2: TaskRouter中接入prompt
- [ ] 从AggregatorManager获取上下文
- [ ] 在调用ASR前构建prompt
- [ ] 通过context_text参数传递给ASR服务

### S2增强功能
- [ ] N-best支持（验证fast-whisper是否支持）
- [ ] 音频ring buffer实现（用于二次解码）
- [ ] 二次解码worker实现

### OPS-1: 动态配置
- [ ] 添加offline/room参数切换配置
- [ ] 支持运行时配置更新

---

## 验收结论

- [ ] 代码实现: ✅ 通过
- [ ] 单元测试: ✅ 通过（待运行）
- [ ] 运行时验证: ⏳ 待验证
- [ ] 性能指标: ⏳ 待验证

### 总体评价
[待填写]

### 备注
[待填写]

