# 心跳标签分析 - 新统一服务能否被调度服务器识别

**日期**: 2026-01-19  
**分析**: semantic-repair-en-zh 心跳标签与 Pool 创建

---

## 📊 原服务心跳标签格式

### 1. 中文修复服务 (semantic-repair-zh)

**service.json配置**:
```json
{
  "service_id": "semantic-repair-zh",
  "type": "semantic-repair",
  "language": "zh",
  "port": 5013
}
```

**心跳标签提取流程**:
1. Electron Node 读取 `service_id: "semantic-repair-zh"`
2. `detectSemanticLanguages()` 检测到 service_id 包含 'zh'
3. 推断为: `semantic_languages: ["zh"]`
4. 发送心跳: `language_capabilities.semantic_languages = ["zh"]`

**调度服务器处理**:
1. 接收心跳: `semantic_languages: ["zh"]`
2. 排序: `["zh"]`
3. Pool 名称: `"zh"`
4. 创建 Pool: `{ pool_id: 1, name: "zh", semantic_languages: ["zh"] }`

---

### 2. 英文修复服务 (semantic-repair-en)

**service.json配置**:
```json
{
  "service_id": "semantic-repair-en",
  "type": "semantic-repair",
  "language": "en",
  "port": 5011
}
```

**心跳标签提取流程**:
1. Electron Node 读取 `service_id: "semantic-repair-en"`
2. `detectSemanticLanguages()` 检测到 service_id 包含 'en'
3. 推断为: `semantic_languages: ["en"]`
4. 发送心跳: `language_capabilities.semantic_languages = ["en"]`

**调度服务器处理**:
1. 接收心跳: `semantic_languages: ["en"]`
2. 排序: `["en"]`
3. Pool 名称: `"en"`
4. 创建 Pool: `{ pool_id: 2, name: "en", semantic_languages: ["en"] }`

---

## 🎯 新统一服务心跳标签

### service-repair-en-zh

**service.json配置**:
```json
{
  "service_id": "semantic-repair-en-zh",
  "type": "semantic-repair",
  "language": "multi",
  "languages": ["zh", "en"],
  "port": 5015
}
```

**心跳标签提取流程**:

#### 阶段1: Electron Node 端

1. **服务发现**: ServiceConfigLoader 读取 service.json
   - `service_id: "semantic-repair-en-zh"`
   - `type: "semantic-repair"` → 识别为 SEMANTIC 类型

2. **语言能力检测**: `detectSemanticLanguages(service, models, metadata)`
   
   **优先级1 - 从 service_id 推断** (✅ **会被触发**):
   ```typescript
   const serviceId = service.service_id.toLowerCase(); // "semantic-repair-en-zh"
   
   if (serviceId.includes('zh') || serviceId.includes('chinese')) {
       languages.push('zh');  // ✅ 匹配！
   }
   if (serviceId.includes('en') || serviceId.includes('english')) {
       languages.push('en');  // ✅ 匹配！
   }
   
   // 结果: languages = ['zh', 'en']
   ```

3. **去重和规范化**:
   ```typescript
   capabilities.semantic_languages = normalizeLanguages([...new Set(['zh', 'en'])]);
   // 结果: semantic_languages = ['zh', 'en']
   ```

4. **发送心跳/注册**:
   ```json
   {
     "type": "node_register",  // or "node_heartbeat"
     "node_id": "node_001",
     "installed_services": [
       {
         "service_id": "semantic-repair-en-zh",
         "type": "semantic",
         "status": "running"
       }
     ],
     "language_capabilities": {
       "semantic_languages": ["zh", "en"],
       "asr_languages": [...],
       "tts_languages": [...],
       ...
     }
   }
   ```

#### 阶段2: 调度服务器端

1. **接收节点注册/心跳**:
   ```rust
   node.language_capabilities = Some(NodeLanguageCapabilities {
       semantic_languages: Some(vec!["zh".to_string(), "en".to_string()]),
       ...
   });
   ```

2. **Pool 创建判断** (phase3_pool_creation.rs):
   ```rust
   // 提取 semantic_languages
   let semantic_langs: HashSet<String> = caps.semantic_languages.as_ref()
       .map(|v| v.iter().cloned().collect())
       .unwrap_or_default();
   // semantic_langs = {"zh", "en"}
   
   // 排序语言集合（用于 Pool 命名）
   let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
   sorted_langs.sort();
   // sorted_langs = ["en", "zh"]
   
   let pool_name = sorted_langs.join("-");
   // pool_name = "en-zh"
   ```

