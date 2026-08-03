# 12 — Known Limitations

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

Known Limitations **do not** invalidate Recovery Baseline.

1. 当前词库约 **9256** terms，未达到通用开放场景覆盖。  
2. **KenLM 能力验证尚未完成**（readiness ≠ quality PASS）。  
3. **dialog_200** 只证明当前主链回归，不证明开放场景准确率。  
4. 候选级 KenLM export / provenance 仍需下一阶段完善（`candidate:i`）。  
5. 合法近音噪声仍可能进入候选池。  
6. 后续 Lexicon Expansion 必须通过 Unified Atomicity Validator。  
7. Snapshot 是**日期节点**，不是永久不可修改合同。  
8. IME `lve` vs Runtime `normalizeSyllable`→`le` 为 phonetic 对齐残差（已由 Full Rebuild 规范化缓解）。  
9. Recovery 不得依赖脏工作区或聊天记录。  
10. `npm run lexicon:gate:v3-runtime` 仍携带 Atomicity Cleanup **前** 的表行数阈值（term≥10000 / tags≥900）。当前正式 bundle（9256 / 655）会触发该脚本 FAIL；**本 Snapshot 以 checksum + Atomicity enforce Gate（0/0）为 Lexicon identity 权威**，阈值重标定属后续 Lexicon Expansion / Gate 维护，非本轮业务修改。
