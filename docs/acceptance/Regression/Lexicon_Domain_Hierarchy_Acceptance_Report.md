<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/Lexicon_Domain_Hierarchy_Acceptance_Report.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Lexicon Domain Hierarchy Acceptance Report

**Date:** 2026-07-19
**Type:** Independent Read-only Acceptance
**Verdict:** **ACCEPTANCE PASS**

本轮验收未修改数据库 / Bundle / Runtime / 配置。
Evidence: `d:\Programs\github\lingua_1\tmp\budget_expansion_20260715\hierarchy_acceptance.json`

---

## Final: ACCEPTANCE PASS

A1–A6 全部通过。

### A7 Known Debt（不构成 FAIL）

- Candidate domains[0] compression remains
- term.tier legacy column remains

---

## A1 Bundle

- bundleVersion: 10
- lastPatchId: lexicon-domain-hierarchy-completion-v1
- checksum match: True
- Runtime bundlePath: `node_runtime/lexicon/v3`

## A2 Hierarchy

- rows=12 coarse=5 children=12
- coarse: ['healthcare', 'restaurant', 'transportation', 'travel', 'workplace']
- duplicate pairs / multi-parent: 0 / 0

## A3 Coverage

- available fine=12
- fine not in hierarchy: ∅
- hierarchy fine not available: ∅

## A4 Data invariance counts

```json
{
  "term": 10061,
  "term_domain_tags": 1033,
  "domain_lexicon": 1033,
  "base_lexicon": 10061,
  "industry_routing_lexicon": 1033,
  "term_pinyin_ngrams": 4200,
  "idiom_lexicon": 22192
}
```

## A5 Materialization

- orphan=0 tags_missing=0 base_miss=0

## A6 Runtime readiness

- available coarse: ['healthcare', 'restaurant', 'transportation', 'travel', 'workplace']
- fine→coarse: all 12 fines have unique non-self parent

```json
{
  "restaurant": [
    "bakery",
    "coffee",
    "food_order",
    "milk_tea"
  ],
  "travel": [
    "tourism_hotel",
    "tourism_pickup",
    "tourism_route",
    "tourism_transport"
  ],
  "transportation": [
    "transport"
  ],
  "workplace": [
    "meeting",
    "tech_ai"
  ],
  "healthcare": [
    "medical"
  ]
}
```

```text
ACCEPTANCE PASS
```
