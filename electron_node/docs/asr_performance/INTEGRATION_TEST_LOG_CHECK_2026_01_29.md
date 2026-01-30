# 集成测试后如何检查节点端日志（各 Job 在各服务中的处理过程）

## 1. 日志文件位置

- **主进程日志**：`electron_node/electron-node/logs/electron-main.log`
- 以实际启动时的「当前工作目录」为准；启动时控制台会打印 `[Logger] Log file path: ...`，以该输出为准。
- 若在 `electron_node/electron-node` 下执行 `npm start`，则日志路径即为上述路径。

## 2. 用脚本生成「按 Job 各服务输入/输出」报告

在 **electron_node** 目录下执行（将 `<logPath>` 换成你的实际日志路径，例如 `electron-node/logs/electron-main.log`）：

```bash
node scripts/analyze_jobs_per_service_flow.js <logPath>
```

**输出 Markdown 报告到文件**（便于存档或提交）：

```bash
node scripts/analyze_jobs_per_service_flow.js electron-node/logs/electron-main.log --out electron-node/logs/docs/asr_performance/JOB_SERVICE_FLOW_REPORT.md
```

脚本会：

- 按 **utterance_index** 排序，逐个 Job 列出：
  - **[ASR]** 输出（asrText / asrTextPreview）
  - **[聚合]** segmentForJobResult、shouldSendToSemanticRepair
  - **[语义修复]** 是否执行、repairedText 预览
  - **[NMT]** 输入 text、contextTextLength；输出 translatedText 长度/预览
  - **[TTS]** 是否有音频、长度
- **异常检测**：若某 Job 的日志行中出现 `error`、`exception`、`failed`（不区分大小写），会在该 Job 下打印「[异常] 本 Job 日志中含 error/exception/failed」并列出匹配行；使用 `--out` 时会在 Markdown 中写入「本 Job 异常/错误」小节。

## 3. 检查要点（各服务是否有异常）

| 环节       | 建议检查 |
|------------|----------|
| **ASR**    | 每个 Job 是否有 asrText 输出；是否有 ASR 报错/超时。 |
| **聚合**   | shouldSendToSemanticRepair 是否为 true（需发送的段落）；segmentForJobResult 是否与预期本段一致。 |
| **语义修复** | 是否执行 runSemanticRepairStep；是否有「未执行（跳过/无 initializer）」或「initialization failed」；repairedText 是否有内容。 |
| **NMT**   | 是否发送请求；translatedText 是否为空（空则客户端无译文、可能 [音频丢失]）；是否有 NMT 请求失败/超时。 |
| **TTS**    | 是否有音频输出（ttsAudioLength>0）；无译文时通常无 TTS。 |
| **异常**   | 脚本输出的「[异常]」或 Markdown 中「本 Job 异常/错误」是否出现；若有，在该 Job 的原始日志行中搜 error/exception/failed 排查。 |

## 4. 与你本次测试的对应关系

你本次朗读的文本较长，客户端返回的原文/译文按 utterance_index 显示为 [0]、[1]、[2]、[4]、[5]、[6]、[8]、[9]、[11]（中间缺 3、7、10 可能为合并或 DROP/HOLD 未单独展示）。  
用上述脚本对 **本次测试生成的 electron-main.log** 跑一遍后：

- 每个出现的 Job 会对应一张「ASR → 聚合 → 语义修复 → NMT → TTS」输入/输出表；
- 可逐条核对：切分、合并是否与预期一致，语义修复是否都执行，NMT 是否有空译文或异常，TTS 是否有音频；
- 若有某句缺失或异常，可在报告中定位到对应 Job，再在日志中搜该 jobId 查看完整调用链。

## 5. 当前工作区无本次日志时

若当前仓库下没有你本次测试的 `electron-main.log`（例如未提交或已在 .gitignore），请：

1. 在本机找到本次测试的日志文件（见上方「日志文件位置」）；
2. 在 **electron_node** 目录下执行：  
   `node scripts/analyze_jobs_per_service_flow.js <你的日志绝对路径> --out electron-node/logs/docs/asr_performance/JOB_SERVICE_FLOW_REPORT.md`  
3. 打开生成的 `JOB_SERVICE_FLOW_REPORT.md`，即可看到每个 Job 在各服务的输入/输出及是否有异常提示。
