<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lexicon_Operation_Guide_V1.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lexicon Operation Guide V1

**Status:** Frozen companion · **V1** · **2026-07-18**  
**Authority：** [Lexicon_Domain_Contract_Freeze_V1.md](./Lexicon_Domain_Contract_Freeze_V1.md)  
**本轮：** 只更新运营规范文档 · **不改代码 / 不开发新功能**

---

## 1. 运营唯一问题（每次打标前）

```text
这个词是否具有「领域区分能力」？
```

| 回答 | 动作 |
|------|------|
| **否**（跨行业同等常用 / 纯功能词 / 无场景偏向） | **必须 Base**：`term_domain_tags` 全部删除（空） |
| **是**（能帮助区分细域） | **允许 Domain**：写入必要 fine-domain tags |
| **不确定** | **人审工单**；默认倾向「先空 tags」或「单域最小集」，禁止堆域 |

**禁止问：**「这是不是专业术语？」「未命中术语表是否就该 Base？」

---

## 2. 必须 Base 的词（合同示例 · 可扩展）

下列类型 **必须** `term_domain_tags = 空`：

### 2.1 跨行业套话 / 组织角色

`订单` · `经理` · `客户` · `安排` · `问题` · `系统` · `确认` · `谢谢` · `可以` · `开始` · `进行` · `结束` · `公司` · `工作`

### 2.2 指示 / 时间 / 代词 / 连接

`今天` · `大家` · `我们` · `你们` · `他们` · `这个` · `那个` · `什么` · `怎么` · `请问` · `你好` · `因为` · `所以` · `但是` · `然后` · `还是` · `或者` · `已经` · `时候` · `时间`

### 2.3 无区分力的「伪领域」写法

- 给通用词打上 `meeting` / `tech_ai`「占坑」  
- 使用 `general` 域标签代替空 tags  
- 把「全行业都会说」写成多域 tags

---

## 3. 允许 Domain 的词

### 3.1 强区分（高置信应有 tags）

| 域族 | 示例 |
|------|------|
| 咖啡 / 茶饮 / 烘焙 | 拿铁 · 美式 · 珍珠奶茶 · 蓝莓马芬 · 少糖 |
| 医疗 | 挂号 · 医生 · 门诊 · MRI · 处方 |
| 酒店 | 房卡 · 入住 · 退房 · 续住 |
| 接送机 / 行程 | 登机牌 · 接机 · 值机 · 包车 |
| 科技（真正技术锚点） | 接口 · 部署 · 联调 · 向量 · 微调 |
| 会务（真正会务锚点） | 议程 · 纪要 · 会务 · 签到 · 路演 |

### 3.2 弱锚点（有区分力 · 须人审 · 允许保留最少 tags）

`机场` · `预订` · `路线` · `会议` · `开发` · `测试` · `上线` 等：

- **不是**自动 Base；  
- **不是**自动多域；  
- 人审后：保留 **1（优先）～少数** 真正相关 fine domain，或确认无区分力后清空。

### 3.3 Tag 数量

| 规则 | 要求 |
|------|------|
| 上限 | 单词 active fine tags **建议 ≤ 5**（运营维护上限） |
| 不要求填满 | 1 个正确域优于 5 个模糊域 |
| 多域 | 仅当词在多个细域均有真实区分力（如少糖∈咖啡/奶茶） |
| **禁止** | 按「已经有几个 tag」自动删/补 |

---

## 4. 错域与污染（必须修）

| 类型 | 动作 |
|------|------|
| Wrong Domain Assignment（医生→meeting） | 改为正确域，或 Base |
| Capacity / 测试污染（中杯→meeting） | 去掉污染域，保留合法饮品族 |
| `general` 伪域 | 删除；通用词改空 tags，领域词改真实细域 |

---

## 5. 写入路径（运营）

```text
受控 Patch / 人工清单
        ↓
只改 term_domain_tags（SSOT）
        ↓
rematerialize（domain_lexicon 等投影）
        ↓
更新 manifest checksum
        ↓
Checklist 验收
```

| 允许 | 禁止 |
|------|------|
| 小批量、可审计 Patch | Industry Pack 字袋 **自动**打标入库 |
| 单词语人工确认 | 分类器 7216 全量自动落库 |
| weight 表达证据强弱 | 新列 `weak_domain` / `is_base` |

---

## 6. 与 Runtime 行为的运营预期

| 词状态 | Base Recall | Domain Recall | Domain Vote | sameDomain |
|--------|:-----------:|:-------------:|:-----------:|:----------:|
| 空 tags（Base） | ✓ | ✗（无域行） | 不贡献域分 | 不进 |
| 有 tags（Domain） | 仍可能经 base 桶命中同词面 | ✓（scope 内） | 可贡献 | winner 匹配时可进 |

运营 **不**要求理解 Vote 公式细节；只保证：**不该投票的词不要有 tags**。

---

## 7. 禁止清单（运营红线）

1. **禁止自动生成 Domain Tag**（脚本挖词直接写库）。  
2. **禁止增加 Base 字段**（空 tags 即 Base）。  
3. **禁止 All Domain / 全领域打标**。  
4. **禁止根据 Tag 数量自动删 Tag**。  
5. **禁止** 把「未进强术语表」当成「必须 Base」。  
6. **禁止** 只改 `domain_lexicon` 不改 tags。

---

## 8. 相关文档

- 合同冻结：`Lexicon_Domain_Contract_Freeze_V1.md`  
- 验收清单：`Lexicon_Maintenance_Checklist_V1.md`  
- DSU：`docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md`
