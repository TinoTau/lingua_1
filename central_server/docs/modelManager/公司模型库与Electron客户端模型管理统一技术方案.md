# 公司模型库与 Electron 客户端模型管理统一技术方案（v3）

版本：v3.0  
作者：Tino（产品规划）  
适用对象：后端 / 基础设施 / Electron 客户端开发 / 推理引擎开发

> **注意**：本文档为 v3.0 版本，是可直接实施的最终规范。历史版本已归档。

---

# 0. v3 更新说明（基于开发部门 v2 检查清单的补强）

v3 版本在 v2 的基础上增加了以下成熟工程化方案：

1. **API 结构完全规范化**（models / versions / ranking 均提供正式 JSON Schema）。  
2. **下载策略明确采用"传输层 chunk，不做物理切割"**。  
3. **锁机制（任务锁 + 文件锁）采用 PID + timestamp + timeout 的成熟实现方式。**  
4. **多文件下载策略：限并发 3，单文件最多重试 3 次。**  
5. **getModelPath() 采用标准错误类型 ModelNotAvailableError，并增加调度服务器上报格式。**  
6. **registry.json 原子写入机制（tmp + rename）。**  
7. **客户端缺模型时不兜底，直接向调度服务器上报 MODEL_NOT_AVAILABLE。**  
8. **热门模型排行榜 API 标准化。**  
9. **测试方案整合开发侧建议，形成最终验收标准。**

本 v3 即为完整"可开发版本"，可直接进入实施阶段。

---

# 1. 公司模型库（Server）完整技术规范（v3）

## 1.1 模型存储目录结构（不做物理文件切割）

```
/storage/models/
  <model_id>/
    <version>/
      model.onnx
      model.onnx_data       # 可选
      tokenizer.json
      config.json
      checksum.sha256
      manifest.json         # 可选扩展字段
```

- 模型文件保持原样，不拆成 part1/part2。
- checksum 为 SHA256 列表，对应所有实际文件。

---

## 1.2 API 规范（正式版）

### 1）获取模型列表  
`GET /api/models`

```json
[
  {
    "id": "whisper-large-v3-zh",
    "name": "Whisper Large V3 中文增强版",
    "task": "asr",
    "languages": ["zh", "en"],
    "default_version": "1.0.0",

    "versions": [
      {
        "version": "1.0.0",
        "size_bytes": 1865432123,
        "files": [
          { "path": "model.onnx", "size_bytes": 123456789 },
          { "path": "tokenizer.json", "size_bytes": 456789 }
        ],
        "checksum_sha256": "abc123...",
        "updated_at": "2025-11-30T12:34:56Z"
      }
    ]
  }
]
```

---

### 2）获取单模型（可选）  
`GET /api/models/{model_id}`  
返回与上面单项结构一致。

---

### 3）单模型文件下载  
`GET /storage/models/{model_id}/{version}/{file_path}`

服务端要求：

- 必须支持 `Range` 断点续传  
- 必须返回：
  ```
  Accept-Ranges: bytes
  Content-Range: bytes <start>-<end>/<total>
  ```

---

### 4）热门模型排行 API  
`GET /api/model-usage/ranking`

```json
[
  { "model_id": "marian-zh-en", "request_count": 18234, "rank": 1 },
  { "model_id": "whisper-large-v3-zh", "request_count": 15321, "rank": 2 }
]
```

---

# 2. Electron 客户端 ModelManager（v3）

## 2.1 下载策略（正式确定）

### 采用：
- **传输层 chunk（例如每次 1MB）**  
- **断点续传（使用 Range）**  
- **本地写入 .part 文件 → 完成后 rename**  
- **SHA256 校验**

### 不采用：
- 物理层文件切割（part1, part2...）

理由：

- 成熟度最高、最稳定、兼容性最好  
- 对调度系统影响最小  
- 不增加模型库复杂度

---

## 2.2 并发控制

### **任务锁（Task Lock）**

```
in-progress-downloads/
  whisper-large-v3-zh_1.0.0.lock
```

锁文件内容：

