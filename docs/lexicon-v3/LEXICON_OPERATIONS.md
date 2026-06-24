# Lexicon Operations — FW 质量运营

**状态：** Framework Frozen · Lexicon Continues · 2026-06-25  
**原则：** 质量迭代通过 **词库运营** 完成，**不**修改 FW 主链代码

---

## 1. 质量基线（Ranking V1.2 后）

| 指标 | 值 | 说明 |
|------|-----|------|
| Dialog200 | 200/200 PASS | 合约门禁 |
| avg CER final | ~0.214 | V1.2 批测 |
| fw_applied cases | ~63/200 | 句级 Δ≥3 |
| 烧饼退化 | **0** | Tone Guard + Ranking V1.2 |
| 瓶颈 | Candidate Quality → Domain Coverage → Lexicon | 非 Recall/KenLM 算法 |

---

## 2. Workflow

```text
Patch / JSONL → Import → Gate → Reload → Dialog200 Diff
```

```powershell
cd electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run lexicon:patch:import:electron -- patch.json --source-jsonl entries.jsonl
npm run lexicon:gate:v3-runtime
node tests/run-dialog200-timed-batch.mjs "...\test wav\dialog_200" --max-minutes 30
```

详见 [STORAGE_PIPELINE.md](./STORAGE_PIPELINE.md) · [PATCH_IMPORTER_V4.md](./PATCH_IMPORTER_V4.md) · [LEXICON_EXPANSION_PACKAGE.md](./LEXICON_EXPANSION_PACKAGE.md)

---

## 3. 领域覆盖缺口

| 领域 | 缺词方向 |
|------|----------|
| transport | 西溪、SOHO、堵不堵、环线 |
| tech_ai | 候选生成、上线计划整词 |
| coffee | 燕麦拿铁、贝果 deploy |
| travel | 地名/口语 |

**P0 扩充：** 少冰 · 西溪 · SOHO · 堵不堵 · 三环/四环 · 后选生城 · 上线计划

---

## 4. Degraded 典型（词库层）

| case | 场景 | 应有 target |
|------|------|-------------|
| d054/d143/d189 | taxi | 西溪、科技园、望京SOHO |
| d141 | meeting | 一下 |

---

## 5. Allowed / Forbidden

| Allowed | Forbidden |
|---------|-----------|
| Patch · seed · repairTarget · enabledDomains | Recall · Assembly · KenLM · Apply Gate 算法 |
| minPrior 运营 | minDeltaToReplace · scoreMode |

FW 配置分界：[../fw-detector/CONFIG.md](../fw-detector/CONFIG.md)

---

## 6. Reload 检查清单

- Patch 后 `forceReloadLexiconRuntimeV3()` · `lexicon_runtime_status: ok`
- 每批：gate PASS → Dialog200（**Gate 3.0 不变**）→ manifest 冻结词库批次

---

*Lexicon V3 模块 · 非 FW 算法文档*
