# Mock ASR 流程测试说明

## 一、仅测服务（不启动节点）

用于确认 **语义修复服务**、**NMT** 能正确修复长句并翻译。

1. 启动语义修复服务（在 `electron_node/services/semantic_repair_en_zh` 下）：
   ```powershell
   .\venv\Scripts\python.exe service.py
   ```
2. 若需测 NMT，再启动 nmt-m2m100（端口 5008）。
3. 在项目根执行：
   ```powershell
   node electron-node/tests/run-mock-asr-pipeline.js
   ```
4. 脚本会使用固定长句（模拟 ASR 识别结果）调用 `/repair`，再调用 NMT，并打印修复结果与译文。

---

## 二、在节点端跑完整 Pipeline（聚合 → 语义修复 → 去重 → NMT）

用于验证 **节点端** 从 Mock ASR 到 NMT 的整条链路。

1. **编译并启动节点**
   ```powershell
   cd electron-node
   npm run build:main
   npm start
   ```

2. **启动语义修复服务**  
   在应用里用「服务管理」启动 `semantic-repair-en-zh`，或保证配置里 `semanticRepairEnZhEnabled !== false` 以自动启动。

3. **确保 NMT 可用**  
   若 pipeline 含翻译，需 NMT 服务（如 nmt-m2m100）已启动并被节点发现。

4. **触发 Mock ASR 流程**  
   在应用窗口按 F12 打开 DevTools，在 Console 中执行（可整段粘贴）：

   ```javascript
   const asrText = `接下来追 继续我会尽量地连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后 系统会不会因为操实或者定音判定而挑释把这句话阶段从来到之前 可以拆分成两个不同的任务 甚至出现 在予议上不完整 堵起来前后不连关的情况`;
   const result = await window.electronAPI.runPipelineWithMockAsr(asrText, 'zh', 'en');
   console.log('修复后 text_asr:', result.text_asr);
   console.log('翻译 text_translated:', result.text_translated);
   console.log('语义修复是否应用:', result.semantic_repair_applied);
   ```

5. **期望**  
   - `result.text_asr` 为修复后的中文（更接近「接下来这一句我会尽量连续地说得长一些…」等正确语句）。  
   - `result.text_translated` 为对应英文译文。  
   - `result.semantic_repair_applied` 在发生修复时为 `true`。

若语义修复服务未就绪或未注册，`runPipelineWithMockAsr` 会抛错，请先确认服务已启动且节点能发现 `semantic-repair-en-zh`。

**说明**：中文修复（zh_repair）依赖 GGUF 模型；若服务返回 503，多为模型未放置或未加载，请参考 `electron_node/services/semantic_repair_en_zh/MODELS_SETUP_GUIDE.md` 配置模型。
