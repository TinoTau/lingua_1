# Job7「10秒鐘之後」未译出 & Job9~11 长句前半丢失 — 根因与修复（2026-01-29）

## 1. 现象回顾

- **Job7**：原文为「10秒鐘之後,系統會不會因為超時…」，译文中**没有**「10秒鐘之後」对应内容（After 10 seconds），译文以 ", the system would not be due to overtime..." 开头。
- **Job9~11**：应对应整句「如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。」实际只有 **Job11** 有「當天的簽分策略和超市規則是基本可用的」（后半句误识别），**Job9、Job10** 在节点端 log 中 ASR/segmentForJobResult 为「未找到或为空」，整句**前半大半丢失**。

---

## 2. Job7「10秒鐘之後」丢失 — 根因：NMT 哨兵提取从「第一个」哨兵之后取

### 2.1 流程

- 节点送 NMT：`context_text + ⟪⟪SEP_MARKER⟫⟫ + current_text`（上一句 + 哨兵 + 当前句「10秒鐘之後,...」）。
- NMT 模型输出**整段**译文，服务端用 `translation_extractor.py` 的 **find_sentinel_position** 找哨兵，再从**哨兵之后**截取作为「当前句译文」。

### 2.2 根因

- **find_sentinel_position** 使用 **out.find(sep_variant)**，即**第一个**出现的哨兵位置。
- 若模型输出形如：  
  `[上一句译文] After 10 seconds, ⟪⟪SEP_MARKER⟫⟫ , the system would not be due to overtime...`  
  即把哨兵输出在**当前句中间**（逗号后），则「第一个」哨兵之后就是 `, the system would not...`，**「After 10 seconds」被算在哨兵之前而被丢弃**。
- 或模型将「10秒鐘之後」与 context 译文连在一起，只在 `, the system...` 前输出哨兵，效果相同：提取结果以逗号开头，前半被丢。

### 2.3 修复方向（NMT 服务）

1. **优先用「最后一个」哨兵**  
   当存在多个哨兵时，用 **rfind** 取最后一个，再取「最后一个哨兵之后」作为当前句译文，可减少「当前句前半」被误算到 context 侧的情况。
2. **提取结果以逗号/空格开头时的补救**  
   若提取结果以 `", "` 或 `" ,"` 开头，在完整译文 `out` 中向前看「第一个哨兵之前」的片段；若该片段以逗号结尾、长度合理（如 &lt; 50 字），则视为当前句开头，**拼到提取结果前面**，避免「10秒鐘之後」这类开头被丢。

---

## 3. Job9~11 长句前半丢失 — 根因：仅 flush pending 时 segmentForCurrentJob 为空

### 3.1 流程

- **TextForwardMergeManager** 按长度做 Gate：6–20 字 HOLD、20–40 字可等 3 秒、**>40 字 SEND**。
- 长句可能被拆成多段 ASR：先来一段 6–20 字进入 **pending**，等 3 秒；超时后**没有**新的 currentText 时，会「仅 flush pending」：  
  `return { processedText: pending.text, ..., segmentForCurrentJob: '' }`  
  即本 job **只负责把 pending 发走**，**segmentForCurrentJob 显式置空**。
- **AggregationStage** 中：  
  `segmentForJobResult = forwardMergeResult.segmentForCurrentJob ?? ''`  
  因此该 job 的 **segmentForJobResult 为空** → 客户端**原文（text_asr）为空**，且 NMT 输入也是空或跳过，**前半句不会出现在任何 job 的「本段」里**。

### 3.2 根因归纳

- 长句前半作为 **pending** 在超时后被 SEND 去语义修复/NMT，但**本 job** 的 **segmentForCurrentJob** 被设为 **''**（设计上表示「本 job 无当前文本，只 flush pending」）。
- 于是：
  - 前半句的**原文**没有归属到任何 job 的 **segmentForJobResult** → 客户端看不到前半句原文；
  - 若该 job 因 segment 为空而跳过 NMT，或 NMT 结果未写回某个可见 job，则**译文**也会缺失。
- Job9、Job10 在 log 中「ASR/segment 未找到或为空」，与「仅 flush pending 的 job 其 segment 为空」一致；Job11 则对应到**下一段** ASR（后半句），因此只看到后半句。

### 3.3 修复方向（节点端）

1. **仅 flush pending 时仍给本 job 一段「本段」**  
   - 不要将 **segmentForCurrentJob** 设为 **''**，而是设为 **pending.text**（即本 job 负责发走的那段 = 前半句）。  
   - 这样该 job 的 **segmentForJobResult** = 前半句，客户端能显示前半句原文，且 NMT 会用前半句做输入，译文也会挂在这个 job 上。
2. **可选：区分「仅 flush」与「有 current 的 SEND」**  
   - 若需在内部区分「仅超时 flush」与「带当前句的 SEND」，可保留现有逻辑但在**写回 segmentForJobResult** 时，对「仅 flush pending」分支使用 **pending.text** 作为本 job 的 segment，而不是空。

---

## 4. 建议实施顺序

| 问题 | 位置 | 建议修改 |
|------|------|----------|
| Job7「10秒鐘之後」未译出 | NMT 服务 `translation_extractor.py` | ① 有 context 时优先用**最后一个**哨兵（rfind）取当前句；② 若提取结果以 `", "` 开头，尝试把「第一个哨兵前」的短片段（以逗号结尾）拼到前面。 |
| Job9~11 前半句丢失 | 节点 `text-forward-merge-manager.ts` | 「仅 flush pending、无 currentText」的 return 中，将 **segmentForCurrentJob** 从 **''** 改为 **pending.text**，使前半句归属到本 job。 |

---

## 5. 相关文件

- NMT 哨兵提取：`electron_node/services/nmt_m2m100/translation_extractor.py`（find_sentinel_position、extract_with_sentinel）
- 节点 ForwardMerge：`electron_node/electron-node/main/src/agent/postprocess/text-forward-merge-manager.ts`（约 210–221 行，仅 flush pending 的 return）
- 聚合写回 segment：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`（segmentForJobResult = forwardMergeResult.segmentForCurrentJob ?? ''）
