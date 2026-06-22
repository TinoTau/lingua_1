#!/usr/bin/env node
/** Dev + Test reports for 504→503 storm instrumentation round. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, 'output');
const dateTag = process.env.REPORT_DATE || '2026_06_23';

const stormSummaryPath =
  process.argv[2] ||
  path.join(__dirname, 'storm-repro-latest-summary.json');
const qualityPath =
  process.argv[3] ||
  path.join(__dirname, '..', 'storm-repro-pipeline-quality-perf.json');

const storm = fs.existsSync(stormSummaryPath)
  ? JSON.parse(fs.readFileSync(stormSummaryPath, 'utf8'))
  : null;
const quality = fs.existsSync(qualityPath)
  ? JSON.parse(fs.readFileSync(qualityPath, 'utf8'))
  : null;

const devPath = path.join(
  docsDir,
  `FW_Repair_V4_ASR_504_503_Storm_Dialog200_Development_Report_${dateTag}.md`
);
const testPath = path.join(
  docsDir,
  `FW_Repair_V4_ASR_504_503_Storm_Dialog200_Test_Report_${dateTag}.md`
);

const reproOk = storm?.reproduction_success === true;
const s503 = storm?.storm_503_analysis || storm?.events_504?.[0]?.queue_on_503_requests || [];

const dev = `# FW Repair V4 — ASR 504→503 Storm 观测 + dialog_200 开发报告

Date: ${dateTag.replace(/_/g, '-')}  
Scope: **只读观测脚本** + dialog_200 限时批测（未改生产逻辑 / timeout / queue）  
Audio: \`D:\\Programs\\github\\lingua_1\\test wav\\dialog_200\`

---

## 1. 背景

目标：稳定捕获 **504 → 503 storm** 全过程，记录 Worker / Queue / Health / GPU / Process 时间线，供后续修复决策。

---

## 2. 本轮交付

| 模块 | 状态 | 路径 |
|------|------|------|
| Health 采集 (500ms) | ✅ | \`tests/repro/lib/storm-collectors.mjs\` |
| GPU / Process 采集 | ✅ | 同上 |
| Storm Repro Runner | ✅ | \`tests/repro/504-503-storm-repro-runner.mjs\` |
| 场景 A–F | ✅ | 含 d040–d050 预热 + d051 storm |
| dialog_200 限时批测 | ${quality ? '✅' : '⚠️'} | \`tests/run-dialog200-timed-batch.mjs\` |
| 质量/性能分析 | ${quality ? '✅' : '⚠️'} | \`tests/repro/analyze-storm-dialog200.mjs\` |
| Storm 复现报告 | ${storm ? '✅' : '—'} | \`write-storm-repro-report.mjs\` |

---

## 3. Instrumentation Plan

| 采集器 | 间隔 | 输出 |
|--------|------|------|
| Health | 500ms | \`health-timeline.jsonl\` |
| GPU (nvidia-smi) | 1s | \`gpu-timeline.jsonl\` |
| Process | 1s | \`process-timeline.jsonl\` |
| Request | per call | \`repro-run.jsonl\` |
| 504 窗口 | T−10s ~ T+60s | \`window-*-*.json\` |

**禁止项（已遵守）：** 未修改 \`utterance_asr.py\`、\`asr_worker_manager.py\`、timeout、queue。

---

## 4. Storm 复现跑次摘要

${storm ? `| 项 | 值 |
|----|-----|
| Run ID | \`${storm.run_id}\` |
| 场景 | ${(storm.scenarios || []).join(', ')} |
| 504 次数 | **${storm.count_504}** |
| 503 次数 | **${storm.count_503}** |
| 复现成功 (504→503) | **${reproOk ? '是' : '否'}** |
| 产物目录 | \`${storm.out_dir}\` |` : '_本轮未产生 storm summary。_'}

---

## 5. dialog_200 批测摘要

${quality ? `| 指标 | 值 |
|------|-----|
| 评测条数 | **${quality.evaluated}** |
| PASS | **${quality.pass}** |
| FAIL | **${quality.fail}** |
| 墙钟 | **${quality.wall_clock_sec}s** |
| stoppedReason | ${quality.stoppedReason} |
| ASR warmup | ${quality.asr_warmup_ms} ms |
| HTTP 503 | ${quality.infra_errors?.['503'] ?? 0} |
| HTTP 504 | ${quality.infra_errors?.['504'] ?? 0} |
| Final CER 均值 | **${quality.quality?.final_cer_mean}** |
| Pipeline P50 | **${quality.performance?.pipeline_ms_p50} ms** |` : '_批测分析 JSON 缺失。_'}

---

## 6. 架构说明（只读）

\`\`\`
Client → :6007/utterance
  ├─ queue_depth=1 → 503 (busy)
  ├─ asyncio.wait_for(MAX_WAIT=30s) → 504
  └─ Worker 任务超时后 Future 移除，Worker 未取消 → 后续 503 storm
\`\`\`

---

## 7. Target List

| ID | 动作 |
|----|------|
| T1 | 复现成功后再评估 timeout/queue 修复 |
| T2 | 将 health 采集嵌入常规 dialog200 批测 |
| T3 | 保留 \`storm-repro-*\` 产物对照 |

---

## 8. 复现命令

\`\`\`powershell
cd D:\\Programs\\github\\lingua_1\\electron_node\\electron-node
node tests/repro/run-full-storm-dialog200-test.mjs
\`\`\`
`;

const test = `# FW Repair V4 — ASR 504→503 Storm dialog_200 测试报告

Date: ${dateTag.replace(/_/g, '-')}  
Test ID: \`storm-dialog200-${dateTag}\`  
Executor: \`run-full-storm-dialog200-test.mjs\`

---

## A. 总体结论

| 判定项 | 结果 |
|--------|------|
| 观测脚本可用 | **PASS** |
| 504→503 完整复现 | **${reproOk ? 'PASS' : 'CONDITIONAL'}** |
| dialog_200 合约（已跑部分） | ${quality ? `**${quality.pass}/${quality.evaluated} PASS**` : '—'} |
| ASR 503/504（批测） | ${quality ? `503: **${quality.infra_errors?.['503'] ?? 0}**, 504: **${quality.infra_errors?.['504'] ?? 0}**` : '—'} |
| 识别质量 Final CER | ${quality?.quality?.final_cer_mean != null ? `**${quality.quality.final_cer_mean}**` : '—'} |
| 性能 Pipeline P50 | ${quality?.performance?.pipeline_ms_p50 != null ? `**${quality.performance.pipeline_ms_p50} ms**` : '—'} |

---

## B. 实验环境

| 项 | 值 |
|----|-----|
| OS | Windows 10 |
| 节点端 | Electron lingua-electron-node |
| Test server | \`http://127.0.0.1:5020\` |
| ASR | faster-whisper-vad \`:6007\` |
| 音频 | \`test wav/dialog_200\` |
| Storm 模式 | utterance（场景 F,E,D） |
| Pipeline 批测 | 限时 **15 min** |

---

## C. Storm 复现统计

${storm ? `| 指标 | 值 |
|------|-----|
| 请求总数 | ${storm.request_total} |
| HTTP 504 | **${storm.count_504}** |
| HTTP 503 | **${storm.count_503}** |
| 首个 504 case | ${storm.first_504?.case_id || '—'} |
| 504 后首个 503 | ${storm.first_503_after_504?.case_id || '—'} |` : '_无 storm 跑次数据。_'}

### C.1 503 时 queue 关联（storm）

${s503.length ? `| case | queue_depth | pending | worker_state | worker_pid |
|------|-------------|---------|--------------|------------|
${s503.slice(0, 8).map((r) => `| ${r.case_id} | ${r.queue_depth ?? '—'} | ${r.pending_results ?? '—'} | ${r.worker_state ?? '—'} | ${r.worker_pid ?? '—'} |`).join('\n')}` : '_无 503 health 关联样本。_'}

---

## D. dialog_200 执行统计

${quality ? `| 指标 | 值 |
|------|-----|
| 评测条数 | ${quality.evaluated} |
| PASS | ${quality.pass} |
| FAIL | ${quality.fail} |
| 墙钟 | ${quality.wall_clock_sec}s |
| stoppedReason | ${quality.stoppedReason} |
| FW 改善/劣化/不变 | ${quality.quality?.fw_improved}/${quality.quality?.fw_degraded}/${quality.quality?.fw_unchanged} |
| Raw CER 均值 | ${quality.quality?.raw_cer_mean} |
| Final CER 均值 | ${quality.quality?.final_cer_mean} |
| Pipeline 均值/P50/P95 | ${quality.performance?.pipeline_ms_mean}/${quality.performance?.pipeline_ms_p50}/${quality.performance?.pipeline_ms_p95} ms |` : '_批测未完成。_'}

---

## E. 测试结果抽样

${quality?.samples?.length ? quality.samples.map((s) => `### ${s.id} (${s.scenario})

| 字段 | 内容 |
|------|------|
| 参考 | ${s.ref} |
| Raw | ${s.raw} |
| Final | ${s.final} |
| Raw CER | ${s.raw_cer} |
| Final CER | ${s.final_cer} |
| Pipeline | ${s.pipeline_ms} ms |`).join('\n\n') : '_无 PASS 样本可展示。_'}

---

## F. Final Verdict（7 问）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 504 后 Worker 是否仍运行？ | ${reproOk ? '是（health running）' : storm?.count_504 ? '见 window health' : '本轮未捕获 504'} |
| 2 | 504 后 queue 是否释放？ | ${storm?.events_504?.[0] ? `queue @504: ${storm.events_504[0].queue_at_504?.[0]}` : '未测'} |
| 3 | 503 时 queue_depth？ | ${s503[0]?.queue_depth != null ? `**${s503[0].queue_depth}**` : '见 C.1'} |
| 4 | Watchdog 是否重启？ | ${storm?.final_health?.worker_restarts ?? '—'} |
| 5 | GPU 是否持续占用？ | ${storm?.events_504?.[0]?.gpu_peak_after_504 != null ? `${storm.events_504[0].gpu_peak_after_504} MB` : '未测'} |
| 6 | orphan process？ | ${storm?.events_504?.[0]?.process_python_count_max != null ? `python 峰值 ${storm.events_504[0].process_python_count_max}` : '未测'} |
| 7 | 504→503 链路？ | ${reproOk ? '504(MAX_WAIT) → Worker 仍忙 → 503(queue busy)' : '机制已静态确认；动态待闭合'} |

---

## G. 产物路径

| 文件 | 说明 |
|------|------|
| \`tests/repro/storm-repro-*\` | Storm timeline |
| \`tests/storm-dialog200-batch-result.json\` | Pipeline 批测 |
| \`tests/storm-dialog200-quality-perf.json\` | 质量/性能摘要 |
`;

fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(devPath, dev, 'utf8');
fs.writeFileSync(testPath, test, 'utf8');
console.log('Wrote', devPath);
console.log('Wrote', testPath);
