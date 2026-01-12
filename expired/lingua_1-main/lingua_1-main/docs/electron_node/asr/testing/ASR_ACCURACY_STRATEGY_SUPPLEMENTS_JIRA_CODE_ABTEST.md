
# ASR 准确率提升方案补充文档
## 补充 1：JIRA Task List（含工期）/ 补充 2：代码骨架 / 补充 3：A/B 与压测指标

> 本文为《ASR_MULTILINGUAL_TURN_TAKING_ACCURACY_STRATEGY.md》的补充交付物。  
> 目标：让开发团队可以直接排期、动工、验收。

---

## 1) JIRA Task List（含工期与验收）

### EPIC-ASR-EDGE：边界稳态化（Hangover / Padding / Short-merge / Optional overlap）
| Key | 任务 | Priority | Estimate | 交付/验收 |
|---|---|---:|---:|---|
| EDGE-1 | 梳理 finalize 触发路径（自动静音/手动截断/异常结束）并统一接口 | P0 | 0.5d | 所有 finalize 进入统一函数 |
| EDGE-2 | 自动 finalize Hangover（120–180ms）实现 | P0 | 0.5d | 断句尾音漏字率下降（抽样对比） |
| EDGE-3 | 手动截断 finalize Hangover（180–220ms）实现 | P0 | 0.5d | 手动截断下句尾完整性提升 |
| EDGE-4 | Padding（200–300ms 静音）实现 | P0 | 0.5d | 同音频对比：句尾 token 更稳定 |
| EDGE-5 | Short-merge（<400ms 缓冲并合并下一段）实现 | P0 | 1d | 短片段误识别/乱码下降 |
| EDGE-6 | Optional lookback overlap（80–120ms）实现（开关） | P1 | 1d | 与去重联动后重复不显著上升 |
| EDGE-7 | 开关与配置下发（不同模式：线下/会议室） | P0 | 0.5d | 配置可热更新或启动加载 |

### EPIC-ASR-EVIDENCE：音频证据化（WAV dump 与离线对照）
| Key | 任务 | Priority | Estimate | 交付/验收 |
|---|---|---:|---:|---|
| EVD-1 | 节点端保存 WAV：VAD 前 raw / VAD 后（若存在） | P0 | 0.5d | 生成文件，命名含 session/utt/flags |
| EVD-2 | 保存策略：采样率/声道/位深一致性校验 | P0 | 0.5d | WAV 可被 ffplay/whisper 正常读取 |
| EVD-3 | 离线对照脚本（同版本 faster-whisper） | P1 | 0.5d | 输出对照报告模板 |

### EPIC-ASR-LANG：语言置信度策略（不可固定语言）
| Key | 任务 | Priority | Estimate | 交付/验收 |
|---|---|---:|---:|---|
| LANG-1 | 接入字段：language / probability / probabilities（端到端透传） | P0 | 0.5d | 日志/协议可见 |
| LANG-2 | 置信度分级（>=0.90 / >=0.70 / <0.70）策略实现 | P0 | 0.5d | 行为符合设计 |
| LANG-3 | 最近窗口 top-2 语言分布统计（session state） | P1 | 0.5d | 会议室模式路由可用 |

### EPIC-ASR-RERUN：触发式补救（Top-2 重跑）
| Key | 任务 | Priority | Estimate | 交付/验收 |
|---|---|---:|---:|---|
| RERUN-1 | 坏段判定器（短文本+长音频/乱码/重复/低置信） | P0 | 1d | 单元测试覆盖典型 case |
| RERUN-2 | Top-2 语言重跑（最多 2 次） | P1 | 1d | 触发率可控，整体吞吐无明显下降 |
| RERUN-3 | 重跑结果选择器（质量评分：字数、乱码率、重复度） | P1 | 0.5d | 选择逻辑可解释 |

### EPIC-ASR-DEDUP：跨 utterance 去重/合并（与 overlap 联动）
| Key | 任务 | Priority | Estimate | 交付/验收 |
|---|---|---:|---:|---|
| DEDUP-1 | Normalize + exact/prefix/overlap 合并规则 | P0 | 1d | 重复三连下降 |
| DEDUP-2 | 最近 N 条窗口（N=10）与指标 | P1 | 0.5d | 可观测 drop/merge |
| DEDUP-3 | 与 overlap 开关联动（避免重复放大） | P1 | 0.5d | overlap 打开后体验不下降 |