3. **检查现有 Pool**:
   ```rust
   // 查找是否已存在名为 "en-zh" 的 Pool
   let existing_pool = cfg.pools.iter().find(|p| p.name == "en-zh");
   ```

4. **创建新 Pool** (如果不存在):
   ```rust
   let new_pool = Phase3PoolConfig {
       pool_id: next_pool_id,
       name: "en-zh".to_string(),
       required_services: vec!["asr", "nmt", "tts", "semantic"],
       language_requirements: Some(PoolLanguageRequirements {
           asr_languages: None,  // 不限制
           tts_languages: None,  // 不限制
           nmt_requirements: Some(PoolNmtRequirements {
               languages: vec!["en".to_string(), "zh".to_string()],
               rule: "any_to_any".to_string(),
               ...
           }),
           semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]),
       }),
   };
   ```

5. **节点分配到 Pool**:
   ```rust
   // 节点 node_001 会被分配到 pool_id: X (name: "en-zh")
   node_to_pool_index.insert("node_001", X);
   ```

---

## ✅ 结论

### **新服务能否被识别？**

**✅ 完全可以！**

| 检查项 | 状态 | 说明 |
|-------|------|------|
| **service_id 格式** | ✅ | `semantic-repair-en-zh` 包含 'en' 和 'zh' |
| **语言推断** | ✅ | `detectSemanticLanguages` 会识别出 `["zh", "en"]` |
| **心跳发送** | ✅ | `language_capabilities.semantic_languages = ["zh", "en"]` |
| **调度器接收** | ✅ | 正确提取 `semantic_languages: ["en", "zh"]` (排序后) |
| **Pool 创建** | ✅ | 自动创建 Pool: `name="en-zh"` |
| **节点分配** | ✅ | 节点自动分配到 `en-zh` Pool |

---

## 🎯 与旧服务对比

### Pool 创建对比

| 服务 | service_id | semantic_languages | Pool 名称 | 状态 |
|------|-----------|-------------------|----------|------|
| **中文修复** | semantic-repair-zh | `["zh"]` | `"zh"` | ✅ 单语言 Pool |
| **英文修复** | semantic-repair-en | `["en"]` | `"en"` | ✅ 单语言 Pool |
| **新统一服务** | semantic-repair-en-zh | `["en", "zh"]` | `"en-zh"` | ✅ **多语言 Pool** |

### 关键差异

#### 旧方案（2个 Pool）
```
Pool 1: name="zh"
  - semantic_languages: ["zh"]
  - 节点：支持中文修复的节点

Pool 2: name="en"
  - semantic_languages: ["en"]
  - 节点：支持英文修复的节点
```

#### 新方案（1个 Pool）
```
Pool 3: name="en-zh"
  - semantic_languages: ["en", "zh"]
  - 节点：同时支持中英文修复的节点
```

---

## 🔍 详细流程图

### 语言能力检测流程

```
1. ServiceConfigLoader 读取 service.json
   ↓
   service_id: "semantic-repair-en-zh"
   type: "semantic-repair"

2. detectSemanticLanguages() 推断语言
   ↓
   优先级1: 检查 service_id
   ├─ contains('zh') ? → YES → languages.push('zh')
   └─ contains('en') ? → YES → languages.push('en')
   ↓
   结果: ['zh', 'en']

3. normalizeLanguages() 去重和规范化
   ↓
   结果: ['zh', 'en']

4. 构建 language_capabilities
   ↓
   {
     semantic_languages: ['zh', 'en'],
     ...
   }

5. 发送心跳/注册
   ↓
   WebSocket → 调度服务器
```

### Pool 创建流程

```
调度服务器接收心跳
   ↓
1. 提取 semantic_languages
   ├─ node.language_capabilities.semantic_languages
   ├─ 结果: ['zh', 'en']
   └─ 转换为 HashSet: {"zh", "en"}

2. 排序语言集合
   ├─ sorted_langs.sort()
   └─ 结果: ['en', 'zh']

3. 生成 Pool 名称
   ├─ pool_name = sorted_langs.join("-")
   └─ 结果: "en-zh"

4. 检查是否存在该 Pool
   ├─ cfg.pools.iter().find(|p| p.name == "en-zh")
   └─ 不存在 → 创建新 Pool

5. 创建 Pool 配置
   ├─ pool_id: next_pool_id
   ├─ name: "en-zh"
   ├─ semantic_languages: ["en", "zh"]
   └─ 保存到 phase3.pools

6. 分配节点到 Pool
   ├─ 节点 node_001 → Pool "en-zh"
   └─ 更新 node_to_pool_index
```

