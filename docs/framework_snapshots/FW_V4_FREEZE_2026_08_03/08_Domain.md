# 08 — Domain Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

---

## Domain Tag SSOT

```text
term_domain_tags
```

- Multi-row multi-domain tags allowed  
- **base_term** = no domain tags (does not vote)  
- Forbidden as SSOT: domain alias config · one-term-one-domain forced model · runtime persisted inferred tag · compound→segment copy  

## Presence Vote

```text
仅 domain_term / passive_domain_weak 投票
base_term 不投票
每个 FineSpan 对同一 domain 最多 +1
retainedDomains 使用冻结 ratio
```

## SameDomain Bucket

Path-scoped SameDomain assembly per Runtime SSOT V1.2 — KenLM does not decide domain.

## Context Prior Boundary

Context prior remains diagnostics / prior-input boundary per Runtime SSOT — not Domain Tag SSOT.
