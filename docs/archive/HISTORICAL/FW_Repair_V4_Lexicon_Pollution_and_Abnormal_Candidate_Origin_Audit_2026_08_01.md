<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexicon_Pollution_and_Abnormal_Candidate_Origin_Audit_2026_08_01.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexicon Pollution & Abnormal Candidate Origin Audit

**Date:** 2026-08-01  
**Nature:** READ ONLY · LEXICON SSOT · ABNORMAL CANDIDATE ORIGIN · PRODUCTION PATH ONLY  
**禁止已遵守:** 未改代码 / SQLite / 词库 / 配置 / 缓存 / dialog_200；未执行 import/rebuild。

**Artifacts:**

| Artifact | Path |
|----------|------|
| Probe result | `docs/tone-v2/_audit_scratch/lexicon_pollution_audit/_probe_result.json` |
| Pollution CSV | `docs/tone-v2/_audit_scratch/lexicon_pollution_audit/lexicon_pollution_inventory.csv` |
| Atomicity CSV | `docs/tone-v2/_audit_scratch/lexicon_pollution_audit/lexicon_atomicity_violations.csv` |
| Candidate export used | `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/` |
| Assembly traces used | `docs/tone-v2/_audit_scratch/sentence_assembly_trace/` |

---

## 1. Executive Conclusion

**Verdict: FAIL**

```text
FAIL

发现正式词库污染、旧数据库仍在使用、
重建未清空旧数据、原子化规则未执行，
或生产代码生成数据库中不存在的异常 Candidate surface。
```

本轮证据指向的具体形态是：

| 问题 | 证据摘要 | 分类 |
|------|----------|------|
| **科医** 替换「可以」 | 不在 `base_lexicon`/`domain_lexicon`；在 `term_pinyin_ngrams.fragment_text`；parent=内科/外科/儿科/妇科医生；Recall `parent_fragment` | **P1 ALIAS_OR_NGRAM_BYPASS**（生产可达） |
| **上线计划 / 接口文档** | 正式 term（base+domain），`source=external_full_review_supplement_v1` | **P1 ATOMICITY_RULE_NOT_ENFORCED** |
| **生城 / 计化 / 上线计化 / 后选生城** | DB 无 term；为 Raw 残留或「候选+Raw」拼句 | **P2 RAW_PRESERVATION** |
| **议室 / 低脂 / 记员 / 机员** 等 | 仅 ngram fragment，可被 Recall | **P1 NGRAM_BYPASS** |
| Clean rebuild | Manifest 声称 `FULL_REBUILD` + `no_merge:true`，checksum 匹配；但 **源数据本身含组合词 + ngram 子串展开** | 重建文件级 clean ≠ 内容合规 |

未发现：生产加载错误 SQLite、HIDDEN 运行时汉字生成（无拼音→造字）、测试 fixture 进生产 Recall。

---

## 2. Audit Scope

- 生产入口：`LexiconRuntimeV2.load` / `loadFromBundleDir` → `node_runtime/lexicon/v3`
- 异常表面：用户清单 + dialog_200 export 中 `repairTarget && word≠spanText` 的全部 replacement
- 不修改、不清理、不 rebuild

---

## 3. Frozen Lexicon Contract（审计基准）

```text
1. 业务词原子化（2–3 字；4–5 仅专名/术语/成语例外）
2. 多领域 = term_domain_tags 多行，不复制表面
3. 唯一运行时 SSOT = 配置的 v3 bundle lexicon.sqlite
4. 「上线计划」类组合词不应作为正式 term
```

---

## 4. Production Lexicon File Resolution

### 4.1 代码解析路径

```text
getLexiconRuntimeV2Config().bundlePath
  default = 'node_runtime/lexicon/v3'
→ resolveLexiconV2BundleDir(PROJECT_ROOT + bundlePath)
→ lexicon.sqlite + manifest.json + checksum.txt
→ new Database(sqlitePath, { readonly: true })
```

文件：`lexicon-v2-bundle-path.ts` · `lexicon-runtime-v2-config.ts` · `lexicon-runtime-v2.ts`

### 4.2 生产实际文件

