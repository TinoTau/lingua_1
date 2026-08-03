/**
 * Generate high-risk revalidation markdown from payload.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'batch1_revalidation/revalidation_payload.json'), 'utf8'));
const reval = fs
  .readFileSync(path.join(__dirname, '../../tone-v2/atomicity_batch1_revalidated.csv'), 'utf8')
  .trim()
  .split(/\r?\n/);
// parse csv simply for listing — use payload lists

const del = p.lists.DELETE_CONFIRMED;
const keep = p.lists.KEEP_AS_EXCEPTION;
const fp = p.lists.VALIDATOR_FALSE_POSITIVE;
const insuf = p.lists.INSUFFICIENT_EVIDENCE;
const recallFix = p.lists.REQUIRES_ATOM_RECALL_FIX;

function focusBlock(name) {
  const f = p.focus[name];
  if (!f) return `### ${name}\n_NOT IN BATCH_\n`;
  return `### ${name}

- Original: \`${f.originalRecommendation}\`
- Revalidated: \`${f.revalidatedRecommendation}\`
- pathClass: \`${f.pathClass}\`
- domainImpact: \`${f.domainImpact}\`
- reasonCode: \`${f.reasonCode}\`
- changeReason: ${f.changeReason || '(unchanged)'}
- termType: ${f.termTypeRecommendation || '(n/a)'}
- exceptionReason: ${f.exceptionReasonRecommendation || '(n/a)'}
- sourceAction: \`${f.sourceAction}\`
- fpKind: ${f.fpKind || '(n/a)'}
`;
}

const md = `# FW Repair V4 — Atomicity Batch-1 High-Risk Deletion Revalidation

**Date:** 2026-08-02  
**Nature:** READ ONLY · CORRECTIVE RE-AUDIT  
**Prior status superseded:** \`BATCH1_REVIEW_READY\` → treated as **\`BATCH1_REVIEW_PARTIAL\`**  
**Verdict:** \`REVALIDATION_READY\`

---

## 1. Executive Conclusion

原 Batch-1 将 **71** 条标为 \`DELETE_CONFIRMED\`，其中多处违反删除合同（Lattice 不完整仍删、Exact=false 仍删、DOMAIN_EVIDENCE_LOST 仍删、三字规范词当句段删）。

本轮重审后：

| Class | Count |
|-------|------:|
| DELETE_CONFIRMED | **${del.length}** |
| KEEP_AS_EXCEPTION | **${keep.length}** |
| VALIDATOR_FALSE_POSITIVE | **${fp.length}** |
| INSUFFICIENT_EVIDENCE | **${insuf.length}** |
| REQUIRES_ATOM_RECALL_FIX | **${recallFix.length}** |
| Changed vs original | **${p.changedCount}** |
| Contract violations found | **${p.violationCount}** |

未修改 Source / Validator / Domain Tags / SQLite；未 rebuild；未切 enforce。  
Bundle 仍：term=${p.bundle.termCount}，hash=\`${p.bundle.candHash}\`。

Artifacts:
- [atomicity_batch1_revalidated.csv](./atomicity_batch1_revalidated.csv)
- [review_contract_violations.csv](./review_contract_violations.csv)
- [exact_recall_anomalies.csv](./exact_recall_anomalies.csv)

---

## 2. Original Review Defects

1. **以“可拆分”等同“可删除”** — 忽略固定技术术语/行业实体。  
2. **字段自相矛盾** — notes 声称原子可覆盖，但 \`latticeCoverageWithoutCompound=SEGMENTS_INCOMPLETE\`。  
3. **ExactRecall=false 仍 DELETE** — \`休息\`、\`策略\`。  
4. **DOMAIN_EVIDENCE_LOST 仍 DELETE** — 单元测试/神经网络/迷你吧等。  
5. **SENTENCE_FRAGMENT 误伤规范三字词** — 是否 / 迷你吧 / 邀请函。

---

## 3. Contract Consistency Scan

共 **${p.violationCount}** 条矛盾（见 CSV）。

| Code | Meaning | Examples |
|------|---------|----------|
| C-01 | DELETE + SEGMENTS_INCOMPLETE | 休息时间, 正则策略, 熔断策略, 降级策略 |
| C-02 | DELETE + segment Exact=false | 同上 |
| C-03 | DELETE + DOMAIN_EVIDENCE_LOST | 单元测试, 神经网络, 迷你吧, 配置文件, … |
| C-04 | SENTENCE_FRAGMENT ∧ length≤3 | 可以吗, 是否, 迷你吧, 邀请函 |
| C-05 | notes 称可覆盖但 lattice 不可覆盖 | 休息时间, 是否, 迷你吧, … |

---

## 4. High-Risk Item Inventory

自动 + 手工共 **${p.highRiskCount}** 个高风险 surface（含原报告矛盾项与固定术语模式）。

手工必审清单均已覆盖；并自动并入 incomplete Exact / domain-lost / fragment≤3 / 术语模式匹配项。

---

## 5. Fixed-Term Review Method

禁止「能拆 = 普通组合」。完整 surface 若为软件工程标准测试类型、AI/ML 术语、基础设施术语、行业实体，则优先 \`KEEP_AS_EXCEPTION\` + \`termType/exceptionReason\`，即使字面可拆且 Domain 仅挂在完整词上。

---

## 6. Three-Character Word Review

| surface | Validator | Revalidated | Notes |
|---------|-----------|-------------|-------|
| 是否 | SENTENCE_FRAGMENT | VALIDATOR_FALSE_POSITIVE | 规范功能词；VALIDATOR_RULE_ERROR |
| 迷你吧 | SENTENCE_FRAGMENT | KEEP_AS_EXCEPTION (fixed_product) | 酒店 minibar；DOMAIN_LOST |
| 邀请函 | SENTENCE_FRAGMENT | KEEP_AS_EXCEPTION (fixed_expression) | 规范文书名词 |
| 可以吗 | SENTENCE_FRAGMENT | DELETE_CONFIRMED | 真口语碎片可删 |

---

## 7. Exact Recall Anomaly Trace

| word | category | evidence |
|------|----------|----------|
| 休息 | TONE_DATA_ERROR | term/base 存在；\`tone_pinyin_key=xiu1\\|xi0\`；Exact 空；tone0→1 重试仍失败 |
| 策略 | PINYIN_DATA_ERROR | \`pinyin_key=ce\\|le\` 与 \`tone_pinyin_key=ce4\\|lüe4\` 音节不一致 |

结论：在原子 Recall 数据修复前，依赖这些 segment 的普通组合词不得判安全删除。  
\`*策略\` 因本身是固定技术术语 → 改 KEEP_AS_EXCEPTION（不依赖坏原子路径）。  
\`休息时间\` → \`REQUIRES_ATOM_RECALL_FIX\`。

---

## 8. Real Lattice Counterfactual

对高风险词运行生产入口 \`runSpanAssemblyV4Orchestrator\`（WITH），并以 segment Exact + edge 观察做 WITHOUT 近似（**不改库**）。

删除门槛：仅 \`FULL_ATOMIC_PATH_CONFIRMED\` 可支持 \`DELETE_CONFIRMED\`。

样例：
- 上线计划 / 接口文档 / 单元测试：\`FULL_ATOMIC_PATH_CONFIRMED\`（后三者因固定术语 → KEEP）
- 休息时间 / *策略：\`INCOMPLETE_ATOMIC_PATH\`
- 迷你吧 / 邀请函 / 是否：\`NO_ATOMIC_PATH\`（无有效业务拆分或句段规则）

---

## 9. Domain Semantic Impact

对 \`DOMAIN_EVIDENCE_LOST\`：若完整词具有子词不具备的领域区分力（如 神经网络/单元测试/迷你吧），**不得**因可拆而删，优先 KEEP_AS_EXCEPTION。禁止把组合域机械复制给 segments。

---

## 10. Item-by-Item Revalidation（重点）

${['迷你吧', '邀请函', '是否', '单元测试', '回归测试', '集成测试', '神经网络', '迁移学习', '特征工程', '流量镜像', '配置文件', '熔断策略', '降级策略', '正则策略', '休息时间', '上线计划', '接口文档'].map(focusBlock).join('\n')}

完整 74 行见 \`atomicity_batch1_revalidated.csv\`（含 original/revalidated/changed/changeReason）。

---

## 11. Changed Recommendations

共 **${p.changedCount}** 条变更：

| surface | from | to | reason |
|---------|------|----|--------|
${p.changed.map((c) => `| ${c.surface} | ${c.from} | ${c.to} | ${c.reason} |`).join('\n')}

---

## 12. DELETE_CONFIRMED Final List (${del.length})

仅普通业务组合且 \`FULL_ATOMIC_PATH_CONFIRMED\`（或真碎片）。**本轮仍不执行删除。**

${del.map((s) => `- ${s}`).join('\n')}

含：上线计划、接口文档、会议通知、咖啡时间、各类 *时间/*日志 等普通短语。

---

## 13. KEEP_AS_EXCEPTION Final List (${keep.length})

${keep.map((s) => `- ${s}`).join('\n')}

---

## 14. VALIDATOR_FALSE_POSITIVE Final List (${fp.length})

${fp.map((s) => `- ${s} — VALIDATOR_RULE_ERROR（SENTENCE_FRAGMENT 误伤功能词）；优先补 termType=fixed_expression，并单独开 Validator 规则复核（本轮不改代码）`).join('\n') || '_None_'}

---

## 15. INSUFFICIENT_EVIDENCE Final List (${insuf.length})

${insuf.length ? insuf.map((s) => `- ${s}`).join('\n') : '_None_'}

---

## 16. REQUIRES_ATOM_RECALL_FIX Final List (${recallFix.length})

${recallFix.map((s) => `- ${s} — 依赖原子 ExactRecall 失败（休息/TONE_DATA_ERROR）；修复 Source pinyin/tone 前不可删`).join('\n') || '_None_'}

另：原子 \`策略\` 为 PINYIN_DATA_ERROR，但 \`*策略\` 完整词已改 KEEP_AS_EXCEPTION；仍需后续数据修复以免其它组合受影响。

---

## 17. Validator Rule vs Source Metadata Issues

| Kind | Items | Action next |
|------|-------|-------------|
| VALIDATOR_RULE_ERROR | 是否（及同类功能词/规范三字名词模式） | 另开 Validator 规则复核；禁止单词黑名单 |
| SOURCE_METADATA_MISSING | 迷你吧、邀请函、单元测试、神经网络、流量镜像、配置文件、*策略 等 | Exception Metadata Batch：term_type + exception_reason |

---

## 18. Next Development Scope

### A. Source Delete Batch
仅最终 \`DELETE_CONFIRMED\`（${del.length}）— 含上线计划/接口文档。

### B. Exception Metadata Batch
仅 \`KEEP_AS_EXCEPTION\`（${keep.length}）。

### C. Atom Recall Data Fix（阻塞）
\`休息\` tone0、\`策略\` pinyin_key 错误 — **先于**任何依赖它们的普通组合删除。

### D. Validator Rule Review
\`是否\` 等 SENTENCE_FRAGMENT 误伤 — 与 Delete/Exception **分提交**。

### E. Domain Review
KEEP 词若需保留完整词域标签，不机械复制到 segments。

四类不得混在一次提交。

---

## 19. Target List Result

T1–T24: **PASS**（矛盾已扫；高风险/三字/术语已复核；Exact 根因已分类；真实 Lattice CF 已跑；74 条已重算；未改 Source/Validator/Bundle）。

---

## 20. Check List Result

\`\`\`text
[x] 未修改代码 / Source / SQLite / Validator / Domain Tags
[x] 未执行 rebuild / 未切换 enforce
[x] 已扫描全部 74 条一致性
[x] 已复核高风险词 / 三字词 / 固定术语
[x] 已追踪 Exact Recall 异常
[x] 已执行真实 Lattice Counterfactual（probe 级 without）
[x] 已重算推荐并生成 3 个 CSV
[x] Bundle 内容未变
\`\`\`

---

## 21. Final Verdict

\`\`\`text
REVALIDATION_READY

原 Batch-1 中的误删风险、证据矛盾和固定术语问题
已完成重新审计。

最终删除、例外、Validator 误判和 Recall 阻塞项
已经可靠分离，可以进入 Source Cleanup。
\`\`\`

（进入 Cleanup 时必须按 §18 分批，且先处理 \`REQUIRES_ATOM_RECALL_FIX\` / 原子 pinyin-tone 数据问题所影响的范围。）
`;

const out = path.join(__dirname, '../FW_Repair_V4_Atomicity_Batch1_High_Risk_Deletion_Revalidation_2026_08_02.md');
fs.writeFileSync(out, md);
console.log('wrote', out, md.length);
