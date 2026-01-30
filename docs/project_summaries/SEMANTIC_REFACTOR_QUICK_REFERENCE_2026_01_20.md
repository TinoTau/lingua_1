# 语义修复中心化重构快速参考

**日期**: 2026-01-20  
**状态**: ✅ 已完成

---

## 🎯 核心改动

### 1. 状态映射修正
**文件**: `electron_node/electron-node/main/src/service-layer/ServiceDiscovery.ts`
```typescript
// ✅ starting 状态现在被视为 running
status: runtime.status === 'running' || runtime.status === 'starting' ? 'running' : ...
```

### 2. 新增纯函数
**文件**: `electron_node/electron-node/main/src/agent/language-capability/language-capability-pairs.ts`
```typescript
export function computeSemanticCentricLanguagePairs(
  asrLanguages: string[],
  ttsLanguages: string[],
  nmtCapabilities: NmtCapability[],
  semanticLanguages: string[]
): LanguagePair[]

// 返回带语义修复标记的语言对
export interface LanguagePair {
  src: string;
  tgt: string;
  semantic_on_src: boolean;  // 源语言语义修复（必然 true）
  semantic_on_tgt: boolean;  // 目标语言语义修复（可选）
}
```

### 3. 核心规则
```typescript
// 1. 无语义服务 → 返回空数组 []
if (semanticSet.size === 0) return [];

// 2. 源语言必须有语义修复
if (!semanticSet.has(src)) continue;

// 3. 目标语言语义修复可选
semantic_on_tgt: semanticSet.has(tgt)
```

---

## 📋 编译命令

### 节点端
```bash
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
```

### 调度服务器
```bash
cd d:\Programs\github\lingua_1\central_server\scheduler
cargo build
```

---

## 🧪 测试验证

### 启动服务
```bash
# 1. 启动调度器
cd d:\Programs\github\lingua_1\central_server\scheduler
cargo run --release

# 2. 启动节点端
cd d:\Programs\github\lingua_1\electron_node\electron-node
npm run dev  # 开发模式
# 或
npm start    # 生产模式
```

### 预期结果
```json
{
  "semantic_core_ready": true,
  "supported_language_pairs": [
    {
      "src": "zh",
      "tgt": "en",
      "semantic_on_src": true,
      "semantic_on_tgt": false
    }
  ],
  "semantic_languages": ["zh"]
}
```

**关键检查点**:
- ✅ `semantic_core_ready: true`
- ✅ `supported_language_pairs.length > 0`
- ✅ 所有语言对的 `semantic_on_src: true`

---

## 📊 改动文件清单

### 节点端 (3 个文件)
1. `ServiceDiscovery.ts` - 状态映射修正
2. `language-capability-pairs.ts` - 纯函数实现
3. `node-agent-language-capability.ts` - 接口更新

### 调度服务器 (3 个文件)
1. `messages/common.rs` - 消息协议更新
2. `language_capability_index.rs` - 内部逻辑适配
3. `phase2/tests/ws_helpers.rs` - 测试数据更新

---

## 🔍 日志关键词

### 成功标志
```
✅ Language capabilities detected (semantic-centric)
supported_language_pairs: <数量>
semantic_on_src: <数量>
semantic_on_tgt: <数量>
```

### 失败标志
```
❌ 未检测到语义修复服务，节点不提供翻译能力
supported_language_pairs: 0
```

---

## 🚨 常见问题

### Q: 语言对数量为 0？
**A**: 检查是否有语义修复服务运行：
```bash
# 查看日志
grep "semantic_languages" electron-main.log
grep "semantic-repair" electron-main.log
```

### Q: 服务状态为 stopped？
**A**: 已修复！`starting` 状态现在被视为 `running`

### Q: 如何验证语义修复标记？
**A**: 查看日志中的 `semantic_on_tgt` 字段

---

## 📚 文档索引

- **完整报告**: `SEMANTIC_CENTRIC_REFACTOR_COMPLETE_2026_01_20.md`
- **原始方案**: `SEMANTIC_CENTRIC_LANGUAGE_CAPABILITY_REFACTOR_2026_01_20.md`
- **决策文档**: `LANGUAGE_CAPABILITY_ARCHITECTURE_DECISION_2026_01_20.md`

---

**版本**: 1.0  
**维护**: AI Assistant