| 项 | 值 |
|----|-----|
| 绝对路径 | `D:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite` |
| 大小 | 85,921,792 bytes |
| mtime/ctime | 2026-07-18T12:08:23.398Z |
| schemaVersion | `lexicon-v3-five-table-v2` |
| bundleVersion | 10 |
| buildTime | 2026-07-18T11:24:16.429Z |
| sha256 | `62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| checksum.txt / manifest | **一致** |
| open mode | **readonly** |
| lastPatchId | `lexicon-domain-hierarchy-completion-v1` |

**结论：生产加载的是 v3 目录下当前文件，且与 manifest checksum 一致（即「最后一次写入 v3 并更新 checksum」的那份）。**

### 4.3 仓库内其他 SQLite 分类

| 路径 | 分类 |
|------|------|
| `node_runtime/lexicon/v3/lexicon.sqlite` | **PRODUCTION_ACTIVE** |
| `node_runtime/lexicon/current/lexicon.sqlite` | PRODUCTION_INACTIVE（非默认 bundle） |
| `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite` | GENERATED_SOURCE |
| `v3/backup_before_*` / `v3_snapshot_*` / `_backup_manifest_migration` | LEGACY |

默认配置 **不会** 加载 `current/` 或 snapshot。

---

## 5. Database Inventory

见上表。另有备份/shadow 副本（§4.3）。

---

## 6. Schema and Table Roles

| 表 | row count | 参与 Recall？ | SSOT？ |
|----|----------:|---------------|--------|
| `base_lexicon` | 10061 | YES（tier） | YES |
| `domain_lexicon` | 1033 | YES | YES（域词） |
| `idiom_lexicon` | 22192 | 配置 maxIdiom=0 时不进主召回 | YES 数据 |
| `term` | 10061 | 与 base 对齐视图/表 | YES |
| `term_domain_tags` | 1033 | enrichment domains[] | YES |
| `term_pinyin_ngrams` | 4200 | YES（`parent_fragment`） | **派生表** |
| `industry_routing_lexicon` | 1033 | 仅 industry routing 开时 | 旁路 |
| `domain_hierarchy` | 12 | Registry | YES |
| `lexicon_patch_history` | 6 | 审计 | meta |

---

## 7. Abnormal Surface Inventory

dialog_200 export 中 `word≠spanText` 的 repair replacement：**20 种表面**（按频次）。

Top 与重点：

| surface | count | DB | 判定 |
|---------|------:|----|------|
| 候选 | 130 | term | 合法原子修复（后选→候选） |
| 计划 | 44 | term | 合法原子（计化→计划）；但「上线计划」整词也在库 |
| 上线计划 | 见 compound | **正式 term** | 原子化违规 |
| **科医** | 16 | **仅 ngram** | 可以→科医 |
| 医师 | 4 | term+medical | 合法域词 |
| 议室 | 4 | 仅 ngram（会议室） | ngram 旁路 |
| 低脂 | 4 | 仅 ngram（低脂奶） | ngram 旁路 |
| 登机 | 4 | base term | 合法 |
| 记员/机员/细吸/内科医… | ≤5 | 多为 ngram | ngram 旁路 |

完整清单：`lexicon_pollution_inventory.csv`。

---

## 8. 科医 Origin Trace

### 8.1 是否正式 term？

**否。** `base_lexicon` / `domain_lexicon` / `term`：**0 行**。

### 8.2 来源表

`term_pinyin_ngrams`，`fragment_text='科医'`，4 行：

| id | parent_word | ngram_pinyin | domain_id | source |
|----|-------------|--------------|-----------|--------|
| 512 | 儿科医生 | ke\|yi | medical | industry_pack_v1 |
| 618 | 内科医生 | ke\|yi | medical | industry_pack_v1 |
| 1501 | 外科医生 | ke\|yi | medical | industry_pack_v1 |
| 1611 | 妇科医生 | ke\|yi | medical | industry_pack_v1 |

### 8.3 为何带 medical？

ngram 行自带 `domain_id=medical`；`recall-span-topkv3.ts` → `ngramRowToHotword` → `hitKind:'parent_fragment'`，`word: row.fragmentText`（**科医**）。

### 8.4 生产替换证据（非猜测）

| caseId | Raw span | replacement | source |
|--------|----------|-------------|--------|
| d009 等 12 cases | **可以** | **科医** | `lexicon_pinyin_topk` |

例：Raw `…不走四环可以吗？` → Candidate 句含 `…不走四环科医吗？`。

### 8.5 回答清单

| # | 答案 |
|---|------|
| 1 正式 term？ | **否** |
| 2 alias？ | **否** |
| 3 parent_fragment？ | **是** |
| 4 由「可以」拼音窗口召回？ | **是**（同音 ke\|yi 类窗口） |
| 5 ngram 子串？ | **是** |
| 6 旧 confusion map？ | **未发现**独立 confusion 表命中 |
| 7 旧词库文件？ | **否**（当前 ACTIVE v3） |
| 8 import source？ | parent term `industry_pack_v1` → ngram 展开 |
| 9 medical？ | ngram.`domain_id` |
| 10 SQL？ | Runtime 对 `term_pinyin_ngrams` 的 parent-ngram 查询（非 base exact） |

**分类：P1 ALIAS_OR_NGRAM_BYPASS（生产可达，非 Raw）。**

---

## 9. 生城 Origin Trace

| 检查 | 结果 |
|------|------|
| base/domain/ngram | **均无** |
| 作为 repair replacement（≠span） | **否**（inventory count=0） |
| 在 final 句中 | 与 Raw「生城」并存 |

**判定：P2 RAW_PRESERVATION** — ASR 原文残留，非词库 Candidate。

「候选生城」= replacement **候选**（后选→候选）+ Raw **生城**，**不是**完整词条 `候选生城`。

---

## 10. 计化 Origin Trace

| 检查 | 结果 |
|------|------|
| DB term/ngram | **无** |
| Raw | 含「计化」 |
| repair | 常变为 **计划**（合法 term） |
| 「上线计化」 | Raw「上线」+ Raw「计化」未全替换时保留；或「上线」+「计划」→「上线计划」 |

「上线计化」：**不是**独立 Candidate 词条；是 Raw 片段组合。  
「上线计划」：可以是 **正式 4 字 term** 整词命中，也可由「上线」+「计划」组装 — DB 中 **两者机制都存在**。

---

## 11. 上线计划 / 候选生成 Atomicity Audit

| 表面 | 正式 term？ | ngram？ | 结论 |
|------|------------|---------|------|
| **上线计划** | **YES**（base+domain，tech_ai） | YES（子串展开） | **违反当前原子化要求** |
| **候选生成** | NO | NO | 非污染；句中多为「候选」+Raw |
| **接口文档** | **YES**（base+domain，tech_ai） | YES | **违反原子化要求** |
| 收货地址/订单中台/翻译引擎/会员系统/血常规/机场高速/软件园 | NO in active term | — | 未作为正式 term |
| 大床房 | YES（hotel） | YES | 4 字；可能专名例外，需产品裁定 |

来源字段：`source=external_full_review_supplement_v1`（full rebuild 补充表）。

---

## 12. Candidate-to-SQL Provenance（摘要）

```text
可以 → 科医
  Recall parent_fragment
  ← term_pinyin_ngrams.fragment_text='科医'
  ← parent 内科医生/…
  ← industry_pack_v1

