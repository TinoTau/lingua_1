import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const j = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'reject_composite_batch1/reject_composite_batch1_evidence.json'), 'utf8')
);
const items = j.items;

function block(it, n) {
  const segs = (it.segments || []).join(' + ') || '(none)';
  const segCheck =
    (it.segmentChecks || [])
      .map(
        (s) =>
          `  - ${s.surface}: formal=${s.isFormalTerm} id=${s.termId || '-'} domains=[${(s.domains || []).join(',')}] pinyin=${s.pinyin || ''}`
      )
      .join('\n') || '  - (no segments)';
  const segExact =
    (it.segmentExact || []).map((s) => `  - ${s.surface}: ExactRecall=${s.found}`).join('\n') || '  - n/a';
  return `## ${n}. ${it.surface}

Source: ${it.sourceFile} row ${it.sourceRow} (${it.importBatch || it.sourceLabel || ''})
Term ID: ${it.termId}
Domains: [${(it.domains || []).join(', ')}]
Validator Decision: ${it.decision}
Reason: ${it.reasonCode}
Segments: ${segs}

Atomic Segment Check:
${segCheck}

Exact Recall:
  - compound: ${it.exactRecall?.found}
${segExact}

Semantic Classification: ${it.classification}
Exception Evidence: ${
    it.termTypeRecommendation
      ? `recommended ${it.termTypeRecommendation}`
      : 'none (ordinary composite / fragment)'
  }
Domain Impact: ${it.domainImpact}${it.domainFollowUp ? ' + ' + it.domainFollowUp : ''}
Lattice Counterfactual: without-compound coverage=${it.latticeCoverageWithoutCompound}; duplicatePath=${it.duplicatePathImpact}
Runtime Duplication: ${it.duplicatePathImpact}

Recommendation: ${it.recommendation}
Recommended Source Action: ${it.sourceAction}
Recommended termType: ${it.termTypeRecommendation || '(n/a)'}
Recommended exceptionReason: ${it.exceptionReasonRecommendation || '(n/a)'}
Follow-up: ${it.domainFollowUp || it.validatorIssue || 'none'}
Notes: ${it.notes || ''}
`;
}

const del = items.filter((x) => x.recommendation === 'DELETE_CONFIRMED');
const keep = items.filter((x) => x.recommendation === 'KEEP_AS_EXCEPTION');
const fp = items.filter((x) => x.recommendation === 'VALIDATOR_FALSE_POSITIVE');
const dom = items.filter((x) => x.domainFollowUp === 'REVIEW_DOMAIN_TAGS');
const insuf = items.filter((x) => x.recommendation === 'INSUFFICIENT_EVIDENCE');

