# Lingua Runtime Evolution Rule

**Document Type:** Permanent Architecture Constraint  
**Status:** Frozen · Effective 2026-07-15 · Lattice Architecture cite **2026-07-26**  
**Scope:** FW Repair V4 Runtime · Diagnostics · Metrics Consumer · Reports  
**Authority：** 与 [ARCHITECTURE.md](../fw-detector/ARCHITECTURE.md) · [freeze/FROZEN.md](../fw-detector/freeze/FROZEN.md) · [INTERFACE_FREEZE.md](../fw-detector/INTERFACE_FREEZE.md) · [diagnostics/FROZEN.md](../fw-detector/diagnostics/FROZEN.md) · [Lattice Architecture V1.0.0](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) 同级；**不得绕过**。

**Lattice Fine Span / Path / Trace 字段：** 新增 pathId、boundaryKey、prunedPath* 等必须先写入 Lattice Architecture / INTERFACE_FREEZE / diagnostics，再进 Mapping Catalog，禁止 Metrics 捷径消费。

**Companion（既有约束，本文件为其演进专章）：**

| 文档 | 关系 |
|------|------|
| [Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md](./Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md) | Metrics 消费边界（AC-1 · DC-1 · Mapping Contract） |
| [Lingua_Metrics_Layer_SSOT_Mapping.md](./Lingua_Metrics_Layer_SSOT_Mapping.md) | **Mapping Catalog（字段登记 SSOT）** |
| [Lingua_Repair_Framework_Final_Freeze_Verification.md](./Lingua_Repair_Framework_Final_Freeze_Verification.md) | 冻结验收与 Catalog 门禁 |

---

## 0. 审计结论（建立本文件前）

| 问题 | 结论 |
|------|------|
| 是否已有**独立、永久**的 Runtime Evolution Rule？ | **否** — 规则分散于 AC-1 · Mapping Catalog · INTERFACE_FREEZE §8 · Diagnostics H3 |
| 是否已有**统一演进管线**（Runtime → Freeze → Catalog → Metrics → Report）？ | **部分** — 管线在 Metrics 轮次已实践，但未固化为全项目永久约束 |
| 本轮是否修改 Runtime / Metrics / Repair？ | **否** — 仅补充 Constraint 文档与交叉引用 |

**裁决：** 建立本文档为 **Permanent Architecture Constraint**；既有分散条款 **KEEP**，由本文 **统合并补强**。

---

## 1. 唯一合法演进管线（Mandatory Pipeline）

任何 Runtime **新增或改义**字段（含 Diagnostics / Trace），必须且只能按下列顺序演进：

```text
Runtime Field（实现 + 类型）
        ↓
Runtime Freeze（INTERFACE_FREEZE · diagnostics/FROZEN · freeze-contract）
        ↓
Mapping Catalog（Lingua_Metrics_Layer_SSOT_Mapping.md 登记）
        ↓
Metrics Mapping（analyze-metrics-ssot.mjs 显式读取）
        ↓
Consumer Report（Funnel / E2E / 审计脚本 — 非 Architecture）
```

### 1.1 永久禁止的捷径

```text
Runtime ──→ Metrics（自动消费）     ❌ 禁止
Runtime ──→ Report（直接读取）      ❌ 禁止
Metrics ──→ Repair Pipeline         ❌ 禁止
Report  ──→ 新业务 Stage / Ownership ❌ 禁止
```

**说明：** Runtime 可先存在**未登记**字段供本地调试；但在 Catalog 登记前，Metrics 与 Report **必须忽略**，不得推断、不得聚合、不得命名新 Stage。

---

## 2. Runtime Evolution Constraints

### RE-1 · Runtime Field Gate（Freeze 先于消费）

| MUST | MUST NOT |
|------|----------|
| 新字段先写入 Runtime 类型与 Diagnostics 合约 | 未 Freeze 的字段被 Metrics 当作 SSOT |
| 改义已有字段须 bump Freeze 版本并更新 `freeze-contract.test.ts` | 静默兼容、双义字段、别名投影 |

**INTERFACE_FREEZE 分级（KEEP）：**

1. 框架接口语义变更 → 新合约版本 + 测试 + 文档 bump  
2. 仅 diagnostics **追加** optional 字段 → V1.0.2 patch，向后兼容  
3. 词库字段 → LEXICON_OPERATIONS，**不** bump 框架版本  

