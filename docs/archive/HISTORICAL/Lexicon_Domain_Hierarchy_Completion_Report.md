<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lexicon_Domain_Hierarchy_Completion_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lexicon Domain Hierarchy Completion Report

**Date:** 2026-07-19  
**PatchId:** `lexicon-domain-hierarchy-completion-v1`  
**Mode:** Small-scope data contract repair  
**Development Verdict:** **PASS**

---

## Declaration

```text
仅补齐 domain_hierarchy（+ profile-registry 构建源同步）。
未修改 term / term_domain_tags / domain_lexicon / base_lexicon /
industry_routing_lexicon / term_pinyin_ngrams / idiom_lexicon。
未修改 Vote / Candidate / sameDomain / Assembly / domains[0]。
未重新 Full Rebuild。
```

---

## 1. Bundle 元数据（前后）

| Item | Before | After |
|------|--------|-------|
| bundleVersion | 9 | **10** |
| lastPatchId | lexicon-full-rebuild-v1 | **lexicon-domain-hierarchy-completion-v1** |
| domain_hierarchy rows | 8 | **12** |
| sqlite sha256 | `829a3e3f…`（v9 rebuild） | `62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| checksum.txt / manifest | 与 v9 对齐 | **三者一致** |

备份目录：

- `node_runtime/lexicon/v3/backup_before_hierarchy_completion/`（含修改前快照）

---

## 2. 修改文件

| 文件 | 变更 |
|------|------|
| `electron_node/electron-node/data/lexicon/profile-registry.json` | 新增 coarse：`healthcare` / `workplace` / `transportation`；细域 parent 指向上述 coarse |
| `node_runtime/lexicon/v3/lexicon.sqlite` | `domain_hierarchy` +4 行（INSERT OR IGNORE） |
| `node_runtime/lexicon/v3/manifest.json` | bundleVersion / lastPatchId / checksum / domainHierarchyVersion / tables.domain_hierarchy |
| `node_runtime/lexicon/v3/checksum.txt` | 重算 |
| `scripts/lexicon/lib/lexicon-v3-runtime.mjs` | gate 阈值 `domain_hierarchy: 8 → 12` |
| `freeze-contract.test.ts` | 同步断言 12 |
| `run-patch-e2e-runner.mjs` | 同步断言 12 |
| `scripts/lexicon/run-lexicon-hierarchy-completion.py` | 受控 migration 脚本 |

---

## 3. Hierarchy 真正 SSOT

| 层 | SSOT |
|----|------|
| Runtime | **`domain_hierarchy`（sqlite）** |
| Build-time seed | **`profile-registry.json` 的 `parent` 字段**（已同步） |
| 第二份 fine→coarse 配置 | **无** |

详见：`Lexicon_Domain_Hierarchy_PreRepair_Audit.md`

---

## 4. 新增四条关系

```text
healthcare     -> medical
workplace      -> meeting
workplace      -> tech_ai
transportation -> transport
```

---

## 5. 最终全部 12 条关系

```text
restaurant     -> bakery | coffee | food_order | milk_tea
travel         -> tourism_hotel | tourism_pickup | tourism_route | tourism_transport
healthcare     -> medical
workplace      -> meeting | tech_ai
transportation -> transport
```

---

## 6–7. 核心表行数与 content hash（不变）

| Table | Rows | Content SHA256（前后相同） |
|-------|-----:|---------------------------|
| term | 10061 | `08629a99…1f13` |
| term_domain_tags | 1033 | `21113612…0721` |
| domain_lexicon | 1033 | `32f0f2f7…2715` |
| base_lexicon | 10061 | `e74f2de1…6974` |
| industry_routing_lexicon | 1033 | `d228b12b…36b0` |
| term_pinyin_ngrams | 4200 | `0f596c41…7052` |
| idiom_lexicon | 22192 | `e2087a07…e4d3` |

---

## 8–11. Coverage

| Metric | Value |
|--------|------:|
| available fine domains | **12** |
| coarse domains | **5** |
| fine not in hierarchy | **0** |
| hierarchy fine not available | **0** |
| child with multiple parents | **0** |

coarse：`healthcare`, `restaurant`, `transportation`, `travel`, `workplace`

---

## 12. Runtime 加载结果（映射仿真 ≡ RuntimeDomainRegistry.buildMaps）

- 12 fine 均可注册且各有唯一 parent  
- 5 coarse 可读取  
- 无 self-parent / unknown coarse / fallback 到仅 restaurant/travel  

coarse→fine 校对：

```json
{
  "restaurant": ["bakery", "coffee", "food_order", "milk_tea"],
  "travel": ["tourism_hotel", "tourism_pickup", "tourism_route", "tourism_transport"],
  "healthcare": ["medical"],
  "workplace": ["meeting", "tech_ai"],
  "transportation": ["transport"]
}
```

---

## 13. Recall 冒烟（≥36 词）

每个 fine domain 取最多 3 个真实词：验证 domain_lexicon / base_lexicon 行存在且 hierarchy parent 正确。  
结果：**全部 ok**（详见 `tmp/.../hierarchy_completion_result.json` → `smoke`）。

---

## 14. Checksum

```text
sqlite sha256 == manifest.checksum == checksum.txt
sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef
```

---

## 15–16. 范围确认

| 问 | 答 |
|----|----|
| 是否修改 Runtime 业务逻辑（Vote/DTO/Assembly）？ | **否** |
| 是否修改 term/tag/materialized data？ | **否** |
| 是否修改 domains[0]？ | **否** |

---

## 17. 开发阶段结论

```text
PASS
```

下一步：独立只读验收 → `Lexicon_Domain_Hierarchy_Acceptance_Report.md`

```text
DEVELOPMENT COMPLETE — STOP pending acceptance
```
