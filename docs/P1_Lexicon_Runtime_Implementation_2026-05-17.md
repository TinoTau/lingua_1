# P1 Lexicon Runtime 实现报告

**日期**：2026-05-17  
**依据**：决策部门《P1 Lexicon Runtime Historical Decisions Supplement》+ vibe coding 规范

---

## 1. 实现范围

| 项 | 状态 |
|----|------|
| SQLite 本地 runtime（`better-sqlite3`） | ✅ |
| Bundle：`node_runtime/lexicon/current/` | ✅ 已生成 dev sample |
| manifest + checksum 校验 | ✅ |
| 最小 suspicious span + 精确 term 查表 | ✅ |
| `ctx.lexiconRecallPreview` → `extra.lexicon_recall_preview` | ✅ |
| 不改写 `repairedText` / `segmentForJobResult` | ✅ |
| 不消费 n-best / KenLM | ✅ |
| 无 shadow 路径 / 无 5016 调用 | ✅ |
| 默认关闭（`use_lexicon` + `features.lexiconRecall.enabled`） | ✅ |

**未实现**（按决策留待后续）：selector、writeback、window phonetic、KenLM veto、n-best 参与 recall。

---

## 2. 修改文件

| 路径 | 说明 |
|------|------|
| `main/src/lexicon/*` | runtime、recall、span 检测、单测 |
| `main/src/pipeline/steps/lexicon-recall-step.ts` | Pipeline 步骤 |
| `main/src/pipeline/pipeline-mode-config.ts` | `LEXICON_RECALL` 步骤 |
| `main/src/pipeline/pipeline-step-registry.ts` | 注册步骤 |
| `main/src/pipeline/context/job-context.ts` | lexicon 字段 |
| `main/src/pipeline/result-builder.ts` | extra 输出 |
| `main/src/node-config.ts` / `node-config-defaults.ts` / `node-config-types.ts` | 开关 |
| `shared/protocols/messages.ts` + `webapp/.../messages.ts` | `use_lexicon` |
| `package.json` | `better-sqlite3` |
| `scripts/init-lexicon-bundle.mjs` | 生成 dev bundle |
| `node_runtime/lexicon/current/*` | sample sqlite + manifest |

---

## 3. 启用方式

1. 生成/更新 bundle：`cd electron-node && node scripts/init-lexicon-bundle.mjs`
2. 节点配置 `electron-node-config.json`：

```json
{
  "features": {
    "lexiconRecall": { "enabled": true }
  }
}
```

3. Job `pipeline.use_lexicon: true` 且 `src_lang` 为中文（`zh` / `yue`）

---

## 4. extra 字段

| 字段 | 条件 |
|------|------|
| `lexicon_recall_preview` | 候选非空 |
| `lexicon_runtime_status` | `ok` / `missing` / `disabled` / `error` |
| `lexicon_manifest_version` | runtime 加载成功时 |
| `lexicon_recall_truncated` | 超过 48 条候选时 |

---

## 5. 测试

| 项 | 结果 |
|----|------|
| `main/src/lexicon/*.test.ts` | PASS |
| `result-builder.test.ts`（lexicon extra） | PASS |
| `npm run build:main` | PASS |

---

## 6. 约束核对

- [x] 仅 evidence，不改写文本  
- [x] 不用 n-best / KenLM  
- [x] 非 HTTP 服务、不调用 5016  
- [x] bundle 缺失 → `missing`，主链继续  
- [x] 步骤失败不 abort（非 ASR critical）  
