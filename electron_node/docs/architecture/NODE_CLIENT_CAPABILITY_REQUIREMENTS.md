# 节点客户端能力上报规范

**版本**: V2.0（有向语言对版本）  
**日期**: 2026-01-21  
**适用于**: 新 Pool 系统（PoolService - DirectedLangPair）

---

## 🎯 重大更新（V2.0）

### 核心变更

1. **语言池从无方向改为有向**：
   - 旧版：`LangSet = ["zh", "en"]`（无方向）
   - 新版：`DirectedLangPair { src: "zh", tgt: "en" }`（有方向）

2. **Semantic 服务变为必需**：
   - 所有节点必须安装 Semantic 服务
   - `semantic_languages` 不能为空
   - 只有 Semantic 支持的语言才能作为目标语言

3. **上报格式变更**：
   - 使用 `asr_languages` + `semantic_languages`
   - 服务端自动生成有向语言对

---

## 一、核心原则

新 Pool 系统采用**极简设计 + 有向语言对**，将复杂的能力检查逻辑移到节点端，服务端只做简单的池管理。

**节点端责任**：
- ✅ 确保上报的语言能力是完整且可用的
- ✅ 只在所有必需服务就绪时才上报语言
- ✅ **Semantic 服务是必需的**（新增）
- ✅ 服务能力变化时重新连接

**服务端责任**：
- ✅ 按有向语言对（src:tgt）分组节点
- ✅ 自动分配池
- ✅ 随机选择节点
- ✅ 区分 finalize 类型（Manual/Pause/Timeout）

---

## 二、能力上报规范（V2.0 - 有向语言对版本）

### 2.1 上报格式变更

#### 新格式

```javascript
{
    "asr_languages": ["zh", "en", "de"],      // ASR 识别的源语言
    "tts_languages": ["zh", "en"],            // TTS 合成的目标语言
    "semantic_languages": ["zh", "en"]        // Semantic 支持的语言（必需）
}
```

#### 服务端处理逻辑

服务端会根据 `asr_languages` 和 `semantic_languages` 自动生成所有有向语言对：

```
有向语言对 = asr_languages × semantic_languages

例如：
  asr_languages: ['zh', 'en', 'de']
  semantic_languages: ['zh', 'en']
  
  生成 6 个有向语言对：
  - zh→zh, zh→en
  - en→zh, en→en
  - de→zh, de→en
```

**节点会被分配到所有对应的有向池中。**

### 2.2 基础服务能力（ASR + NMT + TTS + Semantic）

#### 规则

**只有在以下四个服务都就绪时，才能上报语言**：

1. **ASR**（语音识别）：能够识别源语言
2. **NMT**（翻译）：能够翻译 src→tgt
3. **TTS**（语音合成）：能够合成目标语言
4. **Semantic**（语义修复）：能够修复目标语言（**必需**）

#### 示例（正确 - V2.0 格式）

```javascript
// 检查所有服务状态
const asrLangs = getReadyLanguages('asr');           // → ['zh', 'en', 'de']
const nmtPairs = getReadyPairs('nmt');               // → [zh→en, en→zh, ...]
const ttsLangs = getReadyLanguages('tts');           // → ['zh', 'en']
const semanticLangs = getReadyLanguages('semantic'); // → ['zh', 'en'] (必需)

// ✅ 正确：只上报所有服务都支持的语言
const supportedAsrLangs = asrLangs.filter(lang => 
    nmtPairs.some(pair => pair.src === lang) && 
    ttsLangs.some(tgt => nmtPairs.some(pair => pair.src === lang && pair.tgt === tgt))
);

const supportedSemanticLangs = semanticLangs.filter(lang => 
    ttsLangs.includes(lang) && 
    nmtPairs.some(pair => pair.tgt === lang)
);

// 上报格式
nodeRegister.language_capabilities = {
    asr_languages: supportedAsrLangs,        // ['zh', 'en', 'de']
    tts_languages: supportedSemanticLangs,   // ['zh', 'en']
    semantic_languages: supportedSemanticLangs // ['zh', 'en'] (必需)
};

// 服务端会生成 6 个有向语言对：
// zh→zh, zh→en, en→zh, en→en, de→zh, de→en
```

#### 反例（错误）