Diagnostics 类型同步（KEEP）：`v4-types.ts` · `types.ts` · `fw-detector-v4-path.ts` · mappers/trace。

---

### RE-2 · Mapping Registration Constraint

所有拟被 Metrics / Report **读取**的 Runtime 字段，**必须先**登记 [Mapping Catalog](./Lingua_Metrics_Layer_SSOT_Mapping.md)。

| 登记项（每字段一行） | 必填 |
|---------------------|:----:|
| Metrics Field 名 | ✓ |
| Runtime Source 路径 | ✓ |
| Mapping Rule | ✓ |
| Diagnostic Level（summary / trace） | ✓ |
| Consumer（report / overlay only） | ✓ |

**未登记 → Metrics 必须忽略。** 禁止 `Object.keys` 扫描、禁止反射式「发现新字段即出指标」。

**示例（未来字段 — 登记前一律 Unavailable）：**

| 假设 Runtime 字段 | 未登记时 Metrics 行为 |
|-------------------|----------------------|
| `candidateWeight` | **忽略** |
| `assemblyScore` | **忽略** |
| `domainConfidence` | **忽略** |
| `lookupLatency` | **忽略** |
| `newTrace` / `futureDiagnostics` | **忽略**（Trace 仍属 Diagnostics） |

---

### RE-3 · Runtime Compatibility Constraint

新增字段 **不得**改变已有字段的语义、单位、或决策含义。

| 允许 | 禁止 |
|------|------|
| 追加 optional trace 块 | 删除或改义 Gate 字段（如 `maxDelta` · `pickedIsRaw` · `minDeltaToReplace`） |
| 新块与旧块并存 | 用新字段「覆盖解释」旧字段 |
| 必须改义时 → 重新 Freeze + bump | 静默兼容、版本混读 |

---

### RE-4 · Metrics Evolution Constraint

Metrics **不得**主动搜索 Runtime 新字段。

| MUST | MUST NOT |
|------|----------|
| 仅消费 Catalog 已登记字段 | 遍历 diagnostics 造指标 |
| 缺字段 → `Unavailable` | 缺字段 → 推断 `Failure` |
| Overlay 显式标 `Overlay Metric` | 把 fixture 推导值写成 Runtime 字段 |

