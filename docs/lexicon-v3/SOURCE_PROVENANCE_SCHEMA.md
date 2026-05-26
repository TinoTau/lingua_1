# Source Provenance Schema

Canonical seed rows should include:

```json
{
  "type": "canonical_term",
  "word": "GPU",
  "domains": ["tech_ai"],
  "priorScore": 0.92,
  "aliases": ["显卡处理器"],
  "enabled": true,
  "source": "tech_ai_seed_v1",
  "license": "internal_or_open",
  "importBatch": "2026-05-27",
  "normalizedBy": "prepare-5k-seed",
  "reviewStatus": "approved"
}
```

## Validation

| Field | Required (always) | Required (strict) |
|-------|-------------------|-------------------|
| `word` | yes | yes |
| `domains` | yes | yes |
| `priorScore` | yes | yes |
| `source` | yes | yes |
| `license` | no | yes |
| `importBatch` | no | yes |
| `normalizedBy` | no | yes |
| `reviewStatus` | no | yes (`approved` \| `pending` \| `rejected`) |

CLI: `npm run lexicon:source-manager` (uses `validate-seed --strict` + provenance report)