```json
{
  "pid": 12345,
  "timestamp": 1733960000000,
  "modelId": "whisper-large-v3-zh",
  "version": "1.0.0",
  "timeout": 1800000   // 30 min
}
```

策略：

- 同一模型只能存在一个下载任务  
- 启动客户端时必须清理孤儿锁  

---

### **文件锁（File Lock）**

```
models/temp/<modelId>_<version>.<filename>.part.lock
```

超时：5 分钟  
崩溃后下次启动自动恢复。

---

## 2.3 多文件下载策略（成熟方案）

- **单模型内部多文件限并发数：3**
- **每个文件重试最多：3 次（网络错误）**
- **失败文件不删除成功文件，下次仅补下载失败部分**

这与 npm / pip / Homebrew 多文件资源管理策略一致。

---

## 2.4 getModelPath() 标准错误类型

```ts
class ModelNotAvailableError extends Error {
  constructor(
    public modelId: string,
    public version: string,
    public reason: 
      | 'not_installed'
      | 'downloading'
      | 'verifying'
      | 'error'
  ) {
    super(`Model ${modelId}@${version} unavailable: ${reason}`);
  }
}
```

业务统一处理：

```ts
try {
  const path = await getModelPath(modelId, version);
} catch (e) {
  if (e instanceof ModelNotAvailableError) {
    reportModelNotAvailable(e);
    return;
  }
}
```

---

## 2.5 上报调度服务器的格式（正式标准）

```json
{
  "type": "MODEL_NOT_AVAILABLE",
  "node_id": "node-23",
  "job_id": "job-88921",
  "model_id": "marian-zh-en",
  "version": "2.1.0",
  "reason": "not_installed"
}
```

客户端永不兜底运算，由调度服务器重分配。

---

## 2.6 registry.json 原子写入

```
write temp file (.tmp)
fsync()
rename → registry.json
```

这是跨平台最成熟的桌面应用写配置文件方式。

---

# 3. 模型管理 UI（v3）

## 3.1 需要展示：

- 模型列表（从 /api/models 获取）  
- 每个模型的安装状态  
- 下载进度（percent）  
- 错误状态  
- 热门模型排行榜（从 /api/model-usage/ranking 获取）  

---

# 4. v3 测试方案（最终版）

## 4.1 单模型下载测试

### 小模型 (<100MB)
- 断网恢复  
- 重启续传  
- 校验失败自动重试  
- 删除 .part 能正常恢复  

### 大模型 (>1GB)
- 下载内存稳定  
- chunk 下载准确  
- 断点续传可靠  

---

## 4.2 并发测试

| 场景 | 标准 |
|------|------|
| 连续点击下载 | 仅创建 1 个真实任务 |
| 同时多线程请求 getModelPath | 无死锁、无重复下载 |
| 下载多个不同模型 | 能稳定并发且不互锁 |

---

## 4.3 锁机制测试

- 崩溃 → 重启自动清理 lock  
- 文件锁竞争 → 后发任务阻塞或拒绝  
- 超时自动释放锁  

---

## 4.4 registry.json 测试

- 原子写入必不损坏文件  
- registry.json 手动损坏 → 自动重建  
- 多版本共存正常读取  

---

## 4.5 调度系统联调测试

流程：

1. getModelPath() 抛异常  
2. Node agent 捕获后发送 MODEL_NOT_AVAILABLE  
3. 调度服务器重新调度  
4. 整体耗时 < 300ms（内部目标）

---

# 5. 验收标准（v3 最终）

1. 无重复下载  
2. 锁机制可恢复  
3. 断点续传稳定  
4. 多文件下载不冲突  
5. registry.json 原子写入  
6. MODEL_NOT_AVAILABLE 回调稳定  
7. 热门模型排行展示正确  
8. 大小模型全部通过测试  

---

# 6. 结语

v3 是在与开发团队对齐后形成的**可直接实施的最终规范**，包含：

- 清晰边界  
- 明确 API  
- 工程级的锁机制  
- 成熟的下载架构  
- 调度系统对接标准  
- 完整测试与验收标准  

可直接进入开发阶段。

---

## 附录

### A. 方案演进历史

