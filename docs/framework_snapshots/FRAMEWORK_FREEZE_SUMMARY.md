# Framework Freeze Summary（入口）

| Snapshot | Status |
|----------|--------|
| **FW_V4_FREEZE_2026_08_03** | **CURRENT RECOVERY BASELINE** |

**权威包：** [`FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](./FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md)

| Field | Value |
|-------|-------|
| Scope | ASR Post-Processing → KenLM Runtime Boundary |
| Next Stage | KenLM Capability Validation |
| Nature | Date-based recoverable checkpoint |

后续 KenLM / Lexicon Expansion / Context Prior / LLM 开发失败时，按该 Snapshot 的 Recovery Guide 恢复。

Snapshot **不取代** Lattice Architecture / Runtime SSOT 等 Sole Authority；只绑定当前代码 + 文档 + 验收结果为恢复节点。

### Documentation Hierarchy

```text
docs/INDEX.md → Documentation Governance → Framework Snapshot
  → docs/current/ → docs/supporting/ → docs/acceptance/ → docs/archive/
```

| 层级 | 路径 |
|------|------|
| Unified Entry | [`../INDEX.md`](../INDEX.md) |
| Documentation Governance | [`../current/DOCUMENTATION_GOVERNANCE.md`](../current/DOCUMENTATION_GOVERNANCE.md) |
| CURRENT | [`../current/INDEX.md`](../current/INDEX.md) |
| Supporting | [`../supporting/INDEX.md`](../supporting/INDEX.md) |
| Acceptance | [`../acceptance/README.md`](../acceptance/README.md) |
| Architecture (ADR) | [`../architecture/INDEX.md`](../architecture/INDEX.md) |
| Archive | [`../archive/INDEX.md`](../archive/INDEX.md) |
| Runtime Index | [`../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md) |
