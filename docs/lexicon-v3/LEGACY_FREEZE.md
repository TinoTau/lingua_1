# Legacy Freeze Policy

```
Status: Superseded by Lexicon V3
Production Use: Forbidden
Allowed Use: historical reference / debug-only archives
```

## Superseded concepts

| Legacy | V3 policy |
|--------|-----------|
| `confusion_evidence` WindowCandidate | Removed — must not return |
| `lexicon_confusions` table | Removed from V3 bundle build |
| `confusionRecallEnabled` | Removed from node config |
| `confusion_count` manifest field | Rejected by active gates |
| Phase4 confusion seed packages | Archive only — do not import |

## Archive locations (do not use in production build)

- `electron_node/docs/lexicon-assets/` 下已移除 confusion 相关 seed 包（仅保留 canonical 资产包）

## V2 documents

Lexicon V2 Intent / Session Affinity remain valid for their scope but **must not** re-introduce confusion recall into production lexicon paths.
