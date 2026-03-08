"""
CTC beam 解码：log_probs -> text + N-best。
使用 pyctcdecode decode_beams；labels 与 ONNX 输出维度对齐，blank 统一为 ""。
"""
import logging
import os
from typing import List, Optional, Tuple

import numpy as np

from config import BEAM_WIDTH, NBEST, LM_ALPHA, LM_BETA

logger = logging.getLogger(__name__)

_decoder = None
_labels = None


def _normalize_decoded_text(raw: str) -> str:
    """解码文本规范化：去掉 ▁、归一化空白。"""
    if not raw:
        return ""
    s = raw.strip().replace("\u2581", "")
    return " ".join(s.split()).strip()


def _load_labels(tokens_path: str) -> List[str]:
    """从 sherpa tokens.txt（symbol id 每行）得到 labels[i]=symbol；重复符号加 _idx 以去重。"""
    if not os.path.isfile(tokens_path):
        return []
    with open(tokens_path, "r", encoding="utf-8", errors="replace") as f:
        lines = [line.strip() for line in f if line.strip()]
    idx_to_sym = {}
    for line in lines:
        parts = line.split()
        if len(parts) >= 2:
            try:
                idx = int(parts[-1])
                sym = " ".join(parts[:-1]).strip()
            except ValueError:
                idx = len(idx_to_sym)
                sym = line
        else:
            idx = len(idx_to_sym)
            sym = line.strip()
        idx_to_sym[idx] = sym
    n = max(idx_to_sym) + 1 if idx_to_sym else 0
    raw = [idx_to_sym.get(i, "") for i in range(n)]
    seen: set = set()
    labels = []
    for i, s in enumerate(raw):
        if s in seen:
            s = f"{s}_{i}"
        else:
            seen.add(s)
        labels.append(s)
    return labels


def _load_unigram_set_from_arpa_utf8(arpa_path: str):
    """与 pyctcdecode 的 load_unigram_set_from_arpa 逻辑一致，但用 UTF-8 打开 .arpa（避免 Windows 下 gbk 报错）。"""
    unigrams = set()
    with open(arpa_path, encoding="utf-8", errors="replace") as f:
        start_1_gram = False
        for line in f:
            line = line.strip()
            if line == "\\1-grams:":
                start_1_gram = True
            elif line == "\\2-grams:":
                break
            if start_1_gram and len(line) > 0:
                parts = line.split("\t")
                if len(parts) == 3:
                    unigrams.add(parts[1])
    if len(unigrams) == 0:
        raise ValueError("No unigrams found in arpa file. Something is wrong with the file.")
    return unigrams


def build_decoder(
    tokens_path: str,
    vocab_size: Optional[int] = None,
    kenlm_path: Optional[str] = None,
    alpha: float = 0.5,
    beta: float = 1.0,
    beam_width: int = 4,
) -> bool:
    """构建 pyctcdecode 解码器；若提供 kenlm_path 则 beam 解码时用 KenLM 参与打分并用于 n-best rerank。"""
    global _decoder, _labels
    try:
        from pyctcdecode import build_ctcdecoder
        from pyctcdecode import decoder as _decoder_mod
        # Windows 下 .arpa 需 UTF-8，pyctcdecode 内部 open() 无 encoding，替换 decoder 中的引用
        if kenlm_path and kenlm_path.endswith(".arpa"):
            _decoder_mod.load_unigram_set_from_arpa = _load_unigram_set_from_arpa_utf8
    except ImportError:
        logger.warning("pyctcdecode not installed: pip install pyctcdecode")
        return False
    labels = _load_labels(tokens_path)
    if not labels:
        logger.warning("No labels loaded from %s", tokens_path)
        return False
    if vocab_size is not None and len(labels) != vocab_size:
        labels = labels[:vocab_size]
        logger.info("Labels truncated to %d to match ONNX output", vocab_size)
    if labels:
        labels[0] = ""
    _labels = labels
    kwargs = {}
    if kenlm_path and os.path.isfile(kenlm_path):
        kwargs["kenlm_model_path"] = kenlm_path
        kwargs["alpha"] = alpha
        kwargs["beta"] = beta
        logger.info("KenLM loaded for rerank: %s (alpha=%.2f beta=%.2f)", kenlm_path, alpha, beta)
    else:
        if kenlm_path:
            logger.warning("KenLM path not found, beam decode without LM: %s", kenlm_path)
    _decoder = build_ctcdecoder(labels, **kwargs)
    logger.info("CTC decoder built: vocab_size=%d beam_width=%d", len(labels), beam_width)
    return True


def decode(log_probs: np.ndarray, log_probs_length: Optional[np.ndarray] = None, num_results: Optional[int] = None) -> Tuple[str, List[dict]]:
    """
    log_probs (T, vocab_size) 或 (1, T, V)，float32。
    调用 decode_beams 得到多条 beam，规范化为中文文本后返回。
    返回 (best_text, nbest_list)，nbest_list 为 [{"text": str, "score": float}, ...]。
    """
    global _decoder
    if _decoder is None:
        return "", []

    if log_probs.ndim == 3:
        log_probs = log_probs[0]
    T, V = log_probs.shape
    if log_probs_length is not None:
        L = int(log_probs_length.flat[0])
        log_probs = log_probs[:L]
    n = num_results if num_results is not None else NBEST
    try:
        # decode_beams 返回 List[(text, lm_state, text_frames, logit_score, lm_score)]
        beams = _decoder.decode_beams(log_probs, beam_width=max(BEAM_WIDTH, n))
    except Exception as e:
        logger.warning("pyctcdecode decode_beams error: %s", e)
        return "", []

    # OutputBeam = (text, lm_state, text_frames, logit_score, lm_score)；用 combined 对 n-best rerank
    seen: set = set()
    nbest_list: List[dict] = []
    for i, beam in enumerate(beams):
        if len(nbest_list) >= n:
            break
        text_raw = (beam[0] or "").strip()
        text_norm = _normalize_decoded_text(text_raw)
        if text_norm in seen:
            continue
        seen.add(text_norm)
        logit_score = float(beam[3]) if len(beam) > 3 else 0.0
        lm_score = float(beam[4]) if len(beam) > 4 else 0.0
        combined = LM_ALPHA * logit_score + LM_BETA * lm_score
        nbest_list.append({"text": text_norm, "score": combined, "logit_score": logit_score, "lm_score": lm_score})
    # 按综合分降序排序（score 越大越好，logit/lm 为 log 概率负值）
    nbest_list.sort(key=lambda x: x["score"], reverse=True)
    best_text = nbest_list[0]["text"] if nbest_list else ""
    return best_text, nbest_list


def get_decoder():
    return _decoder