```javascript
// ❌ 错误1：semantic_languages 为空
nodeRegister.language_capabilities = {
    asr_languages: ['zh', 'en'],
    tts_languages: ['zh', 'en'],
    semantic_languages: []  // ❌ Semantic 服务是必需的！
};
// 结果：节点注册失败

// ❌ 错误2：上报了不支持的语言
nodeRegister.language_capabilities = {
    asr_languages: ['zh', 'en', 'de'],
    semantic_languages: ['zh', 'en', 'de']  // ❌ 但 Semantic 实际只支持 zh, en
};
// 结果：de→de 任务会失败（Semantic 不支持）

// ❌ 错误3：只检查了 NMT，没检查其他服务
const nmtReady = checkServiceReady('nmt');
if (nmtReady) {
    nodeRegister.language_capabilities.asr_languages = ['zh', 'en'];
}
// 结果：ASR、TTS 或 Semantic 可能未就绪，任务会失败
```

### 2.3 Semantic（语义修复）服务 ⚠️ 必需

#### 新规则（V2.0）

**Semantic 服务是必需的**，所有节点必须满足：

1. ✅ Semantic 服务必须安装并就绪
2. ✅ `semantic_languages` 不能为空
3. ✅ **只有 Semantic 支持的语言才能作为目标语言**
4. ✅ Semantic 支持的语言必须包含 TTS 支持的所有语言

#### 为什么 Semantic 是必需的？

- Semantic 是翻译质量的核心保证
- 目标语言（tgt）的定义基于 Semantic 支持的语言
- 简化了服务端的语言能力管理逻辑

#### 示例（正确 - V2.0 格式）

```javascript
// ✅ 正确：场景 1 - 对称支持
const semanticLangs = getSemanticSupportedLanguages();  // → ['zh', 'en']
nodeRegister.language_capabilities = {
    asr_languages: ['zh', 'en'],
    tts_languages: ['zh', 'en'],
    semantic_languages: ['zh', 'en']  // ✅ 所有语言都支持
};
// 生成 4 个有向池：zh→zh, zh→en, en→zh, en→en

// ✅ 正确：场景 2 - 非对称支持
nodeRegister.language_capabilities = {
    asr_languages: ['zh', 'en', 'de'],  // 识别 3 种语言
    tts_languages: ['zh', 'en'],        // 只能输出 2 种语言
    semantic_languages: ['zh', 'en']    // Semantic 只支持 2 种语言
};
// 生成 6 个有向池：zh→zh, zh→en, en→zh, en→en, de→zh, de→en
// 注意：不会生成 de→de（因为 Semantic 不支持德语作为目标语言）
```

#### 反例（错误 - V2.0）

```javascript
// ❌ 错误 1：semantic_languages 为空
nodeRegister.language_capabilities = {
    asr_languages: ['zh', 'en'],
    tts_languages: ['zh', 'en'],
    semantic_languages: []  // ❌ 必需！
};
// 结果：节点注册失败，错误信息："semantic_languages cannot be empty. Semantic service is mandatory"

// ❌ 错误 2：semantic_languages 超出实际支持范围
const actualSemanticLangs = ['zh', 'en'];  // 实际只支持中英
nodeRegister.language_capabilities = {
    asr_languages: ['zh', 'en', 'de'],
    semantic_languages: ['zh', 'en', 'de']  // ❌ 虚报了 'de'
};
// 结果：de→de 任务会失败

// ❌ 错误 3：上报了不带 Semantic 的语言对（旧格式）
supported_language_pairs.push({src: 'zh', tgt: 'en'});
semantic_languages = ['zh'];  // 只支持中文

// 结果：英文的 Semantic Repair 会失败
```

#### 降级处理

**如果节点没有 Semantic 服务**：
- 可以上报 supported_language_pairs
- 不上报 semantic_languages
- 服务端会跳过 Semantic 处理（降级）

---

## 三、服务状态变化处理

### 3.1 服务启动时

```javascript
// 场景：节点启动，服务逐个加载
// 规则：只有在所有服务就绪后才连接调度服务器

async function startNode() {
    // 1. 启动服务
    await startASRService();
    await startNMTService();
    await startTTSService();
    await startSemanticService();  // 可选
    
    // 2. 等待所有服务就绪
    await waitForServicesReady(['asr', 'nmt', 'tts']);
    
    // 3. 连接调度服务器
    await connectToScheduler();
    
    // 4. 发送注册消息
    await sendNodeRegister({
        language_capabilities: {
            supported_language_pairs: getReadyLanguagePairs(),
            semantic_languages: getSemanticLanguages()  // 可选
        }
    });
}
```

### 3.2 服务热插拔（增加语言）

