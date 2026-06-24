# Illegal Alias Cleanup — 运营指南

**状态：** 与 [ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md](./ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md) 配套  
**范围：** 仅数据清理 · **禁止**改 Recall / KenLM / Schema / FW 主链

---

## 1. 清理目标

移除全部非法 alias 与 homophone 变体独立行，使 ASR 错字恢复归 **Pinyin/Tone Recall + KenLM**。

| 违规类型 | 处理 |
|----------|------|
| `ASR_HOMOPHONE` / `ASR_NEAR_PHONE` | 从 manifest / patch 删除 |
| `TONE_CONFUSION` | 删除（如 少病→少冰 应走 Tone Recall） |
| `PINYIN_RECALL_OWNED` | 删除（如 后选→候选） |
| `TEST_ONLY_PATCH` | supersede 整 patch |
| homophone 变体独立 word 行 | 删除 JSONL 行 |

---

## 2. 典型非法 alias（须移除）

| canonical | 非法 alias | 正确恢复层 |
|-----------|------------|------------|
| 香菜 | 像蔡 | Pinyin Recall |
| 高速 | 告诉 | Pinyin Recall |
| 中杯 | 钟贝 | Tone Recall |
| 少冰 | 少病 | Tone Recall |
| 候选/生成/计划/接口 | 后选/生城/计化/借口 | Pinyin Recall |

**保留示例：** 計劃→计划（`TRAD_SIMPLIFIED`）· 预定→预订（`ENTITY_WRITING`）

---

## 3. Cleanup 工作流

```text
审计 manifest/JSONL → 生成 cleanup patch → patch-build-gate → apply → gate:v3-runtime → Dialog200 spot check
```

### 命令

```powershell
cd electron_node\electron-node
npm run lexicon:scan-alias-legality -- patches\your.patch.json
npm run lexicon:patch-build-gate -- patches\your.patch.json
npm run lexicon:patch:import:electron -- patches\exp-v1_1-alias-cleanup.patch.json --source-jsonl ...
npm run lexicon:gate:v3-runtime
```

### Patch 策略

- **不直接改**已 applied 历史 patch
- 新建 `*-alias-cleanup` patch：`update` 合法子集 · `disable`/`delete` 非法 `is_alias=1` 行
- bump bundle `nextVersion`

---

## 4. 资产路径

| 资产 | 路径 |
|------|------|
| Expansion manifest | `scripts/lexicon/expansion-v1_1/terms-manifest.cjs` |
| P1.5 alias patch | `scripts/lexicon/expansion-v1_1/patches/exp-v1_1-p1_5-alias.patch.json` |
| domain homophone JSONL | `electron_node/docs/lexicon-assets/.../entries.jsonl` |
| 扫描脚本 | `scripts/lexicon/scan-alias-legality.mjs` |

---

## 5. P0 边界

| 允许 | 禁止 |
|------|------|
| 编辑 manifest / JSONL / cleanup patch | SQLite DDL |
| `scan-alias-legality` 规则收紧 | Recall / KenLM / Assembly 算法 |
| disable runtime alias 行 | Domain Source / Context Prior |

---

## 6. 验证

```powershell
npm run lexicon:scan-alias-legality:test
npm run test:lexicon-patch-v4-e2e
```

FW 语义 spot：`node tests/run-fw-ranking-semantics-test.mjs`（d003 少冰 · 禁烧饼）

---

*Illegal Alias Cleanup · Lexicon V3*
