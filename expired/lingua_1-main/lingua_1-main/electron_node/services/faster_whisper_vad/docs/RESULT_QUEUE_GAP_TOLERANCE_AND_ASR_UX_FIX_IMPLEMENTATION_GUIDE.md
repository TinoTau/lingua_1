
# 可直接执行的技术方案：结果队列防卡死 + 体验修复（Rust `result_queue.rs`）
## 适用范围：当前项目未上线、无兼容约束，可直接重构

---

## 1. 目标与成功标准（DoD）

### 1.1 必须解决的问题（P0）
- **结果队列不会因缺失某个 `utterance_index` 而永久卡死**
- Web 端在持续输入语音时，**持续收到输出**（即使某段缺失/超时）

### 1.2 体验修复（P1）
- **跨 utterance 重复文本显著下降**（尤其是“重复三连”）
- 关键链路具备“证据化”能力：可保存节点端 PCM/WAV 进行离线对照

### 1.3 验收指标（建议）
- 并发压测（同会话内乱序/丢包模拟）：队列不锁死；`pending` 不无限增长
- 断续网络：Gap 超时后可继续放行后续结果
- 连续 missing 达阈值触发会话重置（可选），不出现无限 missing 输出

---

## 2. 现状与根因（来自你提供的状态报告）

- `get_ready_results()` 当前行为：**严格按 `expected_utterance_index` 连续返回**
- 任何一个 index 缺失/延迟会导致：后续结果全部积压、Web 端无输出（系统“不可用”）

**根因结论：** 目前队列是“严格序列一致性队列”，但上游结果到达是“可能乱序/可能丢失”的现实网络系统。必须引入 **Gap Tolerance**（缺口容忍）机制。

---

## 3. 解决方案总览（推荐：方案 A）

### 3.1 方案 A（推荐）：Gap 超时跳过 + Missing 占位结果
- 队列期待 `expected_index`
- 若该 index 在 **T 秒**内未到：输出 `Missing(expected_index)`，然后 **expected_index++**
- 后续已到达的结果可继续放行
- 通过 `Missing` 让上游（Web/调度）知道“这段丢了/超时了”，但系统持续运行

### 3.2 为什么不用“纯到达顺序返回”
- 会导致对话顺序错乱，用户体验明显变差
- 方案 A 在保证“尽量顺序”的同时避免锁死，是更平衡的设计

---

## 4. Rust 代码改造：`result_queue.rs`（核心）

> 说明：以下为可直接落地的实现结构。你可以把它作为 patch 基准，按你们现有类型名微调。  
> 要点：使用 `BTreeMap` 存 pending，支持顺序 pop；引入 gap 计时器与上限。

### 4.1 新增/调整的数据结构

#### 4.1.1 ResultItem（建议增加 Missing 变体）
```rust
#[derive(Clone, Debug)]
pub enum ResultItem {
    Normal(NormalResult),

    /// 缺失占位：用于防止队列锁死
    Missing {
        utterance_index: u64,
        reason: MissingReason,
        created_at_ms: u128,
    },
}

#[derive(Clone, Debug)]
pub enum MissingReason {
    GapTimeout,
    PendingOverflowEvict,
}
```

> 如果你们已有统一返回结构（JSON payload），建议也把 Missing 序列化出去，便于前端/日志诊断。

#### 4.1.2 ResultQueue（新增 gap 控制字段）
```rust
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

pub struct ResultQueue {
    expected: u64,
    pending: BTreeMap<u64, ResultItem>,

    gap_timeout: Duration,     // e.g. 5s
    gap_wait_start: Instant,   // 从开始等待 expected 的时刻计时

    pending_max: usize,        // e.g. 200
    consecutive_missing: u32,  // 连续 Missing 计数（可用于触发重置）
    missing_reset_threshold: u32, // e.g. 20
}
```

### 4.2 初始化与配置（建议）
- `gap_timeout = 5s`
- `pending_max = 200`（或按时间窗/内存预算）
- `missing_reset_threshold = 20`（连续 missing 过多认为会话断流）

```rust
impl ResultQueue {
    pub fn new(expected: u64) -> Self {
        Self {
            expected,
            pending: BTreeMap::new(),
            gap_timeout: Duration::from_secs(5),
            gap_wait_start: Instant::now(),
            pending_max: 200,
            consecutive_missing: 0,
            missing_reset_threshold: 20,
        }
    }
}
```

### 4.3 push：写入 pending + 上限保护（防止内存爆）
```rust
impl ResultQueue {
    pub fn push(&mut self, utterance_index: u64, item: ResultItem) {
        // 覆盖写入或首次写入
        self.pending.insert(utterance_index, item);

        // pending 上限保护：如果 pending 过大，优先丢弃“最远”的结果
        while self.pending.len() > self.pending_max {
            // 丢弃最大 key（最远未来），避免无限堆积
            if let Some((&k, _)) = self.pending.iter().next_back() {
                self.pending.remove(&k);
            } else {
                break;
            }
        }
    }
}
```