```javascript
// 场景：节点运行时增加新的语言能力
// 规则：断开连接，重新连接

async function onLanguageCapabilityAdded(newLang) {
    console.log(`增加了新语言能力: ${newLang}`);
    
    // 1. 断开与调度服务器的连接
    await disconnectFromScheduler();
    
    // 2. 等待新服务就绪
    await waitForNewLanguageReady(newLang);
    
    // 3. 重新连接
    await connectToScheduler();
    
    // 4. 重新注册（会更新 lang_sets）
    await sendNodeRegister({
        language_capabilities: {
            supported_language_pairs: getReadyLanguagePairs()  // 包含新语言
        }
    });
}
```

### 3.3 服务故障（移除语言）

```javascript
// 场景：某个服务故障，无法处理任务
// 规则：断开连接，修复后重新连接

async function onServiceFailed(serviceType, lang) {
    console.error(`服务故障: ${serviceType}, 语言: ${lang}`);
    
    // 1. 立即断开连接（避免被分配新任务）
    await disconnectFromScheduler();
    
    // 2. 尝试修复服务
    await tryFixService(serviceType, lang);
    
    // 3. 如果修复成功，重新连接
    if (serviceFixed) {
        await connectToScheduler();
    }
}
```

---

## 四、完整示例

### 4.1 节点注册消息（推荐格式）

```json
{
    "type": "node_register",
    "node_id": "node-001",
    "version": "1.0.0",
    "platform": "linux",
    "hardware": {
        "cpu_cores": 8,
        "memory_gb": 32,
        "gpus": [{"name": "RTX 4090", "memory_gb": 24}]
    },
    "installed_models": [...],
    "installed_services": [
        {"service_id": "asr-zh", "type": "asr", "status": "running"},
        {"service_id": "nmt-zh-en", "type": "nmt", "status": "running"},
        {"service_id": "tts-en", "type": "tts", "status": "running"},
        {"service_id": "semantic-zh-en", "type": "semantic", "status": "running"}
    ],
    "capability_by_type": [
        {"type": "asr", "ready": true},
        {"type": "nmt", "ready": true},
        {"type": "tts", "ready": true},
        {"type": "semantic", "ready": true}
    ],
    "language_capabilities": {
        "supported_language_pairs": [
            {"src": "zh", "tgt": "en"}
        ],
        "semantic_languages": ["zh", "en"]
    }
}
```

### 4.2 服务就绪检查流程

```javascript
class NodeCapabilityManager {
    // 检查语言对是否完整
    isLanguagePairReady(src, tgt) {
        // 1. 检查 ASR（源语言）
        if (!this.asrService.supportsLanguage(src)) {
            return false;
        }
        
        // 2. 检查 NMT（翻译）
        if (!this.nmtService.canTranslate(src, tgt)) {
            return false;
        }
        
        // 3. 检查 TTS（目标语言）
        if (!this.ttsService.supportsLanguage(tgt)) {
            return false;
        }
        
        // ✅ 所有服务就绪
        return true;
    }
    
    // 获取所有就绪的语言对
    getReadyLanguagePairs() {
        const pairs = [];
        
        for (const src of this.asrService.supportedLanguages) {
            for (const tgt of this.ttsService.supportedLanguages) {
                if (this.nmtService.canTranslate(src, tgt)) {
                    // ✅ 完整的语言对
                    if (this.isLanguagePairReady(src, tgt)) {
                        pairs.push({src, tgt});
                    }
                }
            }
        }
        
        return pairs;
    }
    
    // 获取 Semantic 支持的语言
    getSemanticLanguages() {
        if (!this.semanticService || !this.semanticService.ready) {
            return undefined;  // Semantic 不可用
        }
        
        return this.semanticService.supportedLanguages;
    }
}
```

---

## 五、常见问题

### Q1: 为什么不能在服务部分就绪时就上报？

**A**: 会导致调度失败

**错误示例**：
```javascript
// ❌ 只有 NMT 就绪
if (nmt.ready) {
    supported_language_pairs.push({src: 'zh', tgt: 'en'});
}

// 调度服务器分配任务到该节点
// → ASR 失败（服务未就绪）
// → 任务失败
```

**正确做法**：
```javascript
// ✅ 等待所有服务就绪
if (asr.ready && nmt.ready && tts.ready) {
    supported_language_pairs.push({src: 'zh', tgt: 'en'});
}
```

### Q2: Semantic 服务是必需的吗？

**A**: 不是必需的，但如果有，必须正确上报

- **没有 Semantic**：可以正常处理任务（跳过 Semantic 处理）
- **有 Semantic**：必须在 semantic_languages 中上报支持的语言

