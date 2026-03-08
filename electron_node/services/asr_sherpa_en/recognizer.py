"""英文 CTC 识别器：音频 -> fbank(含 CMVN) -> ONNX -> pyctcdecode -> text + N-best。仅 Conformer small。"""
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
    BLANK_INDEX_INT,
)
from features import waveform_to_fbank
from onnx_runner import load_session, run as onnx_run, get_output_vocab_size
from ctc_decode import build_decoder, decode as ctc_decode

logger = logging.getLogger(__name__)

_ready = False
_inited = False


def _init():
    global _ready, _inited
    if _inited:
        return
    _inited = True
    cfg = get_model_config()
    if cfg is None:
        logger.info("ASR Sherpa-EN: no model dir configured")
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
        blank_index_override=BLANK_INDEX_INT,
        model_path=model_path,
    ):
        return
    _ready = True
    logger.info("ASR Sherpa-EN: pipeline ready (beam=%d nbest=%d)", BEAM_WIDTH, NBEST)


def recognize(audio_float32: np.ndarray, sample_rate: int) -> Tuple[str, List[dict], float, str]:
    """返回 (text, nbest_list, decode_ms, beam0_raw)。beam0_raw 用于「数字 4」最小定位实验。"""
    global _ready
    if not _ready:
        if _ready is False and get_model_config() is not None:
            _init()
        if not _ready:
            return "", [], 0.0, ""
    t0 = time.perf_counter()
    x, num_frames = waveform_to_fbank(audio_float32, sample_rate)
    log_probs, log_probs_length = onnx_run(x, num_frames)
    if log_probs is None:
        return "", [], (time.perf_counter() - t0) * 1000, ""
    text, nbest_list, beam0_raw = ctc_decode(log_probs, log_probs_length, num_results=NBEST)
    decode_ms = (time.perf_counter() - t0) * 1000
    logger.info("ASR Sherpa-EN decode_ms=%.0f text_len=%d nbest=%d", decode_ms, len(text), len(nbest_list))
    return text, nbest_list, decode_ms, beam0_raw


def is_ready() -> bool:
    return _ready
