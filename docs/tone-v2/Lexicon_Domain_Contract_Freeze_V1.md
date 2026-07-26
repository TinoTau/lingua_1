# Lexicon Domain Contract — Freeze V1

**Status:** Frozen · **V1** · **2026-07-18**  
**Type:** Contract Freeze（文档冻结 · 本轮不改代码）  
**冲突优先级：** 本文（Lexicon Domain 分类与标签合同） **≥** 运营指南 / Checklist；与 [DOMAIN_SOURCE_UNIFICATION.md](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md)（DSU）并列：  
- **DSU** 管：可用域集 · Hierarchy · Recall Scope · LLM coarse  
- **本文** 管：词是否允许拥有 `term_domain_tags` · Base/Domain 语义 · 运营禁止项  

**上游依据：**  
`Lingua_Lexicon_Domain_Contract_Readonly_Audit_2026_07_18.md` ·  
`Lexicon_Classification_Standard_Audit_V2.md` ·  
`Lexicon_Cleanup_Phase1_*` · DSU Frozen  

**配套：** [Lexicon_Operation_Guide_V1.md](./Lexicon_Operation_Guide_V1.md) · [Lexicon_Maintenance_Checklist_V1.md](./Lexicon_Maintenance_Checklist_V1.md)

---

## 1. 冻结声明

自本文件起，下列原则为 **Lexicon Domain Contract V1**，未经书面解冻不得违反：

1. 所有词 **默认 Base**。  
2. 仅 **具有领域区分能力** 的词允许 `term_domain_tags`。  
3. `term_domain_tags` 是 **唯一 Domain 标签 SSOT**。  
4. Runtime 域模型为 **二元**：Base（空 tags） / Domain（有 tags）。  
5. **禁止** 第二套状态字段与「全领域 / general_tag」语义。  
6. **禁止** 自动批量生成 Domain Tag；**禁止** 按 tag 数量自动删 tag。

---

## 2. 核心定义

### 2.1 Base

| 项 | 合同 |
|----|------|
| 定义 | **无**领域区分能力（跨行业同等常用，或无法帮助区分 utterance 细域） |
| 数据 | 该 `term` 上 **`term_domain_tags` 行数 = 0** |
| Runtime | 可参与 **Base Recall** 与 **Sentence Assembly** |
| 禁止 | 参与 **Domain Vote** 累加；进入 **sameDomain / Domain Bucket**（无 `domainId` 或等价空域） |

判据是 **「是否有领域区分能力」**，**不是**「是否专业术语 / 是否生僻」。

### 2.2 Domain

| 项 | 合同 |
|----|------|
| 定义 | **有**领域区分能力（单独或与少量词合取即可偏向某一细域） |
| 数据 | 允许 1～N 条 `term_domain_tags`（运营上限见 Guide；硬上限建议 ≤5 active fine tags） |
| Runtime | 可经 Domain Recall 进入候选；可带 `domainId` 参与 Vote / sameDomain |
| SSOT | 标签只写在 `term_domain_tags` |

### 2.3 明确不存在的概念（入库）

| 禁止概念 | 说明 |
|----------|------|
| `is_base` / Base 字段 | Base = **空 tags**，不另建列 |
| `all_domain` / 全领域词 | 跨行业通用词 → **空 tags**，不是打满所有域 |
| `domain_role` / `is_all_domain` / `general_tag` | 第二套状态一律禁止 |
| Runtime「Weak Domain」第三态 | 强弱仅可作 **人审用语** 或 `weight`；不得新表/新列 |
| 用「术语感」代替区分能力 | 日常词只要有区分力 → 允许 Domain（如入住、退房、上线） |

---

## 3. 架构关系（冻结视图）

```text
                    ┌─────────────────────────────────────┐
                    │  term  (逻辑词条主表)                 │
                    │  id / word / pinyin / prior / ...    │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
   term_domain_tags=∅     term_domain_tags≠∅     （可选）其它派生
        = Base                  = Domain
              │                    │
              │                    │  SSOT：领域归属 / weight
              │                    ▼
              │           ┌────────────────────┐
              │           │ domain_lexicon     │
              │           │ （物化投影）         │
              │           │ 按 tag 展开的域桶   │
              │           └─────────┬──────────┘
              │                     │
              ▼                     ▼
      ┌──────────────┐     ┌──────────────────┐
      │ base_lexicon │     │ Domain Recall    │
      │ 通用拼音桶   │     │ JOIN tags ∩ scope│
      └──────┬───────┘     └────────┬─────────┘
             │                      │
             └──────────┬───────────┘
                        ▼
              Span Assembly / Vote / sameDomain
```