**示例**：
```javascript
// ✅ 方式 1：没有 Semantic 服务
{
    "supported_language_pairs": [{"src": "zh", "tgt": "en"}],
    "semantic_languages": undefined  // 不上报
}

// ✅ 方式 2：有 Semantic 服务
{
    "supported_language_pairs": [{"src": "zh", "tgt": "en"}],
    "semantic_languages": ["zh", "en"]  // 完整支持
}

// ❌ 错误：Semantic 只支持部分语言
{
    "supported_language_pairs": [{"src": "zh", "tgt": "en"}],
    "semantic_languages": ["zh"]  // 只支持中文，英文会失败
}
```

### Q3: 如果服务在运行时失败怎么办？

**A**: 断开连接，避免被分配新任务

```javascript
asrService.on('error', async () => {
    console.error('ASR 服务故障');
    
    // 1. 断开与调度服务器的连接
    await disconnectFromScheduler();
    
    // 2. 尝试修复
    await tryRestartService('asr');
    
    // 3. 修复成功后重新连接
    if (asrService.ready) {
        await connectToScheduler();
    }
});
```

### Q4: 增加新语言能力后，旧的 Pool 会怎样？

**A**: 需要重新连接，服务端会重新分配

**场景**：
```
初始：节点支持 ["zh", "en"]
  → 分配到 Pool "["en","zh"]:0"

增加德语：节点支持 ["zh", "en", "de"]
  → 断开连接
  → 重新连接
  → 重新注册（lang_sets = [["en","zh"], ["de","en"], ["de","zh"], ["de","en","zh"]]）
  → 心跳时重新分配
  → 可能分配到多个 Pool
```

**注意**：服务端**不会自动**从旧 Pool 中移除节点，需要：
- 断开连接（触发下线清理）
- 重新连接（重新分配）

---

## 六、检查清单

### 节点启动时

- [ ] 等待 ASR 服务就绪
- [ ] 等待 NMT 服务就绪
- [ ] 等待 TTS 服务就绪
- [ ] 检查每个语言对的完整性
- [ ] 只上报完整的语言对
- [ ] 如果有 Semantic，检查语言支持
- [ ] 连接调度服务器
- [ ] 发送注册消息

### 服务运行时

- [ ] 监控服务健康状态
- [ ] 服务故障时断开连接
- [ ] 服务恢复后重新连接
- [ ] 增加新语言时重新连接

### 心跳时

- [ ] 定期发送心跳（30秒）
- [ ] 心跳失败时尝试重连
- [ ] 不需要在心跳中更新能力（除非重连）

---

## 七、代码模板

### 7.1 完整的能力检查

```javascript
class LanguageCapabilityChecker {
    constructor(asrService, nmtService, ttsService, semanticService) {
        this.asr = asrService;
        this.nmt = nmtService;
        this.tts = ttsService;
        this.semantic = semanticService;
    }
    
    // 检查单个语言对是否完整
    isPairComplete(src, tgt) {
        // 1. ASR 必须支持源语言
        if (!this.asr.supportsLanguage(src)) {
            return false;
        }
        
        // 2. NMT 必须支持 src→tgt
        if (!this.nmt.canTranslate(src, tgt)) {
            return false;
        }
        
        // 3. TTS 必须支持目标语言
        if (!this.tts.supportsLanguage(tgt)) {
            return false;
        }
        
        return true;
    }
    
    // 获取所有完整的语言对
    getAllReadyPairs() {
        const pairs = [];
        const asrLangs = this.asr.supportedLanguages;  // ['zh', 'en']
        const ttsLangs = this.tts.supportedLanguages;  // ['zh', 'en']
        
        for (const src of asrLangs) {
            for (const tgt of ttsLangs) {
                if (src !== tgt && this.isPairComplete(src, tgt)) {
                    pairs.push({src, tgt});
                }
            }
        }
        
        return pairs;
    }
    
    // 获取 Semantic 支持的语言（可选）
    getSemanticLanguages() {
        if (!this.semantic || !this.semantic.ready) {
            return undefined;
        }
        
        // 返回 Semantic 服务支持的所有语言
        return this.semantic.supportedLanguages;  // ['zh', 'en']
    }
    
    // 生成注册消息
    generateCapabilities() {
        const pairs = this.getAllReadyPairs();
        const semanticLangs = this.getSemanticLanguages();
        
        return {
            supported_language_pairs: pairs,
            semantic_languages: semanticLangs
        };
    }
}
```

### 7.2 服务监控和重连

