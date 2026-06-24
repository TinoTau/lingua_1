# Lexicon Expansion Package V1

**状态：** 运营输入 · Framework Frozen 下仅扩词库  
**约束：** 不得修改 DSU / Vote / Recall Scope / Context Prior / FW 主链  
**交付：** [STORAGE_PIPELINE.md](./STORAGE_PIPELINE.md) · [PATCH_IMPORTER_V4.md](./PATCH_IMPORTER_V4.md)

> **Alias 规则：** homophone 变体须走 **Pinyin/Tone Recall**（JSONL 独立 word 行或 recall 路径），**禁止** ASR 同音 alias。见 [ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md](./ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md)。

---

## Package Summary

| 类别 | P1 | P2 | 说明 |
|------|----|----|------|
| 行业词（canonical） | 18 | 4 | tech_ai + tourism + coffee |
| 口语词 | 4 | 2 | common_oral / base |
| 单字 / 成语 | 0 | 0 | 本轮不做 |
| **合计 canonical** | **22** | **6** | — |

---

## P1 — High Value

### Tech

| Canonical | Domain | 交付 |
|-----------|--------|------|
| 候选生成 | tech_ai | domain_patch + homophone JSONL 行 |
| 上线计划 | tech_ai | 同上 |
| 接口文档 | tech_ai | 同上 |
| 联调 | tech_ai | base / domain |

### Tourism / taxi

中关村 · 望京 · 望京SOHO · 机场高速 · 四环 · 三环 · 浦东 · 张江 · 杭州西溪 → `tourism_transport` domain_patch

### Coffee

燕麦拿铁 · 热巧克力 → `coffee` domain_patch

### Oral

问一下 · 可以吗 · 赶时间 → `common_oral`

### Homophone（JSONL 变体行 · 非 alias）

像蔡→香菜 · 钟贝→中杯 · 蓝美马分→蓝莓马芬 · 少病→少冰 等 — **Recall 路径**，见 [ILLEGAL_ALIAS_CLEANUP.md](./ILLEGAL_ALIAS_CLEANUP.md)

---

## P2 — Medium

挂号处 · 四十码 · 酒店订单 · 少冰/大杯/小杯 · 预订

---

## P3 — Low（可选）

别提 · 旅游酒店 · 贝果/曲奇/芝士蛋糕

---

## Build 要求

### Patch-First（默认）

1. 编辑 JSONL SSOT — **dual-write**
2. `LexiconPatchV3`（`domainTags` 来自 `profile-registry.json`）
3. `npm run build:main`
4. `npm run lexicon:patch:import:electron -- patch.json --source-jsonl ...`
5. `npm run lexicon:gate:v3-runtime`

### Full Build

新 domain_id · 大批量 hierarchy → `validate → build:v2-shadow → prepare:v3-runtime --force → gate`

---

## 脚本与资产

| 资产 | 路径 |
|------|------|
| Expansion v1.1 | `electron_node/electron-node/scripts/lexicon/expansion-v1_1/` |
| Multidomain JSONL | `electron_node/docs/lexicon-assets/.../domain_patch_multidomain_v1/` |
| profile-registry | `electron_node/docs/lexicon-assets/profile-registry.json` |

---

*Lexicon Expansion Package V1 · Lexicon V3 · 2026-06-25*
