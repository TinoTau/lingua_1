/**
 * 本地测试 HTTP 服务（独立模块，可整体移除）
 *
 * 功能：在本机 5020 端口监听 POST /run-pipeline-with-audio，请求体 { wavPath, srcLang?, tgtLang? }，
 * 调用 managers.inferenceService.runPipelineWithAudio 后返回结果，供 tests/run-fw-detector-*-batch.js 等批测使用。
 *
 * P3 runtime integration 验收仅使用 /run-pipeline-with-audio（真实 WAV + SEND pipeline）。
 */

import * as http from 'http';
import type { ServiceManagers } from './app/app-init-simple';
import { getTestServerPort, getLidConfig } from './node-config';
import logger from './logger';
import { handleSessionMigrationHttp } from './session-runtime/session-migration-http';
import { buildIntentRuntimeDiagnosticsReport } from './lexicon-v2/intent-runtime-metrics';
import { handleLexiconApplyPatchHttp } from './lexicon-patch-v3/apply-patch-http';
import type { LexiconPatchV3 } from './lexicon-patch-v3/patch-types';

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
    if (
      req.method === 'GET' &&
      (path === '/service-diagnostics/intent-runtime' ||
        path === '/service-diagnostics/intent-runtime/')
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildIntentRuntimeDiagnosticsReport()));
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
    const isLexiconPatchApply =
      req.method === 'POST' &&
      (path === '/lexicon/apply-patch' || path === '/lexicon/apply-patch/');
    const isLexiconMock =
      req.method === 'POST' && (path === '/run-lexicon-mock' || path === '/run-lexicon-mock/');
    const isSessionMigration =
      (req.method === 'POST' && path.startsWith('/session-migration')) ||
      path.replace(/\/$/, '').startsWith('/session-migration');
    const isRunAudio =
      req.method === 'POST' && (path === '/run-pipeline-with-audio' || path === '/run-pipeline-with-audio/');
    const isSessionBootstrap =
      req.method === 'POST' &&
      (path === '/session-bootstrap' || path === '/session-bootstrap/');
    if (isSessionBootstrap) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          if (!managers.nodeAgent) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'NodeAgent not available' }));
            return;
          }
          const parsed = JSON.parse(body || '{}');
          const session_id =
            typeof parsed.session_id === 'string' ? parsed.session_id.trim() : '';
          if (!session_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'session_id required' }));
            return;
          }
          managers.nodeAgent.applySessionBootstrap({
            type: 'session_bootstrap',
            session_id,
            user_id: parsed.user_id ?? null,
            profile_version: parsed.profile_version ?? parsed.user_profile?.profile_version ?? null,
            user_profile: parsed.user_profile ?? null,
            trace_id: parsed.trace_id ?? null,
          });
          const bound = managers.nodeAgent.getSessionUserProfile(session_id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              session_id,
              profile_version: bound?.profileVersion ?? null,
              profile_present: !!bound?.profile,
            })
          );
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      return;
    }
    if (isSessionMigration) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const routePath = path.split('?')[0];
        const handled = handleSessionMigrationHttp(req.method || 'POST', routePath, body);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }
        res.writeHead(handled.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(handled.body));
      });
      return;
    }
    if (isLexiconPatchApply) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const patch = JSON.parse(body || '{}') as LexiconPatchV3;
          const { status, body: responseBody } = await handleLexiconApplyPatchHttp(patch);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseBody));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, errorCode: 'internal_error', message }));
        }
      });
      return;
    }
    if (isLexiconMock) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          if (!managers.inferenceService) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'InferenceService not available' }));
            return;
          }
          const parsed = JSON.parse(body || '{}');
          const asrText = typeof parsed.asrText === 'string' ? parsed.asrText : '';
          const srcLang = typeof parsed.srcLang === 'string' ? parsed.srcLang : 'zh';
          const fwEnabledDomains = Array.isArray(parsed.enabledDomains)
            ? parsed.enabledDomains.filter((d: unknown) => typeof d === 'string' && d.length > 0)
            : undefined;
          const profilePrimaryDomain =
            typeof parsed.profilePrimaryDomain === 'string' ? parsed.profilePrimaryDomain : undefined;
          const enableKenLMGate =
            typeof parsed.enableKenLMGate === 'boolean' ? parsed.enableKenLMGate : undefined;
          const kenlmGateMode =
            parsed.kenlmGateMode === 'hard_gate' || parsed.kenlmGateMode === 'weak_veto'
              ? parsed.kenlmGateMode
              : undefined;
          const kenlmVetoThreshold =
            typeof parsed.kenlmVetoThreshold === 'number' ? parsed.kenlmVetoThreshold : undefined;
          const sessionId =
            typeof parsed.session_id === 'string' && parsed.session_id.trim()
              ? parsed.session_id.trim()
              : undefined;
          const utteranceIndex =
            typeof parsed.utterance_index === 'number' ? parsed.utterance_index : undefined;
          const isManualCut = parsed.is_manual_cut !== false;
          const pilot200Replay = parsed.pilot200_replay === true;
          // Exact RAW replay may be empty (authoritative Block B empty merge).
          if (!pilot200Replay && !asrText.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing asrText' }));
            return;
          }
          // Frozen post-ASR evidence (production JobResult fields only — no invented Tone).
          const asrSegments = Array.isArray(parsed.segments) ? parsed.segments : undefined;
          const utteranceTone =
            parsed.utterance_tone && typeof parsed.utterance_tone === 'object'
              ? parsed.utterance_tone
              : parsed.extra?.utterance_tone && typeof parsed.extra.utterance_tone === 'object'
                ? parsed.extra.utterance_tone
                : null;
          const acousticToneSlices = Array.isArray(utteranceTone?.acousticToneSlices)
            ? utteranceTone.acousticToneSlices
            : Array.isArray(parsed.acousticToneSlices)
              ? parsed.acousticToneSlices
              : undefined;
          // Replay-only: multi-batch alignment state restored from Frozen Evidence.
          const segmentTimeOffsetsSec = Array.isArray(parsed.segmentTimeOffsetsSec)
            ? parsed.segmentTimeOffsetsSec
            : undefined;
          const asrSegmentNodeBatchIndices = Array.isArray(parsed.asrSegmentNodeBatchIndices)
            ? parsed.asrSegmentNodeBatchIndices
            : undefined;
          const segmentCharOffsets = Array.isArray(parsed.segmentCharOffsets)
            ? parsed.segmentCharOffsets
            : undefined;
          const profileBinding =
            sessionId && managers.nodeAgent
              ? managers.nodeAgent.getSessionUserProfile(sessionId)
              : null;
          const profileRuntime = {
            profile_present: !!profileBinding?.profile,
            profile_version: profileBinding?.profileVersion ?? null,
            phonetic_bias_keys: Object.keys(profileBinding?.profile?.phonetic_bias || {}).filter(
              (k) => Number((profileBinding?.profile?.phonetic_bias || {})[k]) > 0
            ),
          };
          const { getAsrStepInvocationCount } = await import('./pipeline/steps/asr-step');
          const asrCountBefore = getAsrStepInvocationCount();
          const startMs = Date.now();
          const result = await managers.inferenceService.runPipelineWithMockAsr(asrText, srcLang, 'en', {
            useLexicon: true,
            useNmt: false,
            sessionId,
            utteranceIndex,
            isManualCut,
            fwEnabledDomains,
            profilePrimaryDomain,
            enableKenLMGate,
            kenlmGateMode,
            kenlmVetoThreshold,
            userProfile: profileBinding?.profile ?? null,
            profileVersion: profileBinding?.profileVersion ?? null,
            asrSegments,
            acousticToneSlices,
            segmentTimeOffsetsSec,
            asrSegmentNodeBatchIndices,
            segmentCharOffsets,
          });
          const asrCountAfter = getAsrStepInvocationCount();
          if (sessionId && managers.nodeAgent && sessionId.startsWith('pilot200-replay::')) {
            managers.nodeAgent.removeSession(sessionId);
          }
          if (sessionId && managers.nodeAgent && sessionId.startsWith('pilot200-tone-replay::')) {
            managers.nodeAgent.removeSession(sessionId);
          }
          // TEST_ONLY Phase A controlled-parity sessions — isolate request state between arms.
          if (sessionId && managers.nodeAgent && sessionId.startsWith('capture-v2-phase-a::')) {
            managers.nodeAgent.removeSession(sessionId);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              text_asr: result.text_asr,
              text_translated: result.text_translated,
              segments: result.segments,
              extra: {
                ...result.extra,
                pipeline_ms: Date.now() - startMs,
                session_id: sessionId,
                profile_runtime: profileRuntime,
                asr_step_skipped: true,
                asr_step_invocation_delta: asrCountAfter - asrCountBefore,
                asr_step_invocation_total: asrCountAfter,
                tone_inference_skipped: true,
                frozen_post_asr_evidence_injected: Boolean(asrSegments || acousticToneSlices),
                frozen_segment_count: Array.isArray(asrSegments) ? asrSegments.length : 0,
                frozen_tone_slice_count: Array.isArray(acousticToneSlices)
                  ? acousticToneSlices.length
                  : 0,
              },
            })
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
      });
      return;
    }
    if (!isRunAudio) {
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
      const pipelineTimeoutMs = 300000;
      const timeoutId = setTimeout(() => {
        if (!sent) {
          logger.warn({}, 'Test server: pipeline timeout, sending 504');
          safeSend(504, JSON.stringify({ error: 'Pipeline timeout (300s)' }));
        }
      }, pipelineTimeoutMs);
      try {
        if (!managers.inferenceService) {
          safeSend(503, JSON.stringify({ error: 'InferenceService not available' }));
          return;
        }
        const parsed = JSON.parse(body || '{}');
        const pipelineStartMs = Date.now();

        const {
          wavPath,
          srcLang,
          tgtLang,
          useLid,
          lidCandidates,
          room_id,
          use_lexicon,
          session_id,
          is_manual_cut,
          lexicon_v2_intent_enabled,
          enableKenLMGate,
          kenlmGateMode,
          kenlmVetoThreshold,
          domainPriors,
        } = parsed;
        if (!wavPath || typeof wavPath !== 'string') {
          safeSend(400, JSON.stringify({ error: 'Missing or invalid wavPath' }));
          return;
        }
        const sessionId =
          typeof session_id === 'string' && session_id.trim()
            ? session_id.trim()
            : `p3-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        logger.info(
          {
            wavPath,
            useLid,
            use_lexicon,
            sessionId,
            is_manual_cut,
            domainPriorsFieldPresent: Object.prototype.hasOwnProperty.call(parsed, 'domainPriors'),
            domainPriorsCount: Array.isArray(domainPriors) ? domainPriors.length : 0,
          },
          'Test server: runPipelineWithAudio start'
        );
        const profileBinding = managers.nodeAgent?.getSessionUserProfile(sessionId);
        const profileRuntime = {
          profile_present: !!profileBinding?.profile,
          profile_version: profileBinding?.profileVersion ?? null,
          phonetic_bias_keys: Object.keys(profileBinding?.profile?.phonetic_bias || {}).filter(
            (k) => Number((profileBinding?.profile?.phonetic_bias || {})[k]) > 0
          ),
        };
        const result = await managers.inferenceService.runPipelineWithAudio(wavPath, {
          srcLang,
          tgtLang,
          useLid: useLid === true,
          lidCandidates:
            Array.isArray(lidCandidates) && lidCandidates.length === 2
              ? (lidCandidates as [string, string])
              : undefined,
          room_id,
          useLexicon: use_lexicon !== false,
          sessionId,
          isManualCut: is_manual_cut !== false,
          lexiconV2IntentEnabled: lexicon_v2_intent_enabled !== false,
          enableKenLMGate: typeof enableKenLMGate === 'boolean' ? enableKenLMGate : undefined,
          kenlmGateMode:
            kenlmGateMode === 'hard_gate' || kenlmGateMode === 'weak_veto'
              ? kenlmGateMode
              : undefined,
          kenlmVetoThreshold:
            typeof kenlmVetoThreshold === 'number' ? kenlmVetoThreshold : undefined,
          domainPriors: Object.prototype.hasOwnProperty.call(parsed, 'domainPriors')
            ? Array.isArray(domainPriors)
              ? domainPriors
              : []
            : undefined,
          userProfile: profileBinding?.profile ?? null,
          profileVersion: profileBinding?.profileVersion ?? null,
        });
        // Isolated harness sessions: drop binding after run to prevent residue across executions
        if (managers.nodeAgent && sessionId.startsWith('pilot200::')) {
          managers.nodeAgent.removeSession(sessionId);
        }
        const pipelineMs = Date.now() - pipelineStartMs;
        clearTimeout(timeoutId);
        if (sent) return;
        safeSend(
          200,
          JSON.stringify({
            text_asr: result.text_asr,
            text_translated: result.text_translated,
            tts_audio_length: result.tts_audio?.length ?? 0,
            tts_format: result.tts_format,
            segments: result.segments,
            extra: {
              ...result.extra,
              pipeline_ms: pipelineMs,
              session_id: sessionId,
              profile_runtime: profileRuntime,
            },
          })
        );
        logger.info(
          {
            textAsr: result.text_asr?.length,
            pipelineMs,
            lexiconStatus: result.extra?.lexicon_runtime_status,
            selectionApplied: (result.extra as { sentence_repair?: { modified?: boolean } })
              ?.sentence_repair?.modified,
          },
          'Test server: runPipelineWithAudio done'
        );
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
    console.error(`\n❌ Test server (${port}) 启动失败: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`   端口 ${port} 已被占用，请关闭占用该端口的进程或修改配置 testServer.port`);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Test server listening');
    console.log(
      `\n✅ Test server 已启动: http://127.0.0.1:${port}\n   POST /run-pipeline-with-audio\n   POST /session-bootstrap\n   POST /run-lexicon-mock (text repair, no ASR)\n   POST /lexicon/apply-patch (Lexicon V3.1 patch)\n`
    );
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
      else logger.info({}, 'Test server closed');
      resolve();
    });
  });
}