### 3.1 表职责

| 对象 | 角色 | 是否 Domain SSOT |
|------|------|:----------------:|
| **`term`** | 词条身份与通用属性 | 否 |
| **`term_domain_tags`** | **唯一**「此词属于哪些细域」 | **是** |
| **`base_lexicon`** | Base Recall 物化/检索桶（通用词） | 否 |
| **`domain_lexicon`** | Domain Recall 物化桶（**派生自** term + tags） | **否**（投影，不得独立编造域） |
| **`domain_hierarchy`** | 粗细域层级（DSU） | 否（层级 SSOT，非词标签） |
| **`RuntimeDomainRegistry`** | `availableFineDomains` = DISTINCT tags 等 | 读 tags |
| **Vote / Assembly** | 消费候选上的 `domainId` / source | 不拥有标签 SSOT |

### 3.2 物化规则（合同）

```text
term + term_domain_tags  →  (rematerialize)  →  domain_lexicon / routing / ngrams…
```

- 修改领域归属 **必须先改** `term_domain_tags`，再同步物化投影。  
- **禁止** 只改 `domain_lexicon.domain_id` 而不改 tags（造成双 SSOT）。  
- `base_lexicon` 不表示「有 Base 字段」；无 tags 的 term 仍是合同 Base。

### 3.3 Runtime 消费链（只读说明）

```text
resolveRecallScope() → recallDomainScope
        ↓
Domain SQL: domain_lexicon ⋈ term_domain_tags（domain_id ∈ scope）
Base SQL:   base_lexicon
        ↓
候选 domainId（现今常压缩为 domains[0] — 合同不认可此压缩为标签 SSOT）
        ↓
Domain Vote → Winner → sameDomain / base / fallback
```

**合同要求：** 标签真相在 DB tags；DTO 单 `domainId` 是实现细节，**不得**反写为「词只有一域」的编目原则。多域词应在 tags 中保留多行（≤运营上限）。

---

## 4. 与 DSU 的边界

| 主题 | Owner |
|------|--------|
| 哪些 fine domain **存在于系统** | DSU ← `term_domain_tags` DISTINCT |
| 某 **词** 是否属于某域 | **本文** ← 该词的 `term_domain_tags` 行 |
| Recall 打开哪些域 | DSU RS-03A `recallDomainScope` |
| 词该不该有 tag | **本文**（区分能力） |

---

## 5. 硬性禁止（Freeze）

| ID | 禁止项 |
|----|--------|
| F-01 | 自动生成 / 字袋挖词批量写入 Domain Tag（Industry Pack 式） |
| F-02 | 新增 `is_base`、`base_flag`、`tier` 语义替代空 tags |
| F-03 | 新增 `all_domain` / 全领域 / 给通用词打满多域 |
| F-04 | 使用 `general` 作为「万能域标签」替代空 tags |
| F-05 | 根据「tag 数量过多/过少」**自动**删除或补全 tags |
| F-06 | 用启发式分类器输出（如 7216→Base）**不经人审**直接全量落库 |
| F-07 | 将 Weak/Strong 落成 Runtime 第三态或新列 |
| F-08 | 独立编辑 `domain_lexicon` 域归属而不改 `term_domain_tags` |

---

## 6. 变更与解冻

- **允许（运营）：** 人工 / 受控 Patch 增删改 **单条或小批量** `term_domain_tags`（遵守 Guide + Checklist）。  
- **允许（工程）：** 物化同步、checksum/manifest 随 tags 更新。  
- **解冻：** 须新版本 `Freeze V2+` 文档明确修订条款；禁止静默破约。

---

## 7. 一句话

```text
空 tags = Base；有区分力才打 tags；tags 是唯一 Domain SSOT；
禁止第二套状态、全领域、自动打标、按数量自动删标。
```