```javascript
class ServiceHealthMonitor {
    constructor(nodeClient) {
        this.nodeClient = nodeClient;
        this.connected = false;
    }
    
    // 监控服务健康
    startMonitoring() {
        // 每 10 秒检查一次
        setInterval(() => {
            this.checkHealth();
        }, 10000);
    }
    
    async checkHealth() {
        const allReady = this.checkAllServicesReady();
        
        if (!allReady && this.connected) {
            // 服务不就绪但仍连接 → 断开
            console.warn('服务不就绪，断开连接');
            await this.nodeClient.disconnect();
            this.connected = false;
        } else if (allReady && !this.connected) {
            // 服务就绪但未连接 → 重连
            console.log('服务已就绪，尝试重连');
            await this.nodeClient.connect();
            this.connected = true;
        }
    }
    
    checkAllServicesReady() {
        return this.asr.ready && 
               this.nmt.ready && 
               this.tts.ready;
    }
}
```

---

## 八、测试验证

### 8.1 单元测试

```javascript
describe('LanguageCapabilityChecker', () => {
    test('只在所有服务就绪时上报语言对', () => {
        const checker = new LanguageCapabilityChecker(
            mockASR(['zh']),      // 只支持中文
            mockNMT('zh', 'en'),  // 支持中英翻译
            mockTTS(['en'])       // 只支持英文
        );
        
        const pairs = checker.getAllReadyPairs();
        
        // ✅ 应该只有 zh→en（完整）
        expect(pairs).toEqual([{src: 'zh', tgt: 'en'}]);
        
        // ❌ 不应该有 en→zh（ASR 不支持英文）
        expect(pairs).not.toContainEqual({src: 'en', tgt: 'zh'});
    });
    
    test('Semantic 只上报支持的语言', () => {
        const checker = new LanguageCapabilityChecker(
            mockASR(['zh', 'en']),
            mockNMT('any', 'any'),
            mockTTS(['zh', 'en']),
            mockSemantic(['zh'])  // 只支持中文
        );
        
        const langs = checker.getSemanticLanguages();
        
        // ✅ 应该只有中文
        expect(langs).toEqual(['zh']);
        
        // ❌ 不应该包含英文
        expect(langs).not.toContain('en');
    });
});
```

### 8.2 集成测试

```javascript
describe('Node Registration', () => {
    test('只在服务就绪时连接', async () => {
        const node = new NodeClient();
        
        // 1. 服务未就绪，不应该连接
        node.asr.ready = false;
        await node.tryConnect();
        expect(node.connected).toBe(false);
        
        // 2. 服务就绪，应该连接成功
        node.asr.ready = true;
        node.nmt.ready = true;
        node.tts.ready = true;
        await node.tryConnect();
        expect(node.connected).toBe(true);
    });
});
```

---

## 九、错误处理

### 9.1 服务不完整时的错误

```javascript
// 如果节点上报了不完整的语言对
// 调度服务器会分配任务，但节点处理会失败

// 节点端应该返回明确的错误
{
    "type": "job_result",
    "job_id": "job-123",
    "status": "error",
    "error": "SERVICE_NOT_READY",
    "error_details": {
        "service": "asr",
        "language": "en",
        "reason": "ASR service for 'en' is not ready"
    }
}
```

### 9.2 Semantic 失败时的降级

```javascript
// 节点端应该支持 Semantic 失败时的降级处理

async function processJob(job) {
    const asrResult = await asr.process(job.audio);
    const nmtResult = await nmt.translate(asrResult.text);
    
    // 尝试 Semantic Repair
    let finalText = nmtResult.text;
    try {
        if (semantic && semantic.ready) {
            const semanticResult = await semantic.repair(finalText);
            finalText = semanticResult.text;
        }
    } catch (e) {
        console.warn('Semantic repair failed, using NMT result', e);
        // 降级：使用 NMT 的结果
    }
    
    const ttsResult = await tts.synthesize(finalText);
    return ttsResult;
}
```

---

## 十、总结

### 节点端必须保证

1. ✅ **服务完整性**：ASR + NMT + TTS 都就绪
2. ✅ **Semantic 可选**：如果有，必须支持完整语言
3. ✅ **能力变化重连**：增加/移除语言时重新连接
4. ✅ **故障处理**：服务失败时断开连接

### 服务端极简设计

1. ✅ **信任节点端**：不检查服务能力
2. ✅ **按语言分组**：只关心语言集合
3. ✅ **自动分配池**：心跳时按需创建
4. ✅ **Job 绑定**：finalize 一致性

### 核心理念

> **复杂性下沉到节点端，服务端保持极简**

- 节点端：完整的能力检查和监控
- 服务端：简单的池管理和随机选择

---

**版本**: V1.0  
**最后更新**: 2026-01-21  
**维护人**: AI Assistant
