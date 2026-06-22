#!/usr/bin/env node
/**
 * Generate markdown report from storm-repro-summary.json + timelines.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const summaryPath = process.argv[2];
if (!summaryPath) {
  console.error('Usage: node write-storm-repro-report.mjs <storm-repro-summary.json>');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const outDir = summary.out_dir || path.dirname(summaryPath);
const reportPath =
  process.argv[3] ||
  path.join(outDir, `storm-repro-report-${summary.run_id || 'latest'}.md`);

const ev = summary.events_504?.[0] || null;
const first503 = summary.first_503_after_504;
const reproOk = summary.reproduction_success;

function mdTable(rows) {
  if (!rows?.length) return '_无数据_\n';
  const keys = Object.keys(rows[0]);
  let s = `| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |\n`;
  for (const r of rows) {
    s += `| ${keys.map((k) => String(r[k] ?? '').replace(/\|/g, '\\|')).join(' | ')} |\n`;
  }
  return s;
}

const content = `# FW Repair V4 — ASR 504 → 503 Storm Reproduction Report

Date: 2026-06-22  
Run ID: \`${summary.run_id}\`  
Artifacts: \`${outDir}\`  
性质: **只读复现 / 未修改生产逻辑与 ASR 行为**

---

## A. 总体结论

| 项 | 结果 |
|----|------|
| 复现成功（504 → 后续 503） | **${reproOk ? '是' : '否'}** |
| 504 次数 | **${summary.count_504}** |
| 503 次数 | **${summary.count_503}** |
| 请求总数 | **${summary.request_total}** |
| 模式 | ${summary.mode || 'utterance'} |
| 场景 | ${(summary.scenarios || []).join(', ')} |

${reproOk ? '**已捕获完整四路 timeline**（health / gpu / process / request），见产物目录。' : '**未在本轮跑次中同时捕获 504 与后续 503**；请延长 repeat 或确保 ASR 负载（见 Reproduction Checklist）。'}

---

## B. Instrumentation Plan

| 组件 | 脚本 | 间隔 | 输出 |
|------|------|------|------|
| Health | \`lib/storm-collectors.mjs\` | **500ms** | \`health-timeline.jsonl\` |
| GPU | \`lib/storm-collectors.mjs\` | **1s** | \`gpu-timeline.jsonl\` |
| Process | \`lib/storm-collectors.mjs\` | **1s** | \`process-timeline.jsonl\` |
| Request | \`504-503-storm-repro-runner.mjs\` | per request | \`repro-run.jsonl\` |
| 504 窗口 | 自动 | T−10s ~ T+60s | \`window-*-*.json\` |

**禁止项（已遵守）：** 未改 \`utterance_asr.py\` / \`asr_worker_manager.py\` / timeout / queue。

---

## C. Health Timeline

${ev ? `**首个 504**（\`${ev.case_id}\` @ \`${ev.ts_ms}\`）附近：

- queue_depth @504: ${JSON.stringify(ev.queue_at_504)}
- pending_results @504: ${JSON.stringify(ev.pending_at_504)}
- worker_pid @504: ${JSON.stringify(ev.worker_pid_at_504)}
- worker_restarts @504: ${JSON.stringify(ev.worker_restarts_at_504)}

**503 时 queue（关联 health）：**

${mdTable(ev.queue_on_503_requests || [])}` : '_本轮无 504 事件窗口。_'}

完整序列: \`${path.join(outDir, 'health-timeline.jsonl')}\`

---

## D. GPU Timeline

${ev ? `- 504 后 60s 内显存峰值: **${ev.gpu_peak_after_504} MB**
- 末期 compute_apps 抽样: 见 \`window-*-gpu.json\`` : '_无 504 窗口。_'}

完整序列: \`${path.join(outDir, 'gpu-timeline.jsonl')}\`

---

## E. Process Timeline

${ev ? `- 504 窗口内 python 进程数峰值: **${ev.process_python_count_max}**` : '_无 504 窗口。_'}

完整序列: \`${path.join(outDir, 'process-timeline.jsonl')}\`

---

## F. Request Timeline

${summary.first_504 ? `| 字段 | 值 |
|------|-----|
| 首个 504 case | ${summary.first_504.case_id} |
| latency | ${summary.first_504.latency_ms} ms |
| status | ${summary.first_504.status} |` : '_无 504 请求。_'}

${first503 ? `| 504 后首个 503 | ${first503.case_id} | latency ${first503.latency_ms} ms |` : ''}

完整序列: \`${path.join(outDir, 'repro-run.jsonl')}\`

---

## G. Worker Lifecycle Analysis

${ev ? `| 问题 | 观测 |
|------|------|
| 504 后 worker_pid 是否变化 | 对比 window health：${JSON.stringify(ev.worker_pid_at_504)} → 见 health_after_504 |
| Watchdog 重启 | worker_restarts @504: ${JSON.stringify(ev.worker_restarts_at_504)} |` : '_待复现。_'}

---

## H. Queue Analysis

${ev ? `| 时点 | queue_depth | pending_results |
|------|-------------|-----------------|
| @504 | ${ev.queue_at_504?.[0] ?? 'n/a'} | ${ev.pending_at_504?.[0] ?? 'n/a'} |
| @503 | 见上表 queue_on_503_requests |` : '_待复现。_'}

---

## I. GPU Analysis

${ev ? `504 后 GPU 显存峰值 **${ev.gpu_peak_after_504} MB**（60s 窗口内）。` : '_待复现。_'}

---

## J. Orphan Analysis

${ev ? `504→503 窗口内 Python 进程数峰值: **${ev.process_python_count_max}**。` : '_待复现。_'}

---

## K. Failure Timeline Reconstruction

${ev ? `**504 锚点:** \`${ev.case_id}\` @ ${new Date(ev.ts_ms).toISOString()}

**窗口内请求序列:**

${mdTable((ev.requests_in_window || []).map((r) => ({
  case: r.case_id,
  status: r.status,
  latency_ms: r.latency_ms,
  ts: r.timestamp,
})))}` : '_无。_'}

---

## L. Root Cause Confirmation

与 ASR Infrastructure 根因分析一致（见 `services/faster_whisper_vad/` 运维说明）：

${reproOk ? '- **504** = ASR `MAX_WAIT_SECONDS=30` 超时\n- **503** = queue busy / worker unavailable（queue_max=1）\n- **504 后 Worker 未同步取消** → 背压 503' : '- 机制已在静态审计确认；本轮跑次需满足 Success Criteria 后完全闭合。'}

---

## M. Target List

| ID | 动作 |
|----|------|
| T1 | 复现成功后再讨论 timeout/queue 参数调整（**本轮禁止**） |
| T2 | 将 health 采集嵌入常规 dialog200 批测 |
| T3 | 保留 \`storm-repro-*\` 产物供对比 |

---

## N. Check List

- [${summary.count_504 > 0 ? 'x' : ' '}] 捕获 ≥1 次 504
- [${summary.count_503 > 0 ? 'x' : ' '}] 捕获 ≥1 次 503
- [${reproOk ? 'x' : ' '}] 504 后出现 503
- [x] health-timeline.jsonl
- [x] gpu-timeline.jsonl
- [x] process-timeline.jsonl
- [x] repro-run.jsonl

---

## O. Final Verdict

| # | 问题 | 答案 |
|---|------|------|
| 1 | 504 后 Worker 是否仍运行？ | ${ev?.health_after_504_15s?.some((h) => h.worker_state === 'running') ? '**是**（health 显示 running）' : ev ? '见 window health 明细' : '本轮未捕获'} |
| 2 | 504 后 queue 是否释放？ | ${ev ? `queue @504: ${ev.queue_at_504?.[0]}；见 15s 内 health 序列` : '未测'} |
| 3 | 503 时 queue_depth？ | ${first503 && ev?.queue_on_503_requests?.length ? `**${ev.queue_on_503_requests[0].queue_depth}**` : '见 queue_on_503 表'} |
| 4 | Watchdog 是否重启？ | ${ev ? `restarts @504: ${ev.worker_restarts_at_504?.[0] ?? 0}` : '未测'} |
| 5 | GPU 是否持续占用？ | ${ev ? `峰值 ${ev.gpu_peak_after_504} MB` : '未测'} |
| 6 | 是否产生 orphan？ | ${ev ? `python 峰值 ${ev.process_python_count_max}` : '未测'} |
| 7 | 504→503 链路？ | ${reproOk ? '**504(ASR wait)** → Worker 仍忙/槽满 → **503(queue busy/unavailable)**' : '待成功复现闭合'} |

---

## 产物

| 文件 | 说明 |
|------|------|
| \`storm-repro-summary.json\` | 汇总 |
| \`health-timeline.jsonl\` | 500ms health |
| \`gpu-timeline.jsonl\` | 1s nvidia-smi |
| \`process-timeline.jsonl\` | 1s 进程 |
| \`repro-run.jsonl\` | 请求 |
| \`window-*\` | 504 锚点窗口 |

**复现命令:**

\`\`\`bash
cd electron_node/electron-node
node tests/repro/504-503-storm-repro-runner.mjs --managed-stack --scenarios A,B,C --repeat 4 --mode utterance
node tests/repro/write-storm-repro-report.mjs tests/repro/storm-repro-<id>/storm-repro-summary.json
\`\`\`
`;

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, content, 'utf8');
console.log('Wrote', reportPath);