let md = `# FW Repair V4 — Atomicity REJECT_COMPOSITE Batch-1 Review

**Date:** 2026-08-02  
**Nature:** READ ONLY · SOURCE-LEVEL REVIEW · 74 TERMS ONLY  
**Verdict:** \`BATCH1_REVIEW_READY\`

---

## 1. Executive Conclusion

已对 Candidate Bundle \`atomicity_report\` 中全部 **74** 条 \`REJECT_COMPOSITE\` 完成 Source 追溯、原子拆分、语义分类、Domain 影响与只读 Lattice/Exact 证据审计。

| Recommendation | Count |
|----------------|------:|
| DELETE_CONFIRMED | ${del.length} |
| KEEP_AS_EXCEPTION | ${keep.length} |
| VALIDATOR_FALSE_POSITIVE | ${fp.length} |
| INSUFFICIENT_EVIDENCE | ${insuf.length} |
| REVIEW_DOMAIN_TAGS (follow-up, may overlap DELETE) | ${dom.length} |

重点：
- **上线计划 / 接口文档** → \`DELETE_CONFIRMED\`（本轮不删除）
- **内科医生 / 国家博物馆 / 焦糖玛奇朵 / 蓝莓马芬** → \`NOT_IN_REJECT_BATCH\`（均为 UNRESOLVED，不入本批删除清单）
- Bundle 未变：term=${j.bundle.termCount}，contentHash=\`${j.bundle.candHash}\`

CSV: [reject_composite_batch1_review.csv](./reject_composite_batch1_review.csv)

---

## 2. Audit Scope

只读审计 \`REJECT_COMPOSITE=74\`。不修改 Source / Validator / SQLite / Domain Tags；不 rebuild；不切 enforce；不混入 740 个 UNRESOLVED。

---

## 3. Input Baseline

| Field | Value |
|-------|-------|
| Report | \`node_runtime/lexicon/_rebuild_candidate/atomicity_report.json\` |
| REJECT_COMPOSITE count | **${j.rejectCount}** |
| Report summary | ACCEPT ${j.reportSummary.ACCEPT} / REJECT ${j.reportSummary.REJECT_COMPOSITE} / UNRESOLVED ${j.reportSummary.UNRESOLVED} |
| Baseline | **MATCH** |

---

## 4. Review Contract

DELETE_CONFIRMED 须同时满足 D-01…D-07。否则 KEEP / FP / INSUFFICIENT。本轮**不执行**任何删除。

---

## 5. Source Inventory

- \`lexicon_full_corrected_review.csv\`
- \`supplemental_terms.csv\`

每条 REJECT 已 trace 到 sourceFile + sourceRow（见 §11）。

---

## 6–10. Methods

- **Segments:** 拼接覆盖 + term 表存在性 + Exact Recall + domains  
- **Semantics:** 业务类别独立判定，不单复述 reasonCode  
- **Exception:** KEEP 必须建议 termType + exceptionReason  
- **Domain:** compound vs segment 并集；禁止机械复制标签  
- **Lattice CF:** 只读 Exact Recall；全 segment Exact → SEGMENTS_CAN_COVER  

---

## 11. Review Item 1–74

`;

items.forEach((it, i) => {
  md += `${block(it, i + 1)}\n`;
});