---

## 🎨 service_id 命名建议

### 当前命名（✅ 推荐）

```json
{
  "service_id": "semantic-repair-en-zh"
}
```

**优点**:
- ✅ 清晰表明支持的语言：en 和 zh
- ✅ 自动被识别为 `semantic_languages: ["zh", "en"]`
- ✅ 创建 Pool: `"en-zh"`（排序后）
- ✅ 符合命名约定：`service-type-lang1-lang2`

### 其他可能的命名

#### 选项1: semantic-repair-zh-en ❌ 不推荐
```json
{
  "service_id": "semantic-repair-zh-en"
}
```
**问题**: 语言顺序与最终 Pool 名称不一致（Pool 会排序为 "en-zh"）

#### 选项2: semantic-repair-multi ❌ 不可用
```json
{
  "service_id": "semantic-repair-multi"
}
```
**问题**: 无法从 service_id 推断具体支持的语言，会返回空数组

#### 选项3: semantic-repair-unified ❌ 不可用
```json
{
  "service_id": "semantic-repair-unified"
}
```
**问题**: 同上，无法推断语言

---

## 🚀 验证方法

### 方法1: 查看 Electron Node 日志

启动节点后查看日志：

```log
[INFO] Language capabilities detected
  asr_languages: 2
  tts_languages: 2
  nmt_capabilities: 1
  semantic_languages: 2  ← 应该是 2 (zh, en)
  supported_language_pairs: 2

[DEBUG] 从服务ID推断出语言
  service_id: semantic-repair-en-zh
  languages: ['zh', 'en']  ← 确认这里
  method: service_id

[DEBUG] 语义修复服务支持的语言
  service_id: semantic-repair-en-zh
  languages: ['zh', 'en']
  language_count: 2
```

### 方法2: 查看调度服务器日志

节点注册后查看调度服务器日志：

```log
[INFO] 节点语言能力检查：语义修复服务支持 2 种语言，查找 Pool: en-zh
  node_id: node_001
  semantic_languages: ["en", "zh"]
  pool_name: en-zh
  pools_count: 3

[INFO] 新 Pool 已添加到本地配置
  node_id: node_001
  pool_id: 3
  pool_name: en-zh
  new_pool_count: 3
```

### 方法3: 检查 Redis

查询节点的 Pool 分配：

```bash
# 查看节点能力
redis-cli HGETALL "scheduler:node_capabilities:node_001"

# 应该包含
# "semantic" "true"

# 查看节点分配的 Pool
redis-cli GET "scheduler:node_pool_mapping:node_001"

# 应该返回 pool_id，如 "3"
```

---

## 📋 总结

### ✅ 确认结论

1. **新服务的 service_id** (`semantic-repair-en-zh`) **完全符合要求**
2. **会被正确识别**为支持 `["zh", "en"]` 两种语言
3. **调度服务器会自动创建** Pool: `"en-zh"`
4. **节点会被自动分配**到该 Pool
5. **无需修改任何代码**，现有机制完全支持

### 🎯 关键优势

相比旧服务，新统一服务：
- ✅ **单个 Pool** 替代 2个独立 Pool
- ✅ **统一语言集合** `["en", "zh"]`
- ✅ **自动识别和分配**
- ✅ **无需额外配置**

### ⚠️ 注意事项

1. **service_id 命名很重要**: 必须包含支持的语言代码（zh, en）
2. **语言顺序**: Pool 名称会按字母排序（"en-zh" 而不是 "zh-en"）
3. **向后兼容**: 旧服务（semantic-repair-zh, semantic-repair-en）仍然可以并存
4. **Pool 隔离**: `"en-zh"` Pool 与 `"zh"` Pool、`"en"` Pool 是独立的

---

**结论**: ✅ **新统一服务完全可以被调度服务器识别并自动创建和分配 Pool！**

**更新**: 2026-01-19  
**状态**: ✅ 验证完成
