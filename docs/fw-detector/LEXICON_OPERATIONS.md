# FW Repair V4 — Lexicon Operations

**状态：** Framework Frozen · Lexicon Continues · 2026-06-19  
**原则：** 质量迭代通过 **词库运营** 完成，**不**修改 FW 主链代码

---

## 1. 质量基线（Dialog200 · Gate 3.0）

| 指标 | 值 | 说明 |
|------|-----|------|
| Improved | 30 | sentence pick 改善 CER |
| Degraded | 5 | 全部同音错选（transport 为主） |
| Net CER | +25 | |
| Unchanged CER>0 | 137 | ~95% 因 rawDelta 未过 Gate 3.0 |
| 瓶颈排序 | Candidate Quality → Domain Coverage → Lexicon Coverage | 非 Recall/KenLM/Apply |

**裁决：** 下一阶段主杠杆 = **领域 deploy + repairTarget + 同音 target 消歧**

---

## 2. Lexicon-Only Workflow

```text
Patch / Edit Seed → Import → Build Bundle → Rebuild SQLite → Gate → Reload → Dialog200 Diff → Freeze Batch
```

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run lexicon:patch-merge          # 或 import
npm run lexicon:prepare:v3-runtime
npm run lexicon:rebuild-sqlite
npm run lexicon:gate:v3-runtime
npm run lexicon:patch:apply            # reload
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 30
```

脚本 SSOT：`electron_node/electron-node/scripts/lexicon/README.md` · Patch：`main/src/lexicon-patch-v3/`

---

## 3. Improved / Degraded 摘要

### Top Improved Terms

| 词 | 次数 | 来源 |
|----|------|------|
| 我们 | 5 | base 繁简 |
| 中杯 / 医生 / 回归 | 各 3 | domain + base |
| 拿铁 / 蓝莓马芬 | 各 2 | 咖啡 seed |

主力：**已 deploy 的 coffee/tech domain seed** + 医疗/通用词；路径 `lexicon_pinyin_topk` sentence pick。

### Degraded（5 例 · 100% Candidate Quality）

| case | 场景 | 典型错选 | 应有 target |
|------|------|----------|-------------|
| d054 | taxi | 走散、再度、独步 | 西溪、堵不堵、三环 |
| d097 | taxi | 要是重复 | 四环、堵车 |
| d141 | meeting | 评审评审 | 一下 |
| d143 | taxi | 客机、试点 | 科技园、十点 |
| d189 | taxi | 变现、再度 | 望京SOHO、堵不堵 |

### Bad Candidate（词库层优先治理）

| 词 | 问题 |
|----|------|
| 烧饼 | 少冰同音（d003 Improved 但语义错） |
| 以下 | 一下同音 |
| 国民 | 过敏同音 |
| 再度 / 独步 / 试点 | transport 同音 |

---

## 4. 领域覆盖

| 领域 | cases | Improved% | Degraded% | 缺词方向 |
|------|-------|-----------|-----------|----------|
| coffee_tea | 15 | 33% | 0% | 少冰、贝果（pilot 有未 deploy） |
| transport | 15 | 13% | **27%** | 西溪、SOHO、堵不堵、环线 |
| tech_ai | 41 | 22% | 2% | 后选生城、上线计划 |
| travel | 12 | 0% | 0% | 地名/口语 |
| general | 66 | 15% | 0% | — |

**最缺领域：** transport > travel > tech 整词 > 咖啡规格 deploy

---

## 5. 扩充优先级

### P0（必须）

少冰 · 西溪 · SOHO · 堵不堵 · 三环/四环 · 中关村软件园 · 南山科技园 · 后选生城 · 上线计划 · 贝果 · 十点十分

### P1（推荐）

燕麦拿铁 · 冰美式 · 少糖 · 联调 · 血常规 · 订单中台 · 顺便问一下 · 一壶茶 · 不走

### P2（长期）

旅游/酒店口语 · 品牌产品名 · 数字时间组合

---

## 6. Allowed / Forbidden

### Allowed

base / domain / idiom lexicon · repairTarget · confusion seed · domain mapping · minPrior · enabledDomains · Patch Service

### Forbidden（Framework Frozen）

Recall · Tone · Assembly · KenLM · Raw Delta Gate · Apply · 新增 Gate/Filter

---

## 7. Reload 与检查清单

- Patch 后：`forceReloadLexiconRuntimeV3()` → `lexicon_runtime_status: ok`
- 每批：gate PASS → Dialog200 diff（**保持 Gate 3.0**）→ manifest 冻结词库批次（**不** bump Framework 版本）

| 可运营 | 不可运营 |
|--------|----------|
| minPrior · enabledDomains · sqlite 行 | minDeltaToReplace · scoreMode · toneTimestampOnlyEnabled |

见 [CONFIG.md](./CONFIG.md)

---

## 8. 相关文档

- [../lexicon-v3/ARCHITECTURE.md](../lexicon-v3/ARCHITECTURE.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- 审计数据（只读）：`electron_node/electron-node/tests/experiments/lexicon-coverage-candidate-quality-audit-data.json`