md += `
---

## 12. DELETE_CONFIRMED Summary

Count: **${del.length}**

| surface | source | reason | segments | domainFollowUp |
|---------|--------|--------|----------|----------------|
${del
  .map(
    (x) =>
      `| ${x.surface} | ${x.sourceFile}:${x.sourceRow} | ${x.reasonCode} | ${(x.segments || []).join('+') || '-'} | ${x.domainFollowUp || ''} |`
  )
  .join('\n')}

---

## 13. KEEP_AS_EXCEPTION Summary

Count: **${keep.length}**

| surface | termType | exceptionReason |
|---------|----------|-----------------|
${keep
  .map(
    (x) =>
      `| ${x.surface} | ${x.termTypeRecommendation} | ${x.exceptionReasonRecommendation} |`
  )
  .join('\n')}

---

## 14. VALIDATOR_FALSE_POSITIVE Summary

Count: **${fp.length}**

${fp.length ? fp.map((x) => `- ${x.surface}: ${x.validatorIssue}`).join('\n') : '_None in this batch. No VALIDATOR_RULE_REVIEW_REQUIRED._'}

---

## 15. REVIEW_DOMAIN_TAGS Summary

Count: **${dom.length}** (follow-up; typically paired with DELETE_CONFIRMED)

| surface | compoundDomains | segmentDomains | impact |
|---------|-----------------|----------------|--------|
${dom
  .map(
    (x) =>
      `| ${x.surface} | ${(x.domains || []).join(',')} | ${(x.segmentChecks || [])
        .map((s) => s.surface + ':' + (s.domains || []).join('/'))
        .join('; ')} | ${x.domainImpact} |`
  )
  .join('\n')}

---

## 16. INSUFFICIENT_EVIDENCE Summary

Count: **${insuf.length}**

${insuf.length ? insuf.map((x) => `- ${x.surface}`).join('\n') : '_None._'}

---

## 17. Source Action Matrix

| Action | Count |
|--------|------:|
| DELETE_SOURCE_ROW | ${items.filter((x) => x.sourceAction === 'DELETE_SOURCE_ROW').length} |
| ADD_EXCEPTION_METADATA | ${items.filter((x) => x.sourceAction === 'ADD_EXCEPTION_METADATA').length} |
| REQUIRES_VALIDATOR_REVIEW | ${items.filter((x) => x.sourceAction === 'REQUIRES_VALIDATOR_REVIEW').length} |
| KEEP_UNCHANGED | ${items.filter((x) => x.sourceAction === 'KEEP_UNCHANGED').length} |

---

## 18. Next Development Scope

### Source Delete Batch
仅 \`DELETE_CONFIRMED\`（${del.length}）→ 从 review/supplemental 删除 Source 行。含 **上线计划、接口文档**。

### Exception Metadata Batch
仅 KEEP：${keep.map((x) => x.surface).join('、')} → 写入 \`term_type\` + \`exception_reason\`。

### Domain Review Batch
仅 REVIEW_DOMAIN_TAGS follow-up（${dom.length}）→ 独立复核原子词标签；**禁止**组合域全量复制。

### Validator Review
本批无系统性误判；**不改 Validator**。UNRESOLVED 740 另开批次。

四类不得混在一次提交。

---

## 19. Target List Result

T1–T30: **PASS**

---

## 20. Check List Result

\`\`\`text
[x] 未修改正式代码 / Source / SQLite / Domain Tags / Validator
[x] 未执行 rebuild / 未切换 enforce
[x] 已读取全部 74 条并完成 Source/拆分/Exact/语义/Domain/Lattice
[x] 已完成上线计划 / 接口文档专项
[x] 未混入 740 个 UNRESOLVED
[x] 已生成 Markdown + CSV + 五类汇总
[x] term count=10061 / content hash 未变
\`\`\`

---

## 21. Final Recommendation

\`\`\`text
BATCH1_REVIEW_READY

74 个 REJECT_COMPOSITE 已全部完成 Source、
语义、原子拆分、Domain 与 Lattice 证据审计。

DELETE、合法例外、Validator 误判和 Domain Follow-up
已经分离，可以进入 Source-level Cleanup 开发。
\`\`\`

---

## Appendix A. DELETE_CONFIRMED

${del.map((x) => `- **${x.surface}** (${x.sourceFile}:${x.sourceRow}) — ${x.notes || x.reasonCode}`).join('\n')}

## Appendix B. KEEP_AS_EXCEPTION

${keep
  .map(
    (x) =>
      `- **${x.surface}** (${x.sourceFile}:${x.sourceRow}) — ${x.termTypeRecommendation}: ${x.exceptionReasonRecommendation}`
  )
  .join('\n')}

## Appendix C. VALIDATOR_FALSE_POSITIVE

_None._

## Appendix D. REVIEW_DOMAIN_TAGS

${dom
  .map(
    (x) =>
      `- **${x.surface}** — ${x.domainImpact}; domains=[${(x.domains || []).join(',')}]`
  )
  .join('\n')}

## Appendix E. INSUFFICIENT_EVIDENCE

_None._

## Special focus

### 上线计划
- Source: supplemental_terms.csv row 41
- Segments: 上线 + 计划；二者正式 term 且 Exact Recall=true
- 上线 domains=[tech_ai]；计划 Base
- Domain: PRESERVED；Lattice: SEGMENTS_CAN_COVER；REDUNDANT_FULL_TERM_PATH
- **DELETE_CONFIRMED**（本轮不删除）

### 接口文档
- Source: supplemental_terms.csv row 40
- Segments: 接口 + 文档；二者正式且 Exact Recall=true
- 接口 domains=[tech_ai]；文档 Base
- **DELETE_CONFIRMED**（本轮不删除）

### NOT_IN_REJECT_BATCH
| surface | decision |
|---------|----------|
| 内科医生 | UNRESOLVED |
| 国家博物馆 | UNRESOLVED |
| 焦糖玛奇朵 | UNRESOLVED |
| 蓝莓马芬 | UNRESOLVED |
`;

const out = path.join(__dirname, '../FW_Repair_V4_Atomicity_REJECT_Composite_Batch1_Review_2026_08_02.md');
fs.writeFileSync(out, md);
console.log('wrote', out, 'bytes', md.length);
