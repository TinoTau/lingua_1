# NMT服务404错误修复总结

**日期**: 2025-12-25  
**问题**: NMT服务返回404错误，导致整个pipeline失败  
**状态**: ✅ **已修复**

---

## 问题根源

### 错误现象
- 调度服务器报错: `ERROR Job processing failed trace_id=dff4fb04-7c98-4b61-a983-faa35f6f9842 job_id=job-556E716C`
- 节点端日志显示: `Request failed with status code 404`
- 请求URL: `http://127.0.0.1:5008/v1/nmt/translate`

### 根本原因

**端点路径不匹配**：
- **节点端请求**: `/v1/nmt/translate`
- **NMT服务实际端点**: `/v1/translate`

从NMT服务代码 (`electron_node/services/nmt_m2m100/nmt_service.py`) 可以看到：
```python
@app.post("/v1/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest) -> TranslateResponse:
```

---

## 修复方案

### 修改文件
`electron_node/electron-node/main/src/task-router/task-router.ts`

### 修改内容
将NMT任务的端点路径从 `/v1/nmt/translate` 改为 `/v1/translate`：

```typescript
// 修改前
const response = await httpClient.post('/v1/nmt/translate', {
  text: task.text,
  src_lang: task.src_lang,
  tgt_lang: task.tgt_lang,
  context_text: task.context_text,
}, {

// 修改后
const response = await httpClient.post('/v1/translate', {
  text: task.text,
  src_lang: task.src_lang,
  tgt_lang: task.tgt_lang,
  context_text: task.context_text,
}, {
```

---

## 验证

### 修复前
- faster-whisper-vad: ✅ 成功（200 OK）
- NMT: ❌ 失败（404 Not Found）
- Pipeline: ❌ 失败

### 修复后（预期）
- faster-whisper-vad: ✅ 成功（200 OK）
- NMT: ✅ 成功（200 OK）
- Pipeline: ✅ 成功

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 已修复
- `electron_node/services/nmt_m2m100/nmt_service.py` - NMT服务端点定义
- `electron_node/services/faster_whisper_vad/docs/NMT_404_ERROR_ANALYSIS.md` - 问题分析文档

---

## 注意事项

1. **faster-whisper-vad服务工作正常**：Plan A Opus解码和ASR识别都正常
2. **问题出在NMT服务**：端点路径配置错误
3. **需要重新编译节点端**：修改TypeScript代码后需要重新编译
4. **需要重启节点端**：修复后需要重启节点端以应用更改