### EPIC-ASR-QA：测试与验收（A/B + 压测）
| Key | 任务 | Priority | Estimate | 交付/验收 |
|---|---|---:|---:|---|
| QA-1 | 指标埋点（见第 3 节） | P0 | 1d | dashboard/日志可核对 |
| QA-2 | A/B 实验开关（按 session/room 分桶） | P0 | 0.5d | 可控 rollout |
| QA-3 | 并发压测脚本（会议室模式） | P1 | 1d | 达到目标吞吐/延迟 |
| QA-4 | 回归测试用例库（手动截断/停顿/多语切换） | P1 | 1d | 通过率 100% |

> 总工期（单人）：约 10–14 个工作日；2 人并行可压缩到 5–7 天（依赖模块并行化）。

---

## 2) 参考代码骨架（Node 端 / Scheduler 端）

> 说明：以下为“工程骨架”，用于对齐模块边界与接口。可按你们实际语言栈（Rust/TS/Python）替换实现。

### 2.1 数据结构（端到端统一）

```ts
// Scheduler <-> Node
type AudioChunk = {
  sessionId: string;
  utteranceIndex: number;
  isManualFinalize: boolean;
  // 单位 ms：用于 bad-segment 判定（长音频短文本）
  audioDurationMs?: number;

  // 推荐：PCM16（更稳定），或保持 Opus frame list（严格帧边界）
  pcm16?: Uint8Array;
  opusFrames?: Uint8Array[];
};

type AsrResult = {
  sessionId: string;
  utteranceIndex: number;

  text: string;
  segments?: Array<{ startMs: number; endMs: number; text: string }>;

  language: string;
  languageProbability: number;
  languageProbabilities: Array<{ language: string; probability: number }>;

  // 便于策略与调试
  flags: {
    isManualFinalize: boolean;
    hangoverMs: number;
    paddingMs: number;
    shortMergeApplied: boolean;
    overlapApplied: boolean;
    rerunCount: number;
    mode: "offline_turn_taking" | "meeting_room";
  };
};
```

### 2.2 Scheduler 侧骨架（边界管理 + 去重 + 翻译路由）

```ts
class SessionState {
  expectedUtterance = 1;
  lastTexts: string[] = []; // N=10
  langWindow: Array<{ lang: string; p: number }> = []; // 最近窗口
}

function applyBoundaryStabilization(params) {
  // Hangover: 在 finalize 时延迟收尾
  // Padding: finalize 后尾部补 0
  // Short-merge: <400ms 的片段先缓存
}

function dedupAndMerge(state: SessionState, currText: string): { text: string; dropped: boolean } {
  // exact/prefix/overlap 合并
  return { text: currText, dropped: false };
}

function selectSrcLang(result: AsrResult): { lang: string; confidence: number; top2: string[] } {
  // 分级：>=0.90 / >=0.70 / <0.70
  const top2 = result.languageProbabilities
    .sort((a,b)=>b.probability-a.probability)
    .slice(0,2)
    .map(x=>x.language);
  return { lang: result.language, confidence: result.languageProbability, top2 };
}

function routeTranslation(srcLang: string, targetLang: string) {
  // meeting room：target 固定
  // offline：按对端选择输出语言（或用户配置）
}
```

### 2.3 Node 侧骨架（ASR + 证据化 + 触发式补救）

```python
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple

@dataclass
class LangProb:
    language: str
    probability: float

@dataclass
class AsrOut:
    text: str
    language: str
    language_probability: float
    language_probabilities: List[LangProb]

def dump_wav(path: str, pcm16: bytes, sr: int = 16000):
    import wave
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm16)

def bad_segment(audio_ms: int, text: str, lang_p: float) -> bool:
    if lang_p < 0.70 and audio_ms >= 1500 and len(text.strip()) < 5:
        return True
    # 乱码/异常字符比例（示例）
    import re
    bad = len(re.findall(r"[�]", text))
    if bad > 0:
        return True
    return False

def transcribe_auto(model, pcm16: bytes) -> AsrOut:
    # language=None
    # 返回包含 language_probability/probabilities（你们已实现）
    ...

def transcribe_forced(model, pcm16: bytes, lang: str) -> AsrOut:
    # 强制 language=lang
    ...

def choose_better(a: AsrOut, b: AsrOut) -> AsrOut:
    # 质量评分：文本长度、乱码率、重复度（与上句结合在 scheduler 更合适）
    score_a = len(a.text.strip()) - 10 * a.text.count("�")
    score_b = len(b.text.strip()) - 10 * b.text.count("�")
    return a if score_a >= score_b else b

def asr_pipeline(model, pcm16: bytes, audio_ms: int, mode: str) -> Tuple[AsrOut, int]:
    out = transcribe_auto(model, pcm16)
    rerun = 0

    if bad_segment(audio_ms, out.text, out.language_probability):
        # top2 rerun
        top2 = sorted(out.language_probabilities, key=lambda x: x.probability, reverse=True)[:2]
        best = out
        for lp in top2:
            forced = transcribe_forced(model, pcm16, lp.language)
            best = choose_better(best, forced)
            rerun += 1
            if rerun >= 2:
                break
        out = best

    return out, rerun
```