与 [IC-3 No New Runtime Fields](./Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md#ic-3-no-new-runtime-fields) 一致：Metrics 不引入人造 Runtime 字段。

---

### RE-5 · Report Evolution Constraint

Report（Funnel · E2E 摘要 · 审计 Markdown）**不得**直接绑定 Runtime 路径。

| MUST | MUST NOT |
|------|----------|
| 只读 Metrics 映射输出或标注 Unavailable | `spanAssemblyV4Diagnostics.*` 直读当 Architecture |
| 声明 Consumer / Deprecated | Success Funnel 当第二套 SSOT |

---

### RE-6 · Ownership Evolution Constraint

新增字段 **不得**改变 [Module Ownership](../fw-detector/ARCHITECTURE.md#3-module-ownership)。

| 规则 | 说明 |
|------|------|
| Ownership 仅来自 Runtime 既有 Stage | Recall · Ranking · Assembly · KenLM · Apply 等 |
| 新 diagnostics 字段不得创造新 Stage | 禁止 Metrics 层 `kenlmLayer` A/B/C/D 当业务阶段 |
| Trace 块归属 Diagnostics | 不得因新 trace 改变 pick / apply 责任 |

---

### RE-7 · Trace Evolution Constraint

新增 Trace **不得**成为 Production Decision。

| Trace 允许 | Trace 禁止 |
|------------|------------|
| 可观测 · 审计 · 离线分析 | 进入 KenLM pick · Apply Gate · Domain Select |
| `diagnosticsLevel=trace` 控制成本 | 默认 trace 改变主链行为 |
| Shadow / Beam 仅 diagnostics | Beam → KenLM / Apply（已永久禁止） |

---

### RE-8 · SSOT Evolution Constraint

新增 Metrics **不得**形成第二套 Stage，**不得**重新解释 Repair Pipeline。

```text
Runtime Diagnostics（唯一 SSOT）
        ↓
Metrics Mapping（被动映射）
        ↓
Consumer Report（展示层）
```

禁止：Dual SSOT · Runtime Projection · 报告内重写主链顺序。

---

## 3. Architecture Compliance（新字段自检）

未来每次 Runtime 字段演进，须确认仍满足：

| 原则 | 要求 |
|------|------|
| **No Shadow Logic** | 新字段不进主链决策；Shadow 仍仅 diagnostics |
| **No Compatibility Logic** | 不为新字段加静默兼容分支改变 pick |
| **No Hidden Gate** | 新分数/权重不得替代 `minDeltaToReplace` · Apply Gate |
| **No Projection** | Metrics 不投影出 Runtime 未输出的「决策」 |
| **No Runtime Drift** | 类型 · INTERFACE_FREEZE · FROZEN 同步更新 |
| **No Dual SSOT** | Catalog 外字段不算 Metrics 真相 |

---

## 4. Regression Constraint（行为不变）

未来 Runtime **仅追加** diagnostics 字段时，**不得**改变下列模块的 **生产行为**：

| 模块 | 约束 |
|------|------|
| FW | 触发与 span 边界不变 |
| Tone | timestamp-only · Recall 惩罚不变 |
| Recall | TopK · domainBoost=0 不变 |
| Domain Vote / Filter / Select | 投票与选择逻辑不变 |
| Sentence Assembly | 句组合与 compatibility 不变 |
| KenLM | batch · raw_log_delta · Gate 3.0 不变 |

**允许：** 仅增加 Diagnostics / Trace / 离线 Report 能力。  
**禁止：** 新字段反向驱动 Runtime 行为（Metrics → Pipeline）。

---

## 5. Acceptance Checklist（字段演进验收）

新增或改义字段合并前，须全部 **PASS**：

| # | 检查项 |
|---|--------|
| 1 | Runtime 类型与 `freeze-contract.test.ts` 已更新 |
| 2 | INTERFACE_FREEZE / diagnostics FROZEN 已登记 |
| 3 | Mapping Catalog 已新增行（含 Level · Consumer） |
| 4 | `analyze-metrics-ssot.mjs` 显式映射（无自动扫描） |
| 5 | Report 仅消费映射结果；缺登记 → Unavailable |
| 6 | Ownership / Stage 表无新增业务阶段 |
| 7 | Trace 字段未接入 Production Decision |
| 8 | E2E trace 跑批证明 **Runtime Business Logic Diff = 0**（仅 diagnostics 差异） |

---

## 6. KEEP / MODIFY / RESTORE / DELETE

| 对象 | 裁决 | 说明 |
|------|:----:|------|
| Runtime 主链（FW · Tone · Recall · Assembly · KenLM） | **KEEP** | 冻结；本轮不改 |
| Metrics Consumer（Read→Map→Report） | **KEEP** | 2026-07-14 对齐成果保留 |
| Mapping Catalog | **KEEP** | 登记 SSOT；新字段入口 |
| Constraint Addendum AC-1 · DC-1 · Mapping Contract | **KEEP** | 由本文统合引用 |
| INTERFACE_FREEZE §8 变更流程 | **KEEP** | 并入 RE-1 |
| Diagnostics H3 类型同步 | **KEEP** | 并入 RE-1 |
| 分散的「Catalog 须登记」表述 | **KEEP** | 不删除；本文为上位约束 |
| **独立 Runtime Evolution Rule 文档** | **MODIFY** | **本轮新建本文** |
| ARCHITECTURE · FROZEN · Mapping 交叉引用 | **MODIFY** | 指向本文 |
| 绕过 Catalog 的 Metrics 自动消费 | **DELETE**（禁止） | 永久禁止，非删代码 |
| 第二套 Stage / SSOT 报告 | **DELETE**（禁止） | Success Funnel 已降级 Consumer |
| 回滚 Metrics SSOT 对齐 | **RESTORE** | **不需要** |
| 回滚 Repair Framework Freeze | **RESTORE** | **不需要** |

---

## 7. 引用义务（Binding）

自 2026-07-15 起，凡涉及下列任一活动的文档 / PR / 审计，**必须引用本文**：

- Runtime Diagnostics 新增或改义字段  
- Metrics / Funnel / E2E 脚本新增指标  
- Freeze bump 或 INTERFACE 变更  
- 新 Trace 块或 diagnostics level 扩展  

**不得**在子文档中重新定义 Runtime 语义或 Metrics 管线。子文档仅可 **细化** 本文已列步骤，不可 **缩短** 或 **绕过** 管线。

---

*Lingua Runtime Evolution Rule · Permanent Architecture Constraint · 2026-07-15*