后选 → 候选
  ← base/domain term「候选」

计化 → 计划
  ← term「计划」

衣室 → 医师 / 议室
  ← term「医师」 / ngram「议室」(会议室)
```

无证据表明 Node 在 mapper 中 **拼接出数据库不存在的汉字**；异常汉字均来自 **term 或 ngram.fragment_text**。

---

## 13. Import Source Inventory

Manifest `seedInputs`（JSONL）+ rebuild sources：

```text
lexicon_full_corrected_review.csv
term_domain_tags_corrected.csv
supplemental_terms.csv
excluded: terms_to_remove_or_rebuild.csv (12)
```

Industry pack / external supplement 将长词写入后，build 派生 `term_pinyin_ngrams` 子串（含无意义片段「科医」「线计」等）。

---

## 14. Rebuild Process Audit

Manifest：

```text
rebuild.mode = FULL_REBUILD
no_merge = true
```

`prepare-lexicon-v3-runtime-from-shadow.mjs`：`--force` 时 **rmSync 目标目录再 cp**（文件级替换）。

| 问题 | 答案 |
|------|------|
| 是否 DROP 后重建？ | 文件级替换 + shadow build；manifest 声明 FULL_REBUILD |
| merge 旧 DB？ | **声明 no_merge**；checksum 自洽 |
| 是否保留 ngrams？ | **是** — 重建流程会重建派生 ngram |
| 生产仍开旧 handle？ | 需 **重启 Node** 才加载新文件；缓存 key 含 `lexiconVersion`（utterance cache） |
| Clean 内容？ | **文件 clean ≠ 原子化合规** |

```text
REBUILD_FILE_CLEAN_PROVEN
CONTENT_ATOMICITY_NOT_PROVEN
```

（非「未清空旧文件 merge」，而是「干净装入了不合规源数据 + ngram 展开」。）

---

## 15. Atomicity Enforcement Audit

| 机制 | 状态 |
|------|------|
| `rejectPhraseLike`（industry_pack） | **存在**；拦部分短语标记；**不拦**「上线计划」「接口文档」 |
| 对 full-review CSV / supplemental | **未见同等硬约束接到 full rebuild** |
| ngram 子串展开 | **无**「禁止无语义 bigram」过滤器 → 产出「科医」「线计」 |
| 文档原子化 vs 代码 | **文档/用户要求严于实际导入执行** |

---

## 16. Alias / Confusion / Ngram Bypass Audit

| 机制 | 生产？ | 可否产出非 term 表面？ |
|------|--------|------------------------|
| alias 列 | 有字段；本轮异常主因不是 alias | 可 |
| confusion map 表 | **未作为主因** | — |
| **term_pinyin_ngrams** | **YES** | **YES（科医、议室、低脂…）** |
| parent_fragment | **YES** | 使用 fragment_text |
| 运行时造字 | **否** | — |

---

## 17. Cache and Runtime Version Audit

- SQLite：**每次 load 打开文件**；checksum 校验  
- `utterance-recall-cache`：key 含 `lexiconVersion`  
- 重建后 **必须重启 Node** 才能保证无旧 DB handle  
- 本轮 Trace 使用的词库 hash = 当前 v3 checksum（与文件一致）

---

## 18. Legacy Database Audit

备份/snapshot **未被**默认 `bundlePath` 加载。  
**非** P1 LEGACY_DB_ACTIVE。

---

## 19. Multi-Domain Tag Audit

样例原子词（订单/预订/前台/计划/接口/文档/联调/上线）见 `_probe_result.json` → `multiDomainAudit`。  
「上线计划」仅 **tech_ai** 单域标签；「医师」**medical**。  
Domain multi lookup 为 term-then-tags 原子查询（既有 freeze 合同）；本轮未改标签。

---

## 20. Pollution Classification

| 表面 | 分类 |
|------|------|
| 科医、议室、低脂、内科医、记员… | **P1 ALIAS_OR_NGRAM_BYPASS** |
| 上线计划、接口文档 | **P1 ATOMICITY_RULE_NOT_ENFORCED**（正式 term） |
| 生城、计化、后选生城、候选生城、上线计化、候选生成（整词） | **P2 RAW_PRESERVATION** / 组装 |
| 候选、计划、医师、登机… | 合法原子/域词（KEEP 倾向） |
| HIDDEN_SURFACE_GENERATION | **未证实**（表面均有 DB 行：term 或 ngram） |
| LEGACY_DB_ACTIVE | **否** |
| DIRTY_REBUILD（merge 旧文件） | **未证实**；内容不合规 |

---

## 21. P0 / P1 Findings

### P1（必须处理）

1. **Ngram 旁路**：`科医` 等 fragment 进入生产 Candidate，替换高频功能词「可以」。  
2. **原子化未执行**：`上线计划`、`接口文档` 作为正式 term + 全量子串 ngram。  
3. 同类 ngram：`议室`、`低脂`、无意义跨边界片段。

### 非 P0 HIDDEN

无证据表明代码生成 **库中完全不存在** 的汉字串。

---

## 22. DELETE / REBUILD / CLEAN / KEEP Candidates（建议，不执行）

### DELETE / 禁用（建议）

```text
term_pinyin_ngrams 中无语义 fragment：科医、线计、议室（若不允许 fragment 召回）…
或：关闭/收紧 parent_fragment 进入 Assembly 的资格
```

### DELETE term（原子化）

```text
上线计划
接口文档
（及 atomicity CSV 中确认的可拆业务短语）
```

### REBUILD

```text
派生表 term_pinyin_ngrams 需按新原子 term 集重建
建议：clean rebuild + 强制原子化 validator + ngram 白名单策略
```

### KEEP

```text
候选、计划、上线、医师、登机、地质、议员（若确认为合法原子/域词）
生城/计化作为 Raw（无需删库）
```

### STOP SOURCE

```text
external_full_review_supplement 中未过原子化门禁的短语
industry_pack 无约束的 ngram 全展开
```

---

## 23. Target List

| ID | 答案 |
|----|------|
| T1 | `node_runtime/lexicon/v3/lexicon.sqlite` |
| T2 | **是**（checksum 匹配当前文件） |
| T3 | 文件级 FULL_REBUILD/`no_merge` **已声明且自洽**；内容原子化 **未达标** |
| T4 | **否** |
| T5 | `term_pinyin_ngrams` parent_fragment / ke\|yi |
| T6 | **Raw 残留** |
| T7 | **Raw 残留**（可被「计划」替换） |
| T8 | **候选 + Raw 生城**，非整词 |
| T9 | **主要为 Raw 组合**；「上线计划」另有正式 term |
| T10 | **是**（违规） |
| T11 | **否** |
| T12 | **是**（违规） |
| T13 | **是** |
| T14 | industry `rejectPhraseLike` 有限；full rebuild **未真正强制**用户原子化合同 |
| T15 | **未发现**旧文件 merge；有补充源装入 |
| T16 | **否** |
| T17 | 本轮主因不是 alias |
| T18 | **是** |
| T19 | **否**（主因） |
| T20 | **否**造字；有 **term/ngram 表面** 组装句 |
| T21 | 需重启；本 Trace 与当前 hash 一致 |
| T22 | **否**（生产库） |
| T23 | **是**（可追到表/源） |
| T24 | 组合词 term：**是（原子化意义）**；科医非 term 但是 **活跃污染召回** |
| T25 | **否** |
| T26 | 建议删/禁：科医类 ngram；上线计划；接口文档（等） |
| T27 | `term_pinyin_ngrams` |
| T28 | 未校验的 supplement / 无约束 ngram 展开 |
| T29 | 上线计划、接口文档 + CSV 中 4+ 字可拆项（1185 行待审） |
| T30 | **是** — 建议在原子化门禁落地后 **clean rebuild** |

---

## 24. Check List

```text
[x] 未修改代码/数据库/rebuild/缓存
[x] 已确认生产 SQLite 路径与 checksum
[x] 已列出 SQLite 副本与表
[x] 已查询异常词 / 组合词
[x] 已追踪科医/生城/计化/上线计划/候选生成/接口文档
[x] 已检查原子化、import、rebuild、legacy、alias、ngram、cache
[x] 已导出 pollution / atomicity CSV
[x] 已区分 Raw vs Candidate
[x] 结论均有 SQL/文件/代码/导出证据
```

---

## 25. Final Verdict

```text
FAIL

发现正式词库污染、旧数据库仍在使用、
重建未清空旧数据、原子化规则未执行，
或生产代码生成数据库中不存在的异常 Candidate surface。
```

**精确落点（避免误读）：**

- **未**发现生产误载 legacy SQLite 文件。  
- **未**发现「库外造字」HIDDEN generation。  
- **已**发现：**(1)** 正式组合词 term 违反原子化；**(2)** `term_pinyin_ngrams` 将「科医」等无语义 fragment 送入生产 Recall，把「可以」修成「科医」。  

下一步（另轮，非本轮）：收紧/禁用危险 ngram fragment → 删除违规短语 term → 带原子化门禁的 clean rebuild → 重启 Node → 用 dialog_200 候选句导出复验「可以→科医」归零。
