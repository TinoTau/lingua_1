"""
ASR Sherpa-LM 识别器：方案 A 单路径
音频 -> fbank -> ONNX(log_probs) -> pyctcdecode -> text + N-best
"""
import logging
import time
from typing import List, Tuple

import numpy as np

from config import (
    get_model_config,
    NUM_THREADS,
    PROVIDER,
    SAMPLE_RATE,
    BEAM_WIDTH,
    NBEST,
    KENLM_PATH,
    LM_ALPHA,
    LM_BETA,
)
from features import waveform_to_fbank
from onnx_runner import load_session, run as onnx_run, get_output_vocab_size, input_is_waveform
from ctc_decode import build_decoder, decode as ctc_decode

logger = logging.getLogger(__name__)

_ready = False
_inited = False


def _init():
    """加载 ONNX 与 CTC 解码器，成功则 _ready=True。只尝试一次。"""
    global _ready, _inited
    if _inited:
        return
    _inited = True
    cfg = get_model_config()
    if cfg is None:
        logger.info("ASR Sherpa-LM: no model dir configured")
        return
    tokens_path, model_path = cfg[0], cfg[1]
    if not load_session(model_path, provider=PROVIDER, num_threads=NUM_THREADS):
        return
    vocab_size = get_output_vocab_size()
    if not build_decoder(
        tokens_path,
        vocab_size=vocab_size,
        kenlm_path=KENLM_PATH,
        beam_width=BEAM_WIDTH,
        alpha=LM_ALPHA,
        beta=LM_BETA,
    ):
        return
    _ready = True
    logger.info(
        "ASR Sherpa-LM: pipeline ready (ONNX + pyctcdecode, beam=%d nbest=%d, kenlm=%s)",
        BEAM_WIDTH, NBEST, "yes" if KENLM_PATH else "no",
    )


def recognize(audio_float32: np.ndarray, sample_rate: int) -> Tuple[str, List[dict], float]:
    """
    单路径：fbank -> ONNX -> pyctcdecode。
    返回 (text, nbest_list, decode_ms)。未就绪时返回 ("", [], 0.0)。
    """
    global _ready
    if not _ready:
        if _ready is False and get_model_config() is not None:
            _init()
        if not _ready:
            return "", [], 0.0

    t0 = time.perf_counter()
    if input_is_waveform():
        x = np.asarray(audio_float32, dtype=np.float32).reshape(1, -1)
        num_frames = x.shape[1]
    else:
        x, num_frames = waveform_to_fbank(audio_float32, sample_rate)
    log_probs, log_probs_length = onnx_run(x, num_frames)
    if log_probs is None:
        return "", [], (time.perf_counter() - t0) * 1000

    text, nbest_list = ctc_decode(log_probs, log_probs_length, num_results=NBEST)
    decode_ms = (time.perf_counter() - t0) * 1000
    logger.info("ASR Sherpa-LM decode_ms=%.0f text_len=%d nbest=%d", decode_ms, len(text), len(nbest_list))
    return text, nbest_list, decode_ms


def is_ready() -> bool:
    return _ready
