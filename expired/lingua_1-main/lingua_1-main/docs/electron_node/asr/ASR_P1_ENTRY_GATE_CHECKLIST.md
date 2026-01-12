
# 进入 P1 前的收口清单（Gate Checklist）
## ASR P0.5 → P1 过渡验收文档

> 本文档用于明确：**在启动 P1（语义级错词 / 同音替换）开发前，
> P0.5 阶段必须完成且需要“真正闭环”的事项**。
>
> 目标不是返工，而是确保：
> - P1 的收益可被真实观测
> - 不被上下文污染或统计缺失“掩盖效果”

---

## 一、Gate 判定总览

| Gate | 是否必须 | 当前状态 | 结论 |
|---|---|---|---|
| Gate-A：Context Reset 真正生效 | 必须 | 部分完成 | ❗需补 |
| Gate-B：Rerun 指标可观测 | 强烈建议 | 部分完成 | ❗需补 |
| Gate-C：P0.5 行为稳定性回归 | 必须 | 已完成 | ✅ |
| Gate-D：P1 触发样本可收集 | 必须 | 已完成 | ✅ |

**进入 P1 的最低条件**：Gate-A + Gate-C 必须通过。

---

## 二、Gate-A（必须）：Context Reset 真实闭环

### 2.1 背景
当前实现中：
- Node / Router 层已经正确标记 `shouldResetContext = true`
- 但 **pipeline-orchestrator 尚未执行真实 reset**
- 风险：上下文继续污染后续 utterance，影响 P1 评估

### 2.2 必须实现的行为

当 pipeline-orchestrator 接收到：
```json
{
  "shouldResetContext": true,
  "sessionId": "..."
}
```

必须执行：
1. 清空该 session 的 ASR prompt/context buffer
2. 清空 translation context（如有）
3. 重置 `consecutiveLowQualityCount`
4. 记录一次 `context_reset_event` 指标

### 2.3 接口建议（示意）
```ts
interface SessionContextManager {
  resetContext(sessionId: string, reason: string): void;
}
```

### 2.4 验收用例（必须通过）
- 连续 2 次低质量 utterance → 第 3 次 ASR 不再受前文影响
- 多语言切换场景下 reset 后语言判断不被历史干扰

---

## 三、Gate-B（强烈建议）：Rerun 指标可观测

### 3.1 背景
当前 rerunMetrics 仅在内存中累积，无法回答：
- rerun 触发率？
- 成功率？
- 延迟代价？

### 3.2 最低指标集（必须至少做到）

| 指标 | 说明 |
|---|---|
| rerun_trigger_count | 触发重跑次数 |
| rerun_success_count | 重跑后 qualityScore 提升次数 |
| rerun_timeout_count | 重跑超时 |
| rerun_latency_delta_p95 | 重跑带来的 p95 延迟增量 |
| rerun_rate_by_mode | 线下 / 会议室区分 |

### 3.3 上报建议
- Node → Scheduler → Metrics（Prometheus / 日志 / TSDB 任一）
- 维度至少包含：sessionId / roomId / mode

### 3.4 验收标准
- 能在 dashboard 中回答：
  > “P0.5 的自愈机制触发了多少次？平均多慢？值不值得？”

---

## 四、Gate-C（必须）：P0.5 行为稳定性回归

### 4.1 已完成内容（确认项）
- Top-2 强制语言重跑只触发一次
- 限频 / 超时生效
- qualityScore 择优逻辑稳定
- 不影响未触发样本延迟

### 4.2 回归重点
- 会议室模式下 rerun_rate < 5%
- 线下模式 rerun_rate < 10%
- p95 ASR 延迟增量 ≤ 200ms（线下）

> 此 Gate 你们已有测试报告支撑，可直接打勾。

---

## 五、Gate-D（必须）：P1 触发样本可收集

### 5.1 背景
P1 的“同音错词”是语义级问题，必须依赖真实样本

### 5.2 必须已经具备
- 以下样本被记录并可回放：
  - isBad == false 但用户重复表达
  - isBad == false 但翻译后立刻被打断
- 原始 ASR 文本 + 翻译文本 + 时间戳

### 5.3 验收标准
- 可人工挑选 20–50 条“同音错词疑似样本”
- 用于验证 P1 模块收益

---

## 六、进入 P1 的正式声明模板（可直接使用）

> P0.5 阶段在结构稳定性与最小自愈能力上已通过验收；
> 上下文 reset 与 rerun 指标闭环完成后，
> 系统已具备评估语义级纠错（P1）的可靠基础。
>
> 因此，同意启动 P1（同音错词/语义校验）阶段开发。

---

## 七、P1 启动后不应立即做的事（反模式提醒）

- ❌ 直接引入大型语言模型进行全文“自动改写”
- ❌ 对所有 utterance 做重 ASR / 多模型 ensemble
- ❌ 在没有样本回放的情况下调参数

---

## 八、结论

- **Gate-A 是唯一硬性阻断项**
- Gate-B 虽非强制，但强烈建议在 P1 验收前完成
- 其余条件已满足

只要 Gate-A 完成，即可正式进入 P1 开发阶段。
