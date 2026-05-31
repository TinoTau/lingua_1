# Lexicon Runtime V2 — Phase 2 测试报告（Intent E2E）

版本：V1.0（部分完成）  
日期：2026-05-30  
范围：CPU LLM Intent → `lexiconSessionIntent` Session 写入

---

## 1. 当前状态

| 组件 | 状态 |
|------|------|
| 节点端 `:5020` | **已闪退 / DOWN** |
| Intent 服务 `:5018` | **DOWN**（需你本地重新拉起） |
| Phase 2 E2E 脚本 | 已添加 `tests/run-lexicon-v2-phase2-intent-e2e.js` |

**说明：** 本轮未再阻塞等待节点启动；以下结论来自已完成的探测与一次 E2E 试跑。

---

## 2. 已通过项

### 2.1 Intent 服务直连（不经过节点）

`POST http://127.0.0.1:5018/intent`（咖啡点餐语境）：

| 字段 | 结果 |
|------|------|
| primaryDomain | `restaurant` |
| topicKeywords | `["咖啡","中杯"]` |
| summary | 有效中文摘要 |

**结论：** Phase 2 prompt schema 扩展 **有效**，LLM 能输出 `topicKeywords`。

### 2.2 单元测试（不依赖节点）

| 套件 | 结果 |
|------|------|
| `lexicon-session-intent.test.ts` | PASS |
| `lexicon-profile-decision-parser.test.ts`（含 topicKeywords） | PASS |

### 2.3 配置（已写入 `%APPDATA%\lingua-electron-node\electron-node-config.json`）

```json
{
  "features": {
    "lexiconV2": {
      "enabled": true,
      "sessionIntentWriteEnabled": true,
      "intentEnabled": true,
      "cpuWorker": { "timeoutMs": 45000 }
    }
  }
}
```

---

## 3. E2E 试跑结果（未完成）

脚本：`node tests/run-lexicon-v2-phase2-intent-e2e.js`

| 步骤 | 结果 |
|------|------|
| Intent 直连 probe | **PASS** |
| 3 turn pipeline（cafe d001–d003） | pipeline **PASS**，Intent 回调 **FAIL** |
| Session `lexiconSessionIntent` 轮询 | **超时**（120s 内未写入） |

**根因（已定位）：**

1. **Worker 超时过短：** `cpu-intent-llm-worker.ts` 硬编码 `WORKER_TIMEOUT_MS=8000`，CPU 推理 ~7s+ 时被截断 → `inference_timeout` / `service_unreachable`。
2. **Bootstrap 连触发 3 次 Intent：** turn 1–3 各调度一次，latest-only 队列互相替换，加剧超时。
3. **无 decision 则不写 Session：** `session-finalize.ts` 仅在 LLM 返回有效 decision 时写 `lexiconSessionIntent`。

---

## 4. 已做代码修复

`cpu-intent-llm-worker.ts`：Worker 超时改为 **`timeoutMs + 1000`**（与配置对齐，不再固定 8s）。

E2E 脚本改为 **单 turn**（cafe d001）以减少队列冲突。

**需重启节点后生效：** `npm run build:main` 已完成编译。

---

## 5. 你本地复测步骤（节点稳定后）

```powershell
# 1. 先拉起 Intent 服务（5018，model_loaded=true）
# 2. 再启动节点
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:NODE_ENV = "production"
npm start

# 3. 新终端 — Phase 2 E2E（单 turn + 轮询 Session Intent）
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/run-lexicon-v2-phase2-intent-e2e.js
```

**PASS 判据：**

- `lexicon-v2-phase2-intent-e2e-result.json` → `"pass": true`
- Session export 含 `lexiconSessionIntent`：
  - `topicKeywords` / `topicKeywordPinyinKeys`（Node 计算）
  - `primaryDomain` ≠ `general`
  - `source: "cpu_llm"`

---

## 6. 结论

| 层级 | 结论 |
|------|------|
| Intent 服务 + topicKeywords 输出 | ✅ 已验证 |
| Node Session 写入 E2E | ⏸ **未完成**（超时 bug 已修，待稳定节点复测） |
| Recall 切换 | ❌ 未测（Phase 3 范围） |
