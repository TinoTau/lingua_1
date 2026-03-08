"""
CTC beam 解码：log_probs -> text + N-best。pyctcdecode；词表中 <blk>/<blank> 对应 blank，输出中过滤。
"""
import hashlib
import logging
import os
import re
from typing import List, Optional, Tuple

import numpy as np

from config import BEAM_WIDTH, LM_ALPHA, LM_BETA, NBEST

try:
    from pyctcdecode import build_ctcdecoder
    from pyctcdecode import decoder as _decoder_mod
except ImportError:
    build_ctcdecoder = None
    _decoder_mod = None

logger = logging.getLogger(__name__)

_decoder = None
_labels = None


def _tokens_file_hash(tokens_path: str) -> str:
    """计算 tokens 文件内容的短 hash，便于回溯与断言记录。"""
    if not os.path.isfile(tokens_path):
        return ""
    with open(tokens_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def _sanity_check_labels(labels: List[str], check_len: int = 20) -> None:
    """
    启动时自检：解析后前 check_len 项若大量为「单数字/非字母」等，极可能 symbol/id 反了或格式错，拒绝启动。
    英语 CTC 前几项通常为 blank、空格、字母等，不应以随机数字为主。
    """
    sample = [labels[i] for i in range(min(check_len, len(labels)))]
    suspicious = 0
    for s in sample:
        if not s or (s or "").strip().lower() in {"<blk>", "blk", "<blank>"}:
            continue
        s = (s or "").strip()
        if len(s) == 1 and s.isdigit():
            suspicious += 1
        elif len(s) == 1 and not s.isalpha():
            suspicious += 1
    if suspicious >= max(5, check_len // 2):
        raise ValueError(
            "tokens format mismatch: first %d labels have too many digits/symbols (%d). "
            "Check tokens.txt format (symbol id vs id symbol) and parsing."
            % (check_len, suspicious)
        )


def _normalize_decoded_text(raw: str) -> str:
    """解码文本规范化：去掉 ▁、归一化空白，移除 <blk>/<blank> 等占位符。"""
    if not raw:
        return ""
    s = raw.strip().replace("\u2581", "")
    s = re.sub(r"\s*<blk>\s*", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*<blank>\s*", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\bblk\b", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*_blk\d+\s*", " ", s)  # 解码时 blank 占位符
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
    blank_index_override: Optional[int] = None,
    model_path: Optional[str] = None,
) -> bool:
    """构建 pyctcdecode 解码器；若提供 kenlm_path 则 beam 解码时用 KenLM 参与打分并用于 n-best rerank。"""
    global _decoder, _labels
    if build_ctcdecoder is None:
        logger.warning("pyctcdecode not installed: pip install pyctcdecode")
        return False
    if kenlm_path and kenlm_path.endswith(".arpa") and _decoder_mod is not None:
        _decoder_mod.load_unigram_set_from_arpa = _load_unigram_set_from_arpa_utf8
    labels = _load_labels(tokens_path)
    if not labels:
        logger.warning("No labels loaded from %s", tokens_path)
        return False
    # 启动时自检：tokens 解析后前 20 项若大量为数字/符号，极可能 format 反了，拒绝启动
    _sanity_check_labels(labels, check_len=20)
    if vocab_size is not None and len(labels) != vocab_size:
        labels = labels[:vocab_size]
        logger.info("Labels truncated to %d to match ONNX output", vocab_size)
    tokens_hash = _tokens_file_hash(tokens_path)
    model_id = os.path.basename(os.path.dirname(model_path)) if model_path else ""
    # blank 在词表中的实际位置（如 Conformer 的 1024）设为 ""，其余 blank 类用唯一占位符避免重复
    blank_index: Optional[int] = None
    blank_done = False
    for i in range(len(labels)):
        if (labels[i] or "").strip().lower() in {"<blk>", "blk", "<blank>"}:
            if not blank_done:
                labels[i] = ""
                blank_done = True
                blank_index = i
            else:
                labels[i] = "_blk" + str(i)
    # 若配置了 blank_index_override（如 ASR_SHERPA_EN_BLANK_INDEX=4），强制该 index 为 blank，避免 "4" 等被当作文本
    if blank_index_override is not None and 0 <= blank_index_override < len(labels):
        old_sym = labels[blank_index_override]
        labels[blank_index_override] = ""
        logger.info("CTC blank_index_override=%d (was %r)", blank_index_override, old_sym)
    # 启动断言：blank_index_override 生效后，该位必须为空，否则拒绝启动
    if blank_index_override is not None and 0 <= blank_index_override < len(labels):
        if (labels[blank_index_override] or "") != "":
            raise RuntimeError(
                "blank_index_override=%d but labels[%d]=%r (expected ''). Decoder build contract violated."
                % (blank_index_override, blank_index_override, labels[blank_index_override])
            )
    _labels = labels
    # 硬契约记录：便于回溯与问题定位
    logger.info(
        "CTC decoder contract: model_id=%s tokens_hash=%s blank_index=%s blank_index_override=%s first_20=%s",
        model_id,
        tokens_hash,
        blank_index,
        blank_index_override,
        [labels[i] for i in range(min(20, len(labels)))],
    )
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


def decode(log_probs: np.ndarray, log_probs_length: Optional[np.ndarray] = None, num_results: Optional[int] = None) -> Tuple[str, List[dict], str]:
    """
    log_probs (T, vocab_size) 或 (1, T, V)，float32。
    调用 decode_beams 得到多条 beam，规范化为中文文本后返回。
    返回 (best_text, nbest_list, beam0_raw)。beam0_raw 为 pyctcdecode 首条 beam 归一化前文本，用于「数字 4」定位。
    """
    global _decoder
    if _decoder is None:
        return "", [], ""

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
        return "", [], ""

    # OutputBeam = (text, lm_state, text_frames, logit_score, lm_score)；用 combined 对 n-best rerank
    seen: set = set()
    nbest_list: List[dict] = []
    beam0_raw = ""
    for i, beam in enumerate(beams):
        if len(nbest_list) >= n:
            break
        text_raw = (beam[0] or "").strip()
        if i == 0:
            beam0_raw = text_raw
            if text_raw:
                logger.info("CTC decode beam0 raw=%r", text_raw[:200])
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
    return best_text, nbest_list, beam0_raw
