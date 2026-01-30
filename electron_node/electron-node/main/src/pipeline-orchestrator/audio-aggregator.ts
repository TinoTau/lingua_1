/**
 * 音频聚合器：在ASR之前聚合音频
 * 
 * 功能：
 * 1. 根据 is_manual_cut 和 is_timeout_triggered 标识，将多个音频块聚合成完整句子
 * 2. 避免ASR识别不完整的短句，提高识别准确率
 * 3. 减少NMT翻译次数，提高处理效率
 * 4. 流式切分：长音频按能量切分，组合成~5秒批次发送给ASR
 * 5. Session Affinity：超时finalize时记录sessionId->nodeId映射
 * 
 * 设计：
 * - 使用依赖注入方式创建实例（通过 ServicesBundle 传递）
 * - 支持热插拔：每次 InferenceService 创建时都有新的干净实例
 * - Session 隔离：使用 sessionId 作为 key，确保不同 session 的缓冲区完全隔离
 * 
 * @see AUDIO_AGGREGATOR_ARCHITECTURE.md 详细架构文档
 */

import logger from '../logger';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { AudioAggregatorUtils } from './audio-aggregator-utils';
import { decodeAudioChunk } from './audio-aggregator-decoder';
import { AudioChunkResult, OriginalJobInfo, AudioBuffer, BufferState } from './audio-aggregator-types';
import { SessionAffinityManager } from './session-affinity-manager';
import { AudioAggregatorStreamBatcher } from './audio-aggregator-stream-batcher';
import { AudioAggregatorMerger } from './audio-aggregator-merger';
import { AudioAggregatorTimeoutHandler } from './audio-aggregator-timeout-handler';
import { AudioAggregatorMaxDurationHandler } from './audio-aggregator-maxduration-handler';
import { AudioAggregatorFinalizeHandler } from './audio-aggregator-finalize-handler';
import { buildBufferKey } from './audio-aggregator-buffer-key';


export class AudioAggregator {
  private buffers: Map<string, AudioBuffer> = new Map();
  private readonly MAX_BUFFER_DURATION_MS = 20000; // 最大缓冲时长：20秒
  private readonly MIN_AUTO_PROCESS_DURATION_MS = 10000; // 最短自动处理时长：10秒（用户表达一个短句时也需要说够一定时间，10秒的音频应该足够ASR识别出正确的文本）
  private readonly SAMPLE_RATE = 16000; // 固定采样率
  private readonly BYTES_PER_SAMPLE = 2; // PCM16: 2 bytes per sample

  // 优化参数
  // 分割点Hangover：600ms
  // 作用：
  // 1. 避免在单词中间切断，提高ASR识别准确度
  // 2. 包含一个完整的词或短语（通常200-500ms一个词，600ms可以包含1-2个词）
  // 3. 制造更明显的重复内容，提高文本去重检测的成功率
  // 4. 即使有重复，后续的去重逻辑可以准确检测并移除
  private readonly SPLIT_HANGOVER_MS = 600; // 从200ms增加到600ms，提高去重检测成功率
  /** pendingTimeoutAudio TTL：10秒（如果10秒内没有手动/pause cut，强制处理） */
  private readonly PENDING_TIMEOUT_AUDIO_TTL_MS = 10000;

  // 音频分析工具
  private readonly audioUtils = new AudioAggregatorUtils();

  // Session Affinity管理器
  private readonly sessionAffinityManager = SessionAffinityManager.getInstance();

  // 流式批次处理器
  private readonly streamBatcher = new AudioAggregatorStreamBatcher();

  // 音频合并器
  private readonly audioMerger = new AudioAggregatorMerger();

  // 超时处理器
  private readonly timeoutHandler = new AudioAggregatorTimeoutHandler();
  private readonly maxDurationHandler = new AudioAggregatorMaxDurationHandler();


  // Finalize处理器
  private readonly finalizeHandler = new AudioAggregatorFinalizeHandler();

