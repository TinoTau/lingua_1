# Lexicon Patch V3.1

> **SSOT：** [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)

节点端 SQLite Patch Service（**V3.1 已冻结**）。

---

## 职责

接收 `LexiconPatchV3` → 校验 → SQLite 事务 → 更新 `manifest.json` / `stats.json` / `checksum.txt` → `forceReloadLexiconRuntimeV3()`。

**禁止：** 全量 rebuild、JSONL Source 树、第二套 runtime、staging 目录切换。

---

## 模块文件

| 文件 | 职责 |
|------|------|
| `patch-service.ts` | 统一 `applyLexiconPatchV3()` |
| `patch-validator.ts` | version / hash / domain / priorScore |
| `sqlite-patch-applier.ts` | 事务 apply + alias/routing 级联 |
| `manifest-writer.ts` | 单 manifest / stats 写入 |
| `reload.ts` | Runtime close + reload |
| `apply-patch-http.ts` | test-server HTTP 封装 |
| `patch-e2e.test.ts` | Patch A–H + rollback E2E |

---

## 入口

| 通道 | 用法 |
|------|------|
| HTTP | `POST http://127.0.0.1:5020/lexicon/apply-patch` |
| CLI | `npm run lexicon:patch:apply -- [--bundle-dir <dir>] patch.json` |

生产 **Node Agent 入口待 P1**；须共用本 `PatchService`，禁止第二套 Apply 逻辑。

---

## Patch 协议（摘要）

```ts
interface LexiconPatchV3 {
  patchId: string;
  baseVersion: number;
  nextVersion: number;  // 须 baseVersion + 1
  hash: string;
  signature?: string;   // 预留，V3.1 未验签
  operations: PatchOperation[];
}
```

Domain disable：`domain_lexicon.enabled=0`，routing 行 **DELETE**（无 enabled 列）。

---

## 验证

```bash
npm run test:lexicon-patch-e2e
npm run lexicon:gate:v3-runtime
```

E2E 默认 `--bundle-dir` 临时副本，避免污染正式 `node_runtime/lexicon/v3`。

**勿修改本模块逻辑** unless V3.1 freeze review。