### 4.4 get_ready_results：核心逻辑（放行 + gap timeout）
```rust
impl ResultQueue {
    pub fn get_ready_results(&mut self) -> Vec<ResultItem> {
        let mut out = Vec::new();

        loop {
            // 1) expected 已到：直接放行
            if let Some(item) = self.pending.remove(&self.expected) {
                out.push(item);
                self.expected += 1;
                self.gap_wait_start = Instant::now();
                self.consecutive_missing = 0;
                continue;
            }

            // 2) expected 未到：检查是否超时
            if self.gap_wait_start.elapsed() >= self.gap_timeout {
                out.push(ResultItem::Missing {
                    utterance_index: self.expected,
                    reason: MissingReason::GapTimeout,
                    created_at_ms: current_time_ms(),
                });
                self.expected += 1;
                self.gap_wait_start = Instant::now();
                self.consecutive_missing += 1;
                continue;
            }

            // 3) 未超时且 expected 未到：停止
            break;
        }

        out
    }

    pub fn should_reset_session(&self) -> bool {
        self.consecutive_missing >= self.missing_reset_threshold
    }
}

fn current_time_ms() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()
}
```

### 4.5 上层接入点（必须做）
- `get_ready_results()` 返回后，如果 `should_reset_session()==true`：  
  - 由调度/会话层触发“重连/重置 utterance_index”或要求 Web 端重新建立 session
- Web 端收到 `Missing`：
  - 默认：不显示（静默丢弃），但记录 debug 日志
  - 调试模式：显示“某段识别超时/丢失”

---

## 5. 调度服务器侧：跨 utterance 去重闸门（P1，强烈建议）

### 5.1 设计目标
- 对每个 session 维护最近 N 条文本（建议 N=10）
- exact match 直接丢弃
- prefix/suffix 重叠做合并
- overlap 拼接去重（常见于 ASR 分段边界抖动）

### 5.2 伪代码（可直接实现）
```python
def normalize(s: str) -> str:
    return "".join(s.strip().lower().split())

def dedup_merge(prev: str, curr: str) -> tuple[str, bool]:
    p, c = normalize(prev), normalize(curr)
    if not c:
        return prev, True
    if c == p:
        return prev, True
    if c.startswith(p):
        return curr, False
    if p.startswith(c):
        return prev, True

    # overlap
    K = 8
    max_k = min(len(prev), len(curr))
    for k in range(max_k, K-1, -1):
        if prev.endswith(curr[:k]):
            return prev + curr[k:], False
    return curr, False
```

---

## 6. ASR 准确度“证据化”：保存 PCM/WAV 对照（P1）

### 6.1 节点端保存解码后的 PCM16 → WAV
- 保存点：ASR 入参前（即将送入 faster-whisper 前）
- WAV 参数：16kHz / mono / s16le

#### Python 保存示例
```python
import wave

def save_wav(path, pcm16_bytes, sample_rate=16000):
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # int16
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16_bytes)
```

---

## 7. 测试计划（必须执行）

### 7.1 单元测试（Rust）
1) `expected` 连续到达：应顺序输出  
2) 缺口未超时：不输出 Missing  
3) 缺口超时：输出 Missing 且 `expected++`  
4) pending 乱序到达：gap 超时后继续放行后续  
5) pending 超限：不会 OOM，策略生效

### 7.2 集成测试（端到端）
- 模拟 utterance_index: 1,2,4,5（缺 3）
- 观察：5 秒后输出 Missing(3)，随后立即输出 4,5（若已到）
- Web 端持续有输出

---

## 8. 任务拆解（JIRA 建议）

### EPIC-RQ-1：结果队列根治（Rust）
- RQ-1.1：`ResultItem` 增加 Missing 变体（P0）
- RQ-1.2：`ResultQueue` 增加 gap_timeout / pending_max / 连续 missing 计数（P0）
- RQ-1.3：实现 `get_ready_results()` gap timeout 放行逻辑（P0）
- RQ-1.4：上层接入 `should_reset_session()`（P1）
- RQ-1.5：补齐单元测试（P0）

### EPIC-DD-1：调度服务器跨 utterance 去重（P1）
- DD-1.1：实现 normalize + exact/prefix/overlap 规则
- DD-1.2：为每 session 维护最近 N 条窗口

### EPIC-AUD-1：音频证据化（P1）
- AUD-1.1：节点端保存 PCM→WAV（开关可控）
- AUD-1.2：离线对照脚本模板

---

## 9. 默认配置建议（可直接用）
- `gap_timeout = 5s`
- `pending_max = 200`
- `missing_reset_threshold = 20`
- Web 端对 Missing：默认不展示，仅 debug 记录

---

## 10. 结论
P0：将 Rust `result_queue.rs` 从“严格顺序队列”升级为“缺口容忍队列”，系统立刻恢复持续可用。  
P1：调度侧跨 utterance 去重 + 音频证据化，显著改善重复与定位效率。