#### v1.0 → v2.0 主要变更
- 不需要考虑现有用户迁移，但要确保未来版本更新具备前向兼容能力
- 不引入多环境隔离（dev/staging/prod），维持单环境模型库
- 必须防止重复下载、并发冲突与多任务竞态条件，新增文件锁与任务锁设计
- 日志与监控为未来独立模块，本期不实现，但方案中预留接口（钩子 hooks）
- 不需要用户提示文案，但保留业务错误类型分类
- 下载体验改为：客户端仅负责运算，不负责兜底
- 不需要版本回滚机制：模型更新由公司统一维护
- 新增测试方案：测试要点 + 验收标准

#### v2.0 → v3.0 主要变更
- API 结构完全规范化（models / versions / ranking 均提供正式 JSON Schema）
- 下载策略明确采用"传输层 chunk，不做物理切割"
- 锁机制（任务锁 + 文件锁）采用 PID + timestamp + timeout 的成熟实现方式
- 多文件下载策略：限并发 3，单文件最多重试 3 次
- getModelPath() 采用标准错误类型 ModelNotAvailableError，并增加调度服务器上报格式
- registry.json 原子写入机制（tmp + rename）
- 客户端缺模型时不兜底，直接向调度服务器上报 MODEL_NOT_AVAILABLE
- 热门模型排行榜 API 标准化
- 测试方案整合开发侧建议，形成最终验收标准

### B. 开发前检查清单

#### ✅ v3 已解决的问题
1. ✅ **API 格式已明确** - 所有 API 的响应格式都已规范化
2. ✅ **锁机制细节已完善** - 锁文件格式、超时时间都已明确
3. ✅ **错误处理策略已明确** - ModelNotAvailableError 类型和上报格式已定义
4. ✅ **多文件下载策略已明确** - 并发数、重试次数都已确定
5. ✅ **registry.json 原子写入已明确** - tmp + rename 方案已确定
6. ✅ **热门模型排行 API 已标准化**

#### ⚠️ 开发时需要注意的细节

1. **文件下载接口的安全防护**
   - 路径遍历攻击防护（防止 `../../../etc/passwd` 等）
   - 文件不存在时的错误响应格式
   - 路径规范化验证

2. **错误处理细节**
   - 网络错误的自动重试机制（指数退避）
   - 磁盘空间不足时的处理
   - 校验失败时的清理逻辑

3. **性能优化**
   - 大文件下载的内存使用
   - 并发下载的带宽控制
   - registry.json 的读写性能

### C. 可行性评估总结

#### ✅ 已实现的部分
1. **ModelManager 基础框架**
   - ✅ 已实现 `ModelManager` 类
   - ✅ 已实现非 C 盘路径检测（`findAlternativePath`）
   - ✅ 已实现基础的模型安装/卸载功能
   - ✅ 已实现 SHA256 校验
   - ✅ 已实现 IPC 接口

2. **模型库服务**
   - ✅ 已有 `model-hub` 服务（FastAPI）
   - ✅ 已实现 `/api/v1/models` 接口
   - ✅ 已实现模型元数据结构

#### ✅ 已完成的改进
1. ✅ API 响应格式已调整为嵌套结构，支持多版本
2. ✅ 文件下载接口已实现，支持 Range 请求
3. ✅ checksum.sha256 文件已支持
4. ✅ 目录结构已调整为版本化结构
5. ✅ 断点续传已实现
6. ✅ 多文件并发下载已实现
7. ✅ 任务锁和文件锁机制已实现
8. ✅ registry.json 原子写入已实现
9. ✅ ModelNotAvailableError 错误处理已实现
10. ✅ 进度事件推送已实现
11. ✅ 模型管理 UI 已实现
12. ✅ 单元测试已完成（39/44 通过，88.6%）

### D. 参考文档

- [方案可行性评估](./方案可行性评估.md) - v1 方案可行性评估（历史参考）
- [v2方案开发前检查清单](./v2方案开发前检查清单.md) - v2 方案检查清单（历史参考）
- [v3方案最终检查](./v3方案最终检查.md) - v3 方案最终检查报告（历史参考）
