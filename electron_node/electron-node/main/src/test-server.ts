/**
 * 本地测试 HTTP 服务（独立模块，可整体移除）
 *
 * 功能：在本机 5020 端口监听 POST /run-pipeline-with-audio，请求体 { wavPath, srcLang?, tgtLang? }，
 * 调用 managers.inferenceService.runPipelineWithAudio 后返回结果，供 tests/run-mock-asr-pipeline.js --wav 使用。
 * 仅依赖现有 API（ServiceManagers、runPipelineWithAudio），不侵入 pipeline 或 inference 内部。
 *
 * 完整移除时：
 * 1. 删除本文件 main/src/test-server.ts
 * 2. 删除 index.ts 中下方标注的「可移除：本地测试服务」整块（require + startTestServer 调用）
 * 3. 可选：node-config.ts 中移除 testServer 类型与默认值；tests/run-mock-asr-pipeline.js 的 --wav 模式将不可用
 */

import * as http from 'http';
import type { ServiceManagers } from './app/app-init-simple';
import { getTestServerPort, getLidConfig } from './node-config';
import logger from './logger';

let testServerInstance: http.Server | null = null;

export function startTestServer(managers: ServiceManagers): void {
  if (testServerInstance) {
    logger.warn({}, 'Test server already started, skipping');
    return;
  }
  const port = getTestServerPort();
  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];
    const isHealth = req.method === 'GET' && (path === '/' || path === '/health' || path === '/health/');
    if (isHealth) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method === 'GET' && (path === '/lid-status' || path === '/lid-status/')) {
      try {
        const lidConfig = getLidConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: lidConfig.enabled, modelPath: lidConfig.modelPath }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
    if (req.method !== 'POST' || path !== '/run-pipeline-with-audio') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let sent = false;
      const safeSend = (status: number, data: string) => {
        if (sent) return;
        sent = true;
        try {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(data);
        } catch (e) {
          logger.warn({ err: e }, 'Test server: response already sent or closed');
        }
      };
      const pipelineTimeoutMs = 120000;
      const timeoutId = setTimeout(() => {
        if (!sent) {
          logger.warn({}, 'Test server: pipeline timeout, sending 504');
          safeSend(504, JSON.stringify({ error: 'Pipeline timeout (120s)' }));
        }
      }, pipelineTimeoutMs);
      try {
        const { wavPath, srcLang, tgtLang, useLid, lidCandidates, room_id } = JSON.parse(body || '{}');
        if (!wavPath || typeof wavPath !== 'string') {
          safeSend(400, JSON.stringify({ error: 'Missing or invalid wavPath' }));
          return;
        }
        if (!managers.inferenceService) {
          safeSend(503, JSON.stringify({ error: 'InferenceService not available' }));
          return;
        }
        logger.info({ wavPath, useLid }, 'Test server: runPipelineWithAudio start');
        const pipelineStartMs = Date.now();
        const result = await managers.inferenceService.runPipelineWithAudio(wavPath, {
          srcLang,
          tgtLang,
          useLid: useLid === true,
          lidCandidates: Array.isArray(lidCandidates) && lidCandidates.length === 2 ? (lidCandidates as [string, string]) : undefined,
          room_id,
        });
        const pipelineMs = Date.now() - pipelineStartMs;
        clearTimeout(timeoutId);
        if (sent) return;
        safeSend(200, JSON.stringify({
          text_asr: result.text_asr,
          text_translated: result.text_translated,
          tts_audio_length: result.tts_audio?.length ?? 0,
          tts_format: result.tts_format,
          extra: { ...result.extra, pipeline_ms: pipelineMs },
        }));
        logger.info({ textAsr: result.text_asr?.length, pipelineMs }, 'Test server: runPipelineWithAudio done');
      } catch (err) {
        clearTimeout(timeoutId);
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: err }, 'Test server: runPipelineWithAudio failed');
        safeSend(500, JSON.stringify({ error: message }));
      }
    });
    req.on('error', (err) => {
      logger.warn({ err }, 'Test server: request error (client may have closed)');
    });
    res.on('error', (err) => {
      logger.warn({ err }, 'Test server: response error');
    });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error({ error: err, port }, 'Test server failed to listen');
    console.error(`\n❌ Test server (5020) 启动失败: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`   端口 ${port} 已被占用，请关闭占用该端口的进程或修改配置 testServer.port`);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Test server listening on 5020');
    console.log(`\n✅ Test server 已启动: http://127.0.0.1:${port} (POST /run-pipeline-with-audio)\n`);
  });
  testServerInstance = server;
}

/**
 * 关闭测试服务并释放端口，退出时由 app-lifecycle 调用。
 */
export function stopTestServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!testServerInstance) {
      resolve();
      return;
    }
    const server = testServerInstance;
    testServerInstance = null;
    server.close((err) => {
      if (err) logger.warn({ error: err }, 'Test server close error');
      else logger.info({}, 'Test server closed, port 5020 released');
      resolve();
    });
  });
}
