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
| `manifest-writer.ts` | patch 后 manifest / stats（**重算** domainAvailability） |
| `manifest-domain-stats-bridge.ts` | 加载 `scripts/lexicon/lib/manifest-domain-stats.cjs` |
| `reload.ts` | Runtime close + reload |
| `apply-patch-http.ts` | test-server HTTP 封装 |
| `run-patch-e2e-runner.mjs` | Patch A–M + rollback E2E（Electron ABI） |

---

## 入口

| 通道 | 用法 |
|------|------|
| HTTP | `POST http://127.0.0.1:5020/lexicon/apply-patch` |
| CLI（推荐） | `npm run lexicon:patch:apply:electron -- patch.json` |
| CLI | `npm run lexicon:patch:apply -- patch.json` |

**JSONL SSOT：** Patch 是 runtime 交付机制；每个新词仍须同步更新 `entries.jsonl`（否则下次 full build 丢失）。

**生产：** 单节点单进程 patch；不支持多进程并发 patch。Apply 会 close → patch → reload runtime（短暂不可用）。

**domainTags：** 必须来自 `profile-registry.json`（经 `assertRegistryDomain`）；禁止虚构 domain_id。

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

## Patch Lifecycle（DSU · Frozen 2026-06-23）

```text
Patch (term operations)
    ↓
term_domain_tags  （SSOT 变更面）
    ↓
materialize       （domain_lexicon / ngrams 物化层）
    ↓
reload            （forceReloadLexiconRuntimeV3）
    ↓
RuntimeDomainRegistry rebuild   （installRuntimeDomainRegistry on load）
```

| 阶段 | 说明 |
|------|------|
| Patch 输入 | term add/update/disable · `domain_tags[]` on term |
| SSOT 写入 | `term` + `term_domain_tags` 事务内更新 |
| materialize | 物化 `domain_lexicon` 等；**非** Runtime domain SSOT |
| reload | `patch-service.ts` → `forceReloadLexiconRuntimeV3()` |
| Registry | `LexiconRuntimeV2.load()` → `buildRuntimeDomainRegistry` |

**Patch 不更新 `domain_hierarchy`（BG-06 / AV-02）：** hierarchy 仅 **full build**（`lexicon:build:v2-shadow`）从 `profile-registry.json` 物化。Patch 后 `availableFineDomains` 重算；parent/child 映射不变直至下次 full build。

权威文档：[DOMAIN_SOURCE_UNIFICATION.md](../../../../../docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md)

---

## 验证

```bash
npm run build:main
npm run test:lexicon-patch-e2e
npm run lexicon:gate:v3-runtime
```

E2E 默认 `--bundle-dir` 临时副本，避免污染正式 `node_runtime/lexicon/v3`。
