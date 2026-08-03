# 12 — Known Limitations

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

Known Limitations **do not** invalidate Recovery Baseline.

1. 当前词库约 **9259** terms（Recall Candidate Recovery 后正式 Runtime；Git freeze tip 曾为 9256），未达到通用开放场景覆盖。  
2. **Tone 模型预测并非 100% 准确**；有效 Tone Evidence 下的调值误差属于 **ACCEPTED_MODEL_LIMITATION**，可使正确词不进入 SQLite Result。  
3. 当前系统优先避免无 Tone 条件下的大量模糊候选；**不得**仅因 Tone 非 100% 准确而恢复 Plain Fallback。  
4. **Raw-only** 候选池是合法保底（**VALID_RAW_FALLBACK**），不是 Framework 故障。  
5. 发音变形 / 口音 / ASR 音节漂移属于 **ACCEPTED_INPUT_AMBIGUITY**；部分误解允许后续对话澄清。  
6. **KenLM 能力验证尚未完成**（readiness ≠ quality PASS）；KenLM 只评价已生成候选。  
7. 仅 **candidateCount ≥ 2** 的真实竞争 Case 具备 KenLM 排序评价价值；Raw-only 不得用于判断 KenLM 排序能力。  
8. **dialog_200** 只证明当前主链回归，不证明开放场景准确率。  
9. 候选级 KenLM export / provenance 仍需下一阶段完善（`candidate:i`）。  
10. `normalizeSyllable` 剥离 ü（如「率」→`l`）标记为 **KNOWN_DATA_NORMALIZATION_DEBT** · **NON_BLOCKING_FOR_CURRENT_FREEZE**（本轮文档冻结不改代码）。  
11. 后续 Lexicon Expansion 必须通过 Unified Atomicity Validator。  
12. Snapshot 是**日期节点**，不是永久不可修改合同。  
13. IME `lve` vs Runtime `normalizeSyllable`→`le` 为 phonetic 对齐残差（已由 Full Rebuild 规范化缓解）。  
14. Recovery 不得依赖脏工作区或聊天记录。  
15. `npm run lexicon:gate:v3-runtime` 仍携带 Atomicity Cleanup **前** 的表行数阈值（term≥10000 / tags≥900）。当前正式 bundle 会触发该脚本 FAIL；**本 Snapshot 以 checksum + Atomicity enforce Gate（0/0）为 Lexicon identity 权威**，阈值重标定属后续维护。
