# Historical Archive — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | Archive hierarchy |
| Rule | **禁止删除**；仅追溯；不得作为 CURRENT |

---

## Categories

| Dir | Status | Meaning |
|-----|--------|---------|
| [`RETIRED/`](./RETIRED/) | RETIRED | 已废止路径（LTR / SoftBoundary / parent_fragment 等） |
| [`SUPERSEDED/`](./SUPERSEDED/) | SUPERSEDED | 被 CURRENT / Implementation Contract 取代的草案 |
| [`EXPERIMENT/`](./EXPERIMENT/) | EXPERIMENT | 实验记录 |
| [`HISTORICAL/`](./HISTORICAL/) | HISTORICAL | 旧 Audit / Plan / Inventory |

每份归档文首含 Metadata：`Status` · `Superseded By`。

旧路径 `docs/tone-v2/<name>.md` 保留 stub → 本目录。

入口：[`../current/INDEX.md`](../current/INDEX.md)
