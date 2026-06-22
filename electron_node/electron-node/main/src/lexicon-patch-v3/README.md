# Lexicon Patch V3.1

> **SSOT：** [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)

节点端 SQLite Patch Service（**Schema V2 Only**）。

---

## 职责

接收 `LexiconPatchV3` → 校验 → SQLite 事务 → 更新 `manifest.json` / `stats.json` / `checksum.txt` → `forceReloadLexiconRuntimeV3()`。

**禁止：** 全量 rebuild、JSONL Source 树、第二套 runtime、staging 目录切换、直写 `domain_lexicon` 作为 SSOT。

---

## 模块文件

| 文件 | 职责 |
|------|------|
| `patch-service.ts` | 统一 `applyLexiconPatchV3()` |
| `patch-validator.ts` | version / hash / domain / term SSOT |
| `sqlite-patch-applier.ts` | term-centric 事务 apply + rematerialize |
| `manifest-writer.ts` | v2 manifest / stats 写入 |
| `reload.ts` | Runtime close + reload |
| `apply-patch-http.ts` | test-server HTTP 封装 |
| `run-patch-e2e-runner.mjs` | Patch A–M + rollback E2E（Electron ABI） |

---

## 入口

| 通道 | 用法 |
|------|------|
| HTTP | `POST http://127.0.0.1:5020/lexicon/apply-patch` |
| CLI | `npm run lexicon:patch:apply -- [--bundle-dir <dir>] patch.json` |

---

## Patch 协议（摘要）

```ts
interface LexiconPatchV3 {
  patchId: string;
  baseVersion: number;
  nextVersion: number;  // 须 baseVersion + 1
  hash: string;
  operations: PatchOperation[];  // table: base | idiom | term
}
```

### Term-centric disable / enable

- **SSOT：** `term.enabled` + `term_domain_tags`
- **disable：** `op: disable, table: term, termId` → `term.enabled=0` → rematerialize → 物化 `domain_lexicon.enabled=0`；**routing 行删除**（disabled term 不参与路由）
- **enable：** `op: enable, table: term, termId` → `term.enabled=1` → rematerialize → 物化行恢复；routing 重新写入
- **禁止** domain-centric patch（`table: domain` 已移除）

---

## 验证

```bash
npm run build:main
npm run test:lexicon-patch-e2e
npm run lexicon:gate:v3-runtime
```

E2E 默认 `--bundle-dir` 临时副本，避免污染正式 `node_runtime/lexicon/v3`。
