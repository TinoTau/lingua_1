# V1 Canonical Acceptance Gate

> **Scope:** `node_runtime/lexicon/current`（Legacy Recover 路径）。  
> **FW v3 runtime gate：** `npm run lexicon:gate:v3-runtime`

## D1 Runtime

- Production runtime canonical-only (`V3_WINDOW_CANDIDATE_SOURCES`)
- No `confusionRecallEnabled` in config
- Runtime SQLite readonly
- Replay does not auto-merge bundle
- `confusion_evidence_total === 0` in benchmark runs

## D2 Build

- validation fail blocks build
- unknown domain fail
- alias collision fail
- priorScore ∈ (0, 1]
- manifest checksum required (phase5 gates)
- confusion rows rejected
- strict provenance: `lexicon:source-manager --strict`

## D3 Benchmark

- `npm run lexicon:phase5-benchmark`
- false / no-op repair measurable

## Verify

```powershell
cd electron_node/electron-node
npm run test:lexicon
npm run lexicon:v3-gate
npm run lexicon:phase5-benchmark
```

## SQLite 注意

| 对象 | 说明 |
|------|------|
| **better-sqlite3 ABI** | `lexicon:rebuild-sqlite` / Electron rebuild |
| **V1 bundle** `current/lexicon.sqlite` | seed 变更时需 `lexicon:build`；旧表 `lexicon_confusions` runtime 不读 |

FW 主链使用 `node_runtime/lexicon/v3` — 见 [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)。
