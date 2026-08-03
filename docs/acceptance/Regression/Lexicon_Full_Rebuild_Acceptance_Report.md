<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/Lexicon_Full_Rebuild_Acceptance_Report.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Lexicon Full Rebuild Acceptance Report

**Date:** 2026-07-18
**Type:** Read-only Acceptance
**Verdict:** **FAIL**

本轮未修改数据库 / Bundle / Runtime / 配置 / manifest / checksum。

Evidence JSON: `d:\Programs\github\lingua_1\tmp\budget_expansion_20260715\lexicon_full_rebuild_acceptance.json`

---

## Final Verdict: FAIL

### FAIL Reasons

1. C6: available fine domains not covered by hierarchy: `medical`, `meeting`, `tech_ai`, `transport`

**说明（只读观察，非修复）：**  
`domain_hierarchy` 在 Full Rebuild 中按令保留未改，当前仅覆盖 `travel/*` 与 `restaurant/*` 共 8 条边。上述 4 个 fine domain 在 `term_domain_tags` 中存在且可召回，但 **没有** parent 挂载。此缺口为验收标准 C6 未满足，**不是** tag/materialize 残留。

**C1–C5 / C8 数据面：通过**（term/tags 与 corrected+supp 一致；domain/base 全量重物化且无 orphan；checksum/bundleVersion/PatchId 对齐）。

**禁止自动修复。禁止继续开发。等待人工决定。**

### Warnings（不单独构成 FAIL）

- C7: Candidate still uses domains[0] compression (pre-existing Runtime debt; rebuild data OK, multi-domain Vote incomplete until Runtime contract work)
- C8: term.tier column exists (legacy field; not used as Domain SSOT)

---

## C1 Bundle

| Item | Value |
|------|-------|
| Runtime bundlePath | `node_runtime/lexicon/v3` |
| bundleVersion | 9 |
| lastPatchId | lexicon-full-rebuild-v1 |
| checksum.txt | `sha256:829a3e3f8af97168073574b0db5f47c215697fb001f0a63c53fd620b962f77d5` |
| sqlite sha256 | `sha256:829a3e3f8af97168073574b0db5f47c215697fb001f0a63c53fd620b962f77d5` |
| checksum match | True |

## C2 term

| Metric | Value |
|--------|------:|
| term | 10061 |
| expected (corrected keep + supp new) | 10061 |
| Base term (no tags) | 9105 |
| Domain term | 956 |
| multi-domain term | 54 |
| supplemental live | 73 |

## C3 term_domain_tags

| Metric | Value |
|--------|------:|
| tag rows | 1033 |
| expected pairs | 1033 |
| only-in-DB | 0 |
| only-in-sources | 0 |
| meeting | 61 |
| tech_ai | 142 |
| general | 0 |

Per-domain:

```json
{
  "tourism_transport": 67,
  "tech_ai": 142,
  "food_order": 88,
  "medical": 178,
  "tourism_hotel": 79,
  "tourism_route": 111,
  "milk_tea": 53,
  "meeting": 61,
  "coffee": 107,
  "tourism_pickup": 52,
  "bakery": 90,
  "transport": 5
}
```

## C4 domain_lexicon

- rows=1033 canonical=1033 orphan=0 tags_missing=0

## C5 base_lexicon

- rows=10061 term=10061 orphan_words=0 missing=0 legacy50k=False

## C6 Hierarchy

- coarse: ['restaurant', 'travel']
- fine in hierarchy: ['bakery', 'coffee', 'food_order', 'milk_tea', 'tourism_hotel', 'tourism_pickup', 'tourism_route', 'tourism_transport']
- available fine: ['bakery', 'coffee', 'food_order', 'medical', 'meeting', 'milk_tea', 'tech_ai', 'tourism_hotel', 'tourism_pickup', 'tourism_route', 'tourism_transport', 'transport']
- fine not in hierarchy: ['medical', 'meeting', 'tech_ai', 'transport']

## C7 Runtime readiness

- available fine domains: 12
- base/domain sample rows present: True/True
- recall domains[0] compression present: True

## C8 Contract

- SSOT: term + term_domain_tags
- domain_lexicon projection clean: True
- forbidden columns: (none)

---

```text
ACCEPTANCE FAIL
No auto-fix. No further development.
```