  /**
   * 处理音频块，根据标识决定是否聚合
   * 
   * @param job 任务消息
   * @returns AudioChunkResult，包含切分后的多段音频（如果只一段，数组长度为1）
   *          - 超时截断：返回空数组 + shouldReturnEmpty=true，音频缓存等待下一个job
   *          - 手动/pause截断：立即按能量切分，返回多段音频
   */
  async processAudioChunk(job: JobAssignMessage): Promise<AudioChunkResult> {
    const sessionId = job.session_id;
    const isManualCut = (job as any).is_manual_cut || false;
    // is_pause_triggered 已废弃（pause finalize 已删除），不再使用
    const isTimeoutTriggered = (job as any).is_timeout_triggered || false;
    const isMaxDurationTriggered = (job as any).is_max_duration_triggered || false;
    const nowMs = Date.now();

    // 构建 bufferKey（唯一、稳定、显式）
    const bufferKey = buildBufferKey(job);

    // ✅ 关键日志：打印 bufferKey、epoch、state，确认同一句话期间 key 是否变化
    logger.info(
      {
        jobId: job.job_id,
        bufferKey,
        sessionId,
        utteranceIndex: job.utterance_index,
        isManualCut,
        isTimeoutTriggered,
        isMaxDurationTriggered,
      },
      'AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check'
    );

    // 解码当前音频块
    const decodeResult = await decodeAudioChunk(job, this.SAMPLE_RATE, this.BYTES_PER_SAMPLE);
    let currentAudio = decodeResult.audio;
    let currentDurationMs = decodeResult.durationMs;

    // 获取或创建缓冲区
    let buffer = this.buffers.get(bufferKey);

    if (!buffer) {
      // 如果缓冲区不存在，创建一个新的
      logger.info(
        {
          jobId: job.job_id,
          bufferKey,
          sessionId,
          utteranceIndex: job.utterance_index,
          epoch: 0,
          state: 'OPEN',
          reason: 'Buffer not found, creating new buffer',
        },
        'AudioAggregator: Creating new buffer'
      );
      buffer = {
        state: 'OPEN',
        epoch: 0,
        bufferKey,
        audioChunks: [],
        totalDurationMs: 0,
        startTimeMs: nowMs,
        lastChunkTimeMs: nowMs,
        lastWriteAt: nowMs,
        isManualCut: false,
        isTimeoutTriggered: false,
        sessionId,
        utteranceIndex: job.utterance_index,
        pendingSmallSegments: [],
        pendingSmallSegmentsJobInfo: [],
        originalJobInfo: [],
      };
      this.buffers.set(bufferKey, buffer);
    } else {
      // ✅ 状态机检查：如果 buffer 处于 FINALIZING 或 CLOSED 状态，切换到新 epoch
      if (buffer.state === 'FINALIZING' || buffer.state === 'CLOSED') {
        const newEpoch = buffer.epoch + 1;
        logger.warn(
          {
            jobId: job.job_id,
            bufferKey,
            oldEpoch: buffer.epoch,
            newEpoch,
            oldState: buffer.state,
            reason: 'Buffer in FINALIZING/CLOSED state, switching to new epoch',
          },
          'AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch'
        );

        // 创建新 epoch 的 buffer
        buffer = {
          state: 'OPEN',
          epoch: newEpoch,
          bufferKey,
          audioChunks: [],
          totalDurationMs: 0,
          startTimeMs: nowMs,
          lastChunkTimeMs: nowMs,
          lastWriteAt: nowMs,
          isManualCut: false,
          isTimeoutTriggered: false,
          sessionId,
          utteranceIndex: job.utterance_index,
          pendingSmallSegments: [],
          pendingSmallSegmentsJobInfo: [],
          originalJobInfo: [],
        };
        this.buffers.set(bufferKey, buffer);
      } else {
        // 更新最后写入时间
        buffer.lastWriteAt = nowMs;

        // 调试日志：检查缓冲区状态
        logger.debug(
          {
            jobId: job.job_id,
            bufferKey,
            epoch: buffer.epoch,
            state: buffer.state,
            sessionId,
            utteranceIndex: job.utterance_index,
            hasPendingTimeoutAudio: !!buffer.pendingTimeoutAudio,
            hasPendingMaxDurationAudio: !!buffer.pendingMaxDurationAudio,
            hasPendingSmallSegments: buffer.pendingSmallSegments.length > 0,
            chunkCount: buffer.audioChunks.length,
            totalDurationMs: buffer.totalDurationMs,
            reason: 'Buffer found, checking state',
          },
          'AudioAggregator: [Debug] Buffer found, checking state'
        );
      }
    }

    // 确保 buffer 不是 undefined（TypeScript 类型检查）
    // 注意：在 currentBuffer 定义之前，buffer 可能为 undefined，所以需要检查
    if (!buffer) {
      logger.error(
        {
          jobId: job.job_id,
          bufferKey,
          sessionId,
          utteranceIndex: job.utterance_index,
        },
        'AudioAggregator: Buffer is undefined after creation/retrieval, this should not happen'
      );
      return {
        audioSegments: [],
        shouldReturnEmpty: true,
        reason: 'EMPTY_BUFFER',
      };
    }

    // 确保 buffer 不是 undefined（TypeScript 类型检查）
    const currentBuffer: AudioBuffer = buffer;

    // ✅ R4修复：检查是否为空音频（在更新缓冲区之前）
    // 如果当前音频为空且没有pending音频，应该立即返回EMPTY_INPUT
    if (currentAudio.length === 0 && currentDurationMs === 0) {
      const hasPendingMaxDurationAudio = !!currentBuffer.pendingMaxDurationAudio;
      const hasPendingTimeoutAudio = !!currentBuffer.pendingTimeoutAudio;
      const hasPendingSmallSegments = currentBuffer.pendingSmallSegments.length > 0;
      const hasBufferAudio = currentBuffer.audioChunks.length > 0 || currentBuffer.totalDurationMs > 0;

      // 只有在真正空音频时才返回空结果
      if (!hasPendingMaxDurationAudio && !hasPendingTimeoutAudio && !hasPendingSmallSegments && !hasBufferAudio) {
        // 删除缓冲区
        this.deleteBuffer(bufferKey, currentBuffer, 'Empty audio input', nowMs);
        return {
          audioSegments: [],
          shouldReturnEmpty: true,
          reason: 'EMPTY_INPUT',
        };
      }
    }

    // ============================================================
    // 关键：检查 pendingTimeoutAudio 是否超过 TTL（10秒）
    // 如果超过10秒且没有后续手动/静音切断，强制执行 finalize+ASR
    // 注意：pendingMaxDurationAudio 不需要 TTL 检查，因为它会在手动/timeout finalize 时被合并
    // ============================================================

    const ttlCheckResult = this.timeoutHandler.checkTimeoutTTL(currentBuffer, job, currentAudio, nowMs);

    if (ttlCheckResult) {
      if (ttlCheckResult.clearPendingTimeout) {
        currentBuffer.pendingTimeoutAudio = undefined;
        currentBuffer.pendingTimeoutAudioCreatedAt = undefined;
        currentBuffer.pendingTimeoutJobInfo = undefined;
      }

      if (ttlCheckResult.shouldProcess) {
        // 转换为base64字符串数组
        const audioSegmentsBase64 = ttlCheckResult.audioSegments.map(seg => seg.toString('base64'));

        return {
          audioSegments: audioSegmentsBase64,
          originalJobIds: ttlCheckResult.originalJobIds,
          shouldReturnEmpty: false,
          reason: 'NORMAL',
        };
      }
    }

    // 更新缓冲区（先更新，再处理 finalize，与备份代码一致）
    currentBuffer.audioChunks.push(currentAudio);
    currentBuffer.totalDurationMs += currentDurationMs;
    currentBuffer.lastChunkTimeMs = nowMs;
    currentBuffer.isManualCut = currentBuffer.isManualCut || isManualCut;
    currentBuffer.isTimeoutTriggered = currentBuffer.isTimeoutTriggered || isTimeoutTriggered;
    // 注意：isMaxDurationTriggered 不需要存储到 buffer，因为 MaxDuration 有独立的处理路径

    // 记录当前job在聚合音频中的字节偏移范围（用于originalJobIds分配）
    // ✅ 性能优化：只计算长度，不聚合完整Buffer（避免不必要的Buffer合并）
    const aggregatedAudioLength = currentBuffer.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
    const currentJobEndOffset = aggregatedAudioLength;

    // 获取expectedDurationMs（从job消息中，如果没有则使用当前时长的1.2倍作为估算）
    const expectedDurationMs = (job as any).expected_duration_ms ||
      Math.ceil(currentDurationMs * 1.2); // 如果没有，使用当前时长的1.2倍作为估算

    currentBuffer.originalJobInfo.push({
      jobId: job.job_id,
      startOffset: currentJobStartOffset,
      endOffset: currentJobEndOffset,
      utteranceIndex: job.utterance_index,
      expectedDurationMs: expectedDurationMs,
    });

    // 降低音频块添加日志级别为debug，减少终端输出（每个音频块都会触发，非常频繁）
    logger.debug(
      {
        jobId: job.job_id,
        sessionId,
        utteranceIndex: job.utterance_index,
        currentDurationMs,
        totalDurationMs: currentBuffer.totalDurationMs,
        chunkCount: currentBuffer.audioChunks.length,
        isManualCut,
        isTimeoutTriggered,
        isMaxDurationTriggered,
        bufferIsManualCut: currentBuffer.isManualCut,
        bufferIsTimeoutTriggered: currentBuffer.isTimeoutTriggered,
      },
      'AudioAggregator: Audio chunk added to buffer'
    );

    // 判断是否应该立即处理（聚合并返回）
    // 按照现在的设计，所有音频都在ASR之前等待处理标识：
    // 1. 手动截断（isManualCut）
    // 2. 超时finalize（isTimeoutTriggered，有特殊处理逻辑）
    // 3. MaxDuration finalize（isMaxDurationTriggered，有独立的处理路径）
    // 4. 10秒自动处理（如果用户说够10秒，应该足够ASR识别出正确的文本）
    // 5. 修复：如果isTimeoutTriggered为true（调度服务器的超时finalize），即使时长小于10秒也应该处理
    //    因为这是调度服务器检测到没有更多chunk后触发的finalize，说明这是最后一句话

    // ============================================================
    // 特殊处理：MaxDuration finalize
    // 策略：按能量切片，处理前5秒（及以上）音频，剩余部分缓存
    // ============================================================
    if (isMaxDurationTriggered) {
      // 注意：传入 currentAudio 用于空音频检查，handler 内部会使用 aggregateAudioChunks 聚合 currentBuffer.audioChunks
      // 统一流式切分逻辑：传入 AudioAggregator 的 createStreamingBatchesWithPending 方法
      const maxDurationResult = this.maxDurationHandler.handleMaxDurationFinalize(
        currentBuffer,
        job,
        currentAudio,
        nowMs,
        this.aggregateAudioChunks.bind(this),
        this.createStreamingBatchesWithPending.bind(this)
      );

      if (maxDurationResult.clearBuffer) {
        // ✅ P1修复：检查是否真正为空音频
        // 只有在没有pending音频时才允许返回空结果
        const hasPendingMaxDurationAudio = !!currentBuffer.pendingMaxDurationAudio;
        const hasPendingTimeoutAudio = !!currentBuffer.pendingTimeoutAudio;
        const hasPendingSmallSegments = currentBuffer.pendingSmallSegments.length > 0;

        if (hasPendingMaxDurationAudio || hasPendingTimeoutAudio || hasPendingSmallSegments) {
          // 有pending音频，不应该返回空结果
          logger.warn(
            {
              jobId: job.job_id,
              bufferKey,
              sessionId,
              utteranceIndex: job.utterance_index,
              hasPendingMaxDurationAudio,
              hasPendingTimeoutAudio,
              hasPendingSmallSegments,
              reason: 'ASR_FAILURE_PARTIAL',
            },
            'AudioAggregator: MaxDuration finalize with clearBuffer but has pending audio, should not return empty'
          );
          // 继续处理，不返回空结果
        } else {
          // 真正空音频，删除缓冲区
          this.deleteBuffer(bufferKey, currentBuffer, 'MaxDuration finalize with empty audio', nowMs);
          return {
            audioSegments: [],
            shouldReturnEmpty: true,
            isTimeoutPending: true,
            reason: 'EMPTY_INPUT',
          };
        }
      }

      // ✅ 状态机：进入 PENDING_MAXDUR 状态
      if (maxDurationResult.remainingAudio) {
        currentBuffer.state = 'PENDING_MAXDUR';
        logger.info(
          {
            jobId: job.job_id,
            bufferKey,
            epoch: currentBuffer.epoch,
            state: currentBuffer.state,
            remainingAudioDurationMs: (maxDurationResult.remainingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          },
          'AudioAggregator: [StateMachine] Buffer state -> PENDING_MAXDUR'
        );
      }

      // ✅ 修复：清空当前缓冲区（但保留 pendingMaxDurationAudio，如果有剩余部分）
      currentBuffer.audioChunks = [];
      currentBuffer.totalDurationMs = 0;
      currentBuffer.originalJobInfo = [];
      currentBuffer.isTimeoutTriggered = false;

      if (maxDurationResult.shouldProcess && maxDurationResult.audioSegments) {
        // 有≥5秒的音频需要处理，返回处理后的音频段
        logger.info(
          {
            jobId: job.job_id,
            bufferKey,
            epoch: currentBuffer.epoch,
            state: currentBuffer.state,
            sessionId,
            utteranceIndex: job.utterance_index,
            audioSegmentsCount: maxDurationResult.audioSegments.length,
            hasRemainingAudio: !!maxDurationResult.remainingAudio,
            remainingAudioDurationMs: maxDurationResult.remainingAudio
              ? (maxDurationResult.remainingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
              : 0,
            reason: 'MaxDuration finalize: processed first 5+ seconds, cached remaining audio',
          },
          'AudioAggregator: MaxDuration finalize processed first 5+ seconds'
        );

        // ✅ T1: 确认 Job1 MaxDuration finalize 后 pending 是否真的存在
        const pendingExists = !!currentBuffer.pendingMaxDurationAudio;
        const pendingDurationMs = currentBuffer.pendingMaxDurationAudio
          ? (currentBuffer.pendingMaxDurationAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
          : 0;
        const pendingSinceMs = currentBuffer.pendingMaxDurationAudioCreatedAt
          ? nowMs - currentBuffer.pendingMaxDurationAudioCreatedAt
          : 0;
        const pendingBufferBytes = currentBuffer.pendingMaxDurationAudio?.length || 0;
        logger.info(
          {
            testCase: 'R0/R1',
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            pendingExists,
            pendingDurationMs,
            pendingSinceMs,
            pendingBufferBytes,
            remainingAudioDurationMs: maxDurationResult.remainingAudio
              ? (maxDurationResult.remainingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
              : 0,
            reason: 'T1: Job1 MaxDuration finalize 后 pending 状态检查',
          },
          'AudioAggregator: [T1] Job1 MaxDuration finalize 后 pending 状态'
        );

        return {
          audioSegments: maxDurationResult.audioSegments,
          originalJobIds: maxDurationResult.originalJobIds,
          originalJobInfo: maxDurationResult.originalJobInfo,
          shouldReturnEmpty: false,
        };
      } else {
        // 没有≥5秒的音频，全部缓存
        logger.info(
          {
            jobId: job.job_id,
            bufferKey,
            epoch: currentBuffer.epoch,
            state: currentBuffer.state,
            sessionId,
            utteranceIndex: job.utterance_index,
            remainingAudioDurationMs: maxDurationResult.remainingAudio
              ? (maxDurationResult.remainingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
              : 0,
            reason: 'MaxDuration finalize: all audio cached (less than 5 seconds)',
          },
          'AudioAggregator: MaxDuration finalize cached all audio (less than 5 seconds)'
        );

        return {
          audioSegments: [],
          shouldReturnEmpty: true,
          isTimeoutPending: true,
          reason: 'ASR_FAILURE_PARTIAL',
        };
      }
    }

    // ✅ R4修复：检查是否为空音频（在shouldProcessNow之前）
    // 如果当前音频为空且没有pending音频，应该立即返回EMPTY_INPUT
    if (currentAudio.length === 0 && currentDurationMs === 0) {
      const hasPendingMaxDurationAudio = !!currentBuffer.pendingMaxDurationAudio;
      const hasPendingTimeoutAudio = !!currentBuffer.pendingTimeoutAudio;
      const hasPendingSmallSegments = currentBuffer.pendingSmallSegments.length > 0;
      const hasBufferAudio = currentBuffer.audioChunks.length > 0 || currentBuffer.totalDurationMs > 0;

      // 只有在真正空音频时才返回空结果
      if (!hasPendingMaxDurationAudio && !hasPendingTimeoutAudio && !hasPendingSmallSegments && !hasBufferAudio) {
        // 删除缓冲区
        this.deleteBuffer(bufferKey, currentBuffer, 'Empty audio input', nowMs);
        return {
          audioSegments: [],
          shouldReturnEmpty: true,
          reason: 'EMPTY_INPUT',
        };
      }
    }

    const shouldProcessNow =
      isManualCut ||  // 手动截断：立即处理
      isTimeoutTriggered ||  // 超时finalize（调度服务器检测到没有更多chunk），立即处理（即使时长小于10秒）
      currentBuffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||  // 超过最大缓冲时长（20秒）：立即处理
      (currentBuffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered && !isMaxDurationTriggered);  // 达到最短自动处理时长（10秒）且不是超时/MaxDuration触发：立即处理

    // ============================================================
    // 手动/timeout finalize：立即按能量切分，发送给ASR
    // ============================================================
    if (shouldProcessNow) {
      // ✅ 状态机：进入 FINALIZING 状态（冻结写入）
      currentBuffer.state = 'FINALIZING';
      currentBuffer.lastFinalizeAt = nowMs;
      logger.info(
        {
          jobId: job.job_id,
          bufferKey,
          epoch: currentBuffer.epoch,
          state: currentBuffer.state,
          reason: 'Starting finalize process (manual/timeout)',
        },
        'AudioAggregator: [StateMachine] Buffer state -> FINALIZING'
      );

      // 聚合当前音频
      const currentAggregated = this.aggregateAudioChunks(currentBuffer.audioChunks);

      // 使用finalizeHandler处理合并逻辑
      const finalizeResult = this.finalizeHandler.handleFinalize(
        currentBuffer,
        job,
        currentAggregated,
        nowMs,
        isManualCut,
        isTimeoutTriggered,  // 传递 isTimeoutTriggered 参数
      );

      // ✅ P0修复：如果pendingMaxDurationAudio需要继续等待，直接返回
      if (finalizeResult.shouldHoldPendingMaxDur) {
        const returnResult = {
          audioSegments: [],
          shouldReturnEmpty: true,
          reason: finalizeResult.reason || 'PENDING_MAXDUR_HOLD',
        };
        // ✅ T3(3): audio-aggregator.ts 最终返回前 - shouldHoldPendingMaxDur
        logger.info(
          {
            testCase: 'R0/R1',
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            returnReason: returnResult.reason,
            returnShouldReturnEmpty: returnResult.shouldReturnEmpty,
            finalizeResultReason: finalizeResult.reason,
            finalizeResultShouldHoldPendingMaxDur: finalizeResult.shouldHoldPendingMaxDur,
            reason: 'T3(3): audio-aggregator.ts 最终返回前 - shouldHoldPendingMaxDur',
          },
          'AudioAggregator: [T3(3)] 最终返回前'
        );
        return returnResult;
      }

      let audioToProcess = finalizeResult.audioToProcess;
      let jobInfoToProcess = finalizeResult.jobInfoToProcess;
      const hasMergedPendingAudio = finalizeResult.hasMergedPendingAudio;

      // ✅ R1修复：保存finalizeResult.reason，以便后续使用
      const finalizeReason = finalizeResult.reason;
      const shouldCachePendingTimeout = finalizeResult.shouldCachePendingTimeout || false;

      // ✅ 修复：只有在成功合并 pendingTimeoutAudio 时才清空它
      // 如果没有合并（例如 utteranceIndexDiff 不满足条件），应该保留 pendingTimeoutAudio 等待下一个 job
      if (hasMergedPendingAudio) {
        // 已成功合并，清空 pendingTimeoutAudio
        currentBuffer.pendingTimeoutAudio = undefined;
        currentBuffer.pendingTimeoutAudioCreatedAt = undefined;
        currentBuffer.pendingTimeoutJobInfo = undefined;
      } else if (shouldCachePendingTimeout) {
        // ✅ 缓存短音频到 pendingTimeoutAudio（类似 pause finalize 的逻辑）
        // 注意：使用 audioToProcess（已经处理过的音频），而不是重新聚合
        currentBuffer.pendingTimeoutAudio = audioToProcess;
        currentBuffer.pendingTimeoutAudioCreatedAt = nowMs;
        currentBuffer.pendingTimeoutJobInfo = jobInfoToProcess;

        // 记录 session affinity
        this.sessionAffinityManager.recordTimeoutFinalize(job.session_id);

        // ✅ 状态机：进入 PENDING_TIMEOUT 状态
        currentBuffer.state = 'PENDING_TIMEOUT';

        logger.info(
          {
            jobId: job.job_id,
            bufferKey,
            epoch: currentBuffer.epoch,
            state: currentBuffer.state,
            sessionId,
            utteranceIndex: job.utterance_index,
            audioDurationMs: (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          },
          'AudioAggregator: [StateMachine] Cached short timeout audio, state -> PENDING_TIMEOUT'
        );
      }
      // 如果没有合并且不需要缓存，保留 pendingTimeoutAudio（等待下一个 job 合并）


      // 清空pendingSmallSegments（已在finalizeHandler中处理）
      currentBuffer.pendingSmallSegments = [];
      currentBuffer.pendingSmallSegmentsJobInfo = [];

      const audioToProcessDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

      // 统一按能量切分：合并后的音频也切分，避免单 batch 导致两 job 中一个必为空容器（参见诊断文档 §2.4）
      // 优化：降低maxSegmentDurationMs从10秒到5秒，以便在长音频中识别自然停顿并切分
      // 这样9秒的音频如果有自然停顿（如呼吸），就能被切分成多个段，最大化利用audio-aggregator的功能
      const audioSegments = this.audioUtils.splitAudioByEnergy(
        audioToProcess,
        5000, // maxSegmentDurationMs: 5秒（从10秒降低，以便识别自然停顿）
        2000,  // minSegmentDurationMs: 2秒
        this.SPLIT_HANGOVER_MS
      );

      logger.info(
        {
          jobId: job.job_id,
          bufferKey,
          epoch: currentBuffer.epoch,
          state: currentBuffer.state,
          sessionId,
          utteranceIndex: job.utterance_index,
          hasMergedPendingAudio,
          inputAudioDurationMs: audioToProcessDurationMs,
          outputSegmentCount: audioSegments.length,
        },
        hasMergedPendingAudio
          ? 'AudioAggregator: Merged pending audio, split by energy'
          : 'AudioAggregator: Audio split by energy completed'
      );

      // 流式切分：组合成~5秒批次，处理pendingSmallSegments
      // 独立utterance（手动发送）时，不应该缓存剩余片段，应该全部处理
      const isIndependentUtterance = isManualCut;
      const shouldCacheRemaining = !isIndependentUtterance;

      // ✅ 架构设计：如果合并了pendingMaxDurationAudio，所有batch使用当前job的jobId
      // 原因：当前job触发的finalize，结果应该属于当前job，而不是pending的job
      // 设计：originalJobInfo只包含当前job，batch分配时所有batch都会被分配给当前job
      // 这样originalJobIds（从batchJobInfo派生）和originalJobInfo就一致了
      if (hasMergedPendingAudio) {
        // 合并pendingMaxDurationAudio时，使用当前job的jobId
        const currentJobInfo: OriginalJobInfo = {
          jobId: job.job_id,
          utteranceIndex: job.utterance_index,
          startOffset: 0,
          endOffset: audioToProcess.length,
        };
        jobInfoToProcess = [currentJobInfo];
      }

      const { batches: initialBatches, batchJobInfo: initialBatchJobInfo, remainingSmallSegments, remainingSmallSegmentsJobInfo } =
        this.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining);

      // 手动发送时，将剩余片段也加入到batches中（确保完整处理）
      let batches = initialBatches;
      let batchJobInfo = initialBatchJobInfo;
      if (isIndependentUtterance && remainingSmallSegments.length > 0) {
        const remainingBatch = Buffer.concat(remainingSmallSegments);
        batches = [...initialBatches, remainingBatch];
        // 为剩余 batch 添加 jobInfo（使用最后一个 job 的容器）
        if (remainingSmallSegmentsJobInfo.length > 0) {
          batchJobInfo = [...initialBatchJobInfo, remainingSmallSegmentsJobInfo[remainingSmallSegmentsJobInfo.length - 1]];
        } else if (jobInfoToProcess.length > 0) {
          batchJobInfo = [...initialBatchJobInfo, jobInfoToProcess[jobInfoToProcess.length - 1]];
        }
      }

      // 如果有剩余的小片段，缓存到pendingSmallSegments（等待下一个job合并）
      if (remainingSmallSegments.length > 0 && !isIndependentUtterance) {
        currentBuffer.pendingSmallSegments = remainingSmallSegments;
        currentBuffer.pendingSmallSegmentsJobInfo = remainingSmallSegmentsJobInfo;
      }

      // ✅ 架构设计：合并pending音频时，batch归属当前job（后一个job容器）
      // 原因：合并pending音频时，batch应该属于当前job（合并pending的job），而不是原始job（产生pending的job）
      // 设计：不修改createStreamingBatchesWithPending的逻辑，保持头部对齐策略的通用性
      // 只在合并pending音频时特殊处理：强制使用当前job的jobId
      const originalJobIds = hasMergedPendingAudio
        ? batches.map(() => job.job_id)  // 合并pending：归属当前job
        : batchJobInfo.map(info => info.jobId);  // 正常场景：头部对齐策略

      logger.info(
        {
          jobId: job.job_id,
          bufferKey,
          epoch: currentBuffer.epoch,
          batchesCount: batches.length,
          originalJobIds,
          assignStrategy: hasMergedPendingAudio ? 'force_current_job' : 'head_alignment',
          hasMergedPendingAudio,
          note: hasMergedPendingAudio
            ? 'Batches assigned to current job (merged pendingMaxDurationAudio)'
            : 'Unified batch assignment strategy (head alignment) for all finalize types',
        },
        hasMergedPendingAudio
          ? 'AudioAggregator: Batches assigned to current job (merged pendingMaxDurationAudio)'
          : 'AudioAggregator: Batches assigned using unified head alignment strategy'
      );

      // 转换为base64字符串数组
      const audioSegmentsBase64 = batches.map(batch => batch.toString('base64'));

      // ✅ P2增强：记录详细的日志信息
      const ownerJobId = originalJobIds[0] || job.job_id;
      const audioDurationMs = batches.reduce((total, batch) => {
        return total + (batch.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
      }, 0);

      // ✅ P0修复：从finalizeResult获取reason（如果有合并pendingMaxDurationAudio）
      // 注意：finalizeReason 已经在上面保存了
      const reason: AudioChunkResult['reason'] = (finalizeReason === 'NORMAL_MERGE' || finalizeReason === 'FORCE_FLUSH_PENDING_MAXDUR_TTL' || finalizeReason === 'FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE'
        ? finalizeReason
        : 'NORMAL') as AudioChunkResult['reason'];

      logger.info(
        {
          jobId: job.job_id,
          bufferKey,
          sessionId,
          utteranceIndex: job.utterance_index,
          ownerJobId,
          originalJobIds,
          originalJobIdsCount: originalJobIds.length,
          audioDurationMs,
          segmentsCount: batches.length,
          reason,
          pendingMaxDurState: currentBuffer.pendingMaxDurationAudio ? 'holding' : 'none',
        },
        'AudioAggregator: Sending audio segments to ASR'
      );

      // ✅ P1修复：如果没有任何批次，检查是否真正为空音频
      if (batches.length === 0) {
        const hasPendingMaxDurationAudio = !!currentBuffer.pendingMaxDurationAudio;
        const hasPendingTimeoutAudio = !!currentBuffer.pendingTimeoutAudio;
        const hasPendingSmallSegments = currentBuffer.pendingSmallSegments.length > 0;
        const hasBufferAudio = currentBuffer.audioChunks.length > 0 || currentBuffer.totalDurationMs > 0;

        // 只有在真正空音频时才返回空结果
        if (!hasPendingMaxDurationAudio && !hasPendingTimeoutAudio && !hasPendingSmallSegments && !hasBufferAudio) {
          return {
            audioSegments: [],
            shouldReturnEmpty: true,
            reason: 'EMPTY_INPUT',
          };
        } else {
          // 有pending音频或buffer音频，不应该返回空结果
          logger.warn(
            {
              jobId: job.job_id,
              bufferKey,
              sessionId,
              utteranceIndex: job.utterance_index,
              hasPendingMaxDurationAudio,
              hasPendingTimeoutAudio,
              hasPendingSmallSegments,
              hasBufferAudio,
              reason: 'ASR_FAILURE_PARTIAL',
            },
            'AudioAggregator: No batches but has pending/buffer audio, should not return empty'
          );
          // 保留缓冲区，等待后续处理
          return {
            audioSegments: [],
            shouldReturnEmpty: false, // 不返回空，保留缓冲区
            reason: 'ASR_FAILURE_PARTIAL',
          };
        }
      }

      // ✅ 修复：删除或清理缓冲区（与备份代码保持一致）
      // 如果有 pending 音频（timeout 或 MaxDuration），保留 buffer；否则删除 buffer
      // 备份代码逻辑：if (currentBuffer.pendingTimeoutAudio || currentBuffer.pendingPauseAudio) { 保留 } else { 删除 }
      const pendingTimeoutAudioLength = currentBuffer.pendingTimeoutAudio?.length || 0;
      const pendingMaxDurationAudioLength = currentBuffer.pendingMaxDurationAudio?.length || 0;
      const pendingSmallSegmentsCount = currentBuffer.pendingSmallSegments.length;

      if (currentBuffer.pendingTimeoutAudio || currentBuffer.pendingMaxDurationAudio) {
        // 保留pending音频，只清空已处理的状态
        currentBuffer.audioChunks = [];
        currentBuffer.totalDurationMs = 0;
        currentBuffer.originalJobInfo = [];
        currentBuffer.isManualCut = false;
        currentBuffer.isTimeoutTriggered = false;
        // 注意：pendingTimeoutAudio 或 pendingMaxDurationAudio 应该保留（等待下一个 job 合并）
        // ✅ 状态机：如果有 pending，保持当前状态或进入 PENDING_TIMEOUT/PENDING_MAXDUR
        if (currentBuffer.pendingTimeoutAudio) {
          currentBuffer.state = 'PENDING_TIMEOUT';
        } else if (currentBuffer.pendingMaxDurationAudio) {
          currentBuffer.state = 'PENDING_MAXDUR';
        }

        logger.info(
          {
            jobId: job.job_id,
            bufferKey,
            epoch: currentBuffer.epoch,
            state: currentBuffer.state,
            utteranceIndex: job.utterance_index,
            decisionBranch: 'KEEP_BUFFER_WITH_PENDING_AUDIO',
            pendingTimeoutAudioLength,
            pendingMaxDurationAudioLength,
            pendingSmallSegmentsCount,
            reason: 'Buffer retained because pendingTimeoutAudio or pendingMaxDurationAudio exists',
          },
          'AudioAggregator: [BufferDelete] Buffer retained (pendingTimeoutAudio or pendingMaxDurationAudio exists)'
        );
      } else {
        // 没有 pending 音频，可以安全删除缓冲区
        this.deleteBuffer(bufferKey, currentBuffer, 'No pending audio after finalize', nowMs);
      }

      const returnResult = {
        audioSegments: audioSegmentsBase64,
        originalJobIds,
        originalJobInfo: jobInfoToProcess,
        shouldReturnEmpty: false,
        reason, // ✅ R1修复：包含reason字段
      };
      // ✅ T3(3): audio-aggregator.ts 最终返回前 - 正常处理
      logger.info(
        {
          testCase: 'R0/R1',
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          returnReason: returnResult.reason,
          returnShouldReturnEmpty: returnResult.shouldReturnEmpty,
          finalizeReason,
          reasonValue: reason,
          reason: 'T3(3): audio-aggregator.ts 最终返回前 - 正常处理',
        },
        'AudioAggregator: [T3(3)] 最终返回前'
      );
      return returnResult;
    }

    // 继续缓冲
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
      reason: 'NORMAL', // 正常缓冲，等待更多音频
    };
  }

  /**
   * 聚合多个音频块为一个完整的音频
   */
  private aggregateAudioChunks(chunks: Buffer[]): Buffer {
    return this.audioMerger.aggregateAudioChunks(chunks);
  }


  /**
   * 清空指定会话的缓冲区（用于错误处理或会话结束）
   * 
   * @deprecated 为了向后兼容保留，新代码应该使用 bufferKey
   */
  clearBuffer(sessionId: string): void {
    // 注意：为了向后兼容，这里仍然使用 sessionId 作为 bufferKey
    // 但在新代码中应该使用 buildBufferKey() 生成的 bufferKey
    const bufferKey = sessionId;  // 临时兼容
    const buffer = this.buffers.get(bufferKey);
    if (buffer) {
      this.deleteBuffer(bufferKey, buffer, 'Manual clear (error handling or session end)', Date.now());
    }
  }

  /**
   * 删除缓冲区（带删除原因和 pending 状态日志）
   * 
   * @param bufferKey Buffer key
   * @param buffer Buffer 对象（如果已知）
   * @param reason 删除原因
   * @param nowMs 当前时间戳
   */
  private deleteBuffer(
    bufferKey: string,
    buffer: AudioBuffer | undefined,
    reason: string,
    nowMs: number
  ): void {
    if (!buffer) {
      buffer = this.buffers.get(bufferKey);
    }

    if (buffer) {
      const pendingTimeoutAudioLength = buffer.pendingTimeoutAudio?.length || 0;
      const pendingMaxDurationAudioLength = buffer.pendingMaxDurationAudio?.length || 0;
      const pendingSmallSegmentsCount = buffer.pendingSmallSegments.length;

      logger.info(
        {
          bufferKey,
          epoch: buffer.epoch,
          state: buffer.state,
          reason,
          decisionBranch: 'DELETE_BUFFER',
          pendingTimeoutAudioLength,
          pendingMaxDurationAudioLength,
          pendingSmallSegmentsCount,
          hasPendingTimeout: !!buffer.pendingTimeoutAudio,
          hasPendingMaxDuration: !!buffer.pendingMaxDurationAudio,
          hasPendingSmallSegments: buffer.pendingSmallSegments.length > 0,
          lastWriteAt: buffer.lastWriteAt,
          lastFinalizeAt: buffer.lastFinalizeAt,
        },
        'AudioAggregator: [BufferDelete] Buffer deleted with reason and pending status'
      );

      // ✅ 状态机：进入 CLOSED 状态
      buffer.state = 'CLOSED';
      this.buffers.delete(bufferKey);
    }
  }

  /**
   * 清理所有过期缓冲区（用于防止内存泄漏）
   * 清理条件：
   * 1. pendingTimeoutAudio 超过 TTL（10秒）且没有后续活动
   * 2. pendingMaxDurationAudio 超过 TTL（10秒）且没有后续活动
   * 3. 缓冲区超过最大空闲时间（5分钟）
   */
  cleanupExpiredBuffers(): void {
    const nowMs = Date.now();
    const MAX_IDLE_TIME_MS = 5 * 60 * 1000; // 5分钟
    const expiredBufferKeys: string[] = [];

    for (const [bufferKey, buffer] of this.buffers.entries()) {
      const lastActivityMs = buffer.lastChunkTimeMs;
      const idleTimeMs = nowMs - lastActivityMs;

      // ✅ 修复：检查 pendingTimeoutAudio 和 pendingMaxDurationAudio TTL
      let shouldCleanup = false;
      if (buffer.pendingTimeoutAudio && buffer.pendingTimeoutAudioCreatedAt) {
        const pendingAgeMs = nowMs - buffer.pendingTimeoutAudioCreatedAt;
        if (pendingAgeMs >= this.PENDING_TIMEOUT_AUDIO_TTL_MS * 2) {
          // 超过 TTL 的2倍，说明已经没有后续活动，可以清理
          shouldCleanup = true;
        }
      }
      if (buffer.pendingMaxDurationAudio && buffer.pendingMaxDurationAudioCreatedAt) {
        const pendingAgeMs = nowMs - buffer.pendingMaxDurationAudioCreatedAt;
        if (pendingAgeMs >= this.PENDING_TIMEOUT_AUDIO_TTL_MS * 2) {
          // 超过 TTL 的2倍，说明已经没有后续活动，可以清理
          shouldCleanup = true;
        }
      }

      // 检查缓冲区空闲时间
      if (idleTimeMs >= MAX_IDLE_TIME_MS) {
        shouldCleanup = true;
      }

      if (shouldCleanup) {
        expiredBufferKeys.push(bufferKey);
      }
    }

    // 清理过期缓冲区
    for (const bufferKey of expiredBufferKeys) {
      const buffer = this.buffers.get(bufferKey);
      if (buffer) {
        const pendingTimeoutAudioLength = buffer.pendingTimeoutAudio?.length || 0;
        const pendingMaxDurationAudioLength = buffer.pendingMaxDurationAudio?.length || 0;
        const pendingSmallSegmentsCount = buffer.pendingSmallSegments.length;
        const idleTimeMs = nowMs - buffer.lastChunkTimeMs;
        const pendingTimeoutAudioAge = buffer.pendingTimeoutAudioCreatedAt
          ? nowMs - buffer.pendingTimeoutAudioCreatedAt
          : 0;
        const pendingMaxDurationAudioAge = buffer.pendingMaxDurationAudioCreatedAt
          ? nowMs - buffer.pendingMaxDurationAudioCreatedAt
          : 0;

        logger.info(
          {
            bufferKey,
            decisionBranch: 'CLEANUP_EXPIRED_BUFFER',
            idleTimeMs,
            pendingTimeoutAudioAge,
            pendingMaxDurationAudioAge,
            pendingTimeoutAudioLength,
            pendingMaxDurationAudioLength,
            pendingSmallSegmentsCount,
            chunkCount: buffer.audioChunks.length,
            totalDurationMs: buffer.totalDurationMs,
            reason: `Buffer expired (idle: ${idleTimeMs}ms, pendingTimeoutAudio age: ${pendingTimeoutAudioAge}ms, pendingMaxDurationAudio age: ${pendingMaxDurationAudioAge}ms)`,
          },
          'AudioAggregator: [BufferDelete] Expired buffer cleaned up'
        );
        this.buffers.delete(bufferKey);
      }
    }
  }

  /**
   * 创建流式批次：将音频段组合成~5秒批次
   * 
   * @param audioSegments 切分后的音频段数组
   * @param jobInfo 原始job信息映射
   * @param shouldCacheRemaining 是否缓存剩余小片段（手动发送时应该为false）
   * @returns 批次数组和剩余小片段
   */
  private createStreamingBatchesWithPending(
    audioSegments: Buffer[],
    jobInfo: OriginalJobInfo[],
    shouldCacheRemaining: boolean = true
  ): {
    batches: Buffer[];
    batchJobInfo: OriginalJobInfo[];
    remainingSmallSegments: Buffer[];
    remainingSmallSegmentsJobInfo: OriginalJobInfo[];
  } {
    return this.streamBatcher.createStreamingBatchesWithPending(audioSegments, jobInfo, shouldCacheRemaining);
  }


  /**
   * 获取缓冲区（用于检查 pendingMaxDurationAudio）
   * 
   * @param job JobAssignMessage（用于构建正确的 bufferKey）
   * @returns AudioBuffer 或 undefined
   */
  getBuffer(job: JobAssignMessage): AudioBuffer | undefined {
    const bufferKey = buildBufferKey(job);
    return this.buffers.get(bufferKey);
  }

  /**
   * 获取缓冲区状态（用于调试）
   * 
   * @deprecated 为了向后兼容保留，新代码应该使用 bufferKey
   */
  getBufferStatus(sessionId: string): {
    bufferKey: string;
    epoch: number;
    state: BufferState;
    chunkCount: number;
    totalDurationMs: number;
    isManualCut: boolean;
    isTimeoutTriggered: boolean;
    hasPendingTimeoutAudio: boolean;
    pendingTimeoutAudioDurationMs?: number;
    hasPendingMaxDurationAudio: boolean;
    pendingMaxDurationAudioDurationMs?: number;
    pendingSmallSegmentsCount: number;
  } | null {
    // 注意：为了向后兼容，这里仍然使用 sessionId 作为 bufferKey
    const bufferKey = sessionId;  // 临时兼容
    const buffer = this.buffers.get(bufferKey);
    if (!buffer) {
      return null;
    }

    return {
      bufferKey: buffer.bufferKey,
      epoch: buffer.epoch,
      state: buffer.state,
      chunkCount: buffer.audioChunks.length,
      totalDurationMs: buffer.totalDurationMs,
      isManualCut: buffer.isManualCut,
      isTimeoutTriggered: buffer.isTimeoutTriggered,
      hasPendingTimeoutAudio: !!buffer.pendingTimeoutAudio,
      pendingTimeoutAudioDurationMs: buffer.pendingTimeoutAudio
        ? (buffer.pendingTimeoutAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
        : undefined,
      hasPendingMaxDurationAudio: !!buffer.pendingMaxDurationAudio,
      pendingMaxDurationAudioDurationMs: buffer.pendingMaxDurationAudio
        ? (buffer.pendingMaxDurationAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
        : undefined,
      pendingSmallSegmentsCount: buffer.pendingSmallSegments.length,
    };
  }
}