> 注意：Node 侧只负责“ASR 质量补救”，跨 utterance 去重/合并建议放 Scheduler（汇聚点）。

---

## 3) A/B 测试与压测指标（量化准确率与效率）

### 3.1 分桶与实验设计

- 分桶维度：`sessionId`（线下）/ `roomId`（会议室）做一致性 hash
- 实验组建议：
  - **Control**：现网（或当前 baseline）
  - **A**：边界稳态化（Hangover+Padding+Short-merge）
  - **B**：A + 语言置信分级 + 触发式重跑
  - **C（可选）**：B + overlap（需要去重联动）

### 3.2 指标体系（必须）

#### 体验/质量（ASR 侧）
- `asr_text_len`：平均文本长度（分 audio_ms 分桶）
- `asr_garbage_ratio`：乱码/非法字符比例
- `asr_tail_truncation_proxy`：末尾丢词代理指标（见下）
- `asr_language_confidence`：language_probability 分布（均值/分位）
- `asr_rerun_rate`：触发式重跑比例（目标 < 10%，会议室 < 5%）

> 末尾丢词代理指标（不需要人工标注）：
> - 音频较长（>2s）但文本极短（<3字）的比例
> - 手动截断场景下上述比例应显著下降

#### 体验/质量（跨 utterance）
- `dedup_drop_count`：去重丢弃次数
- `dedup_merge_count`：overlap 合并次数
- `repeat_triple_rate`：重复三连发生率（定义：连续 3 条 normalize 后相同或高重叠）

#### 性能/效率
- `asr_e2e_latency_ms`：从 finalize 到 ASR 返回（p50/p95/p99）
- `translate_latency_ms`：翻译耗时（会议室更关键）
- `tts_queue_wait_ms`：TTS 排队等待（影响停顿体验）
- `throughput_utt_per_min`：每分钟处理 utterance 数（会议室模式）
- `cpu/gpu_util`：节点端资源利用率（采样）

#### 稳定性
- `asr_worker_restart_count`（如有进程隔离）
- `result_queue_missing_count`（若启用 Missing 占位）

### 3.3 压测方案（会议室模式）

**目标**：在多语输入下，保持稳定吞吐与可控延迟。

- 负载模型：
  - N 个发言者（2/5/10）
  - 每人平均 utterance：2–4s
  - 停顿：2–6s（模拟等待翻译）
  - 语言分布：中/英/日/韩 + 少量其他
- 观测：
  - `asr_e2e_latency_ms` p95 不超过目标（由产品设定）
  - `asr_rerun_rate` 在阈值内
  - 去重后输出不出现大面积缺失/重复放大

### 3.4 验收门槛（建议）
- A 组相对 Control：
  - “长音频短文本”比例下降 ≥ 30%
  - 重复三连下降 ≥ 30%
  - p95 ASR 延迟增加 ≤ 10%（或绝对增加 ≤ 200ms）
- B 组相对 A：
  - 乱码/异常字符比例下降 ≥ 30%
  - 重跑率 < 10% 且整体吞吐不下降明显

---

## 4) 建议的实施顺序（最短路径）

1. 边界稳态化（Hangover/Padding/Short-merge）+ 指标埋点
2. 去重/合并（为 overlap 与手动截断兜底）
3. 语言置信度分级与 bad-segment 判定
4. 触发式 top-2 重跑（限频）
5. 会议室模式压测与阈值回调

---

## 5) 附：配置建议（可作为默认）

- 自动 finalize：Hangover 150ms，Padding 220ms
- 手动截断：Hangover 200ms，Padding 280ms
- Short-merge：<400ms 合并
- 低置信阈值：0.70；高置信：0.90
- 重跑上限：2；会议室模式建议 1（更保守）
- overlap：默认关闭，待去重稳定后再开启

