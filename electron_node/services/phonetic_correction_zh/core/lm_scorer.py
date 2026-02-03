# -*- coding: utf-8 -*-
"""中文字符级 KenLM 打分，进程内加载 zh_char_3gram.trie.bin。"""

import os
import sys
from typing import Optional, Tuple, Callable

from .char_tokenize import tokenize_for_lm

DEFAULT_MODEL_NAME = "zh_char_3gram.trie.bin"


def get_model_path(service_dir: str) -> Optional[str]:
    env_path = os.environ.get("CHAR_LM_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path
    p = os.path.join(service_dir, "models", DEFAULT_MODEL_NAME)
    return p if os.path.isfile(p) else None


class LmScorer:
    """KenLM 打分器，字符级中文。"""

    def __init__(self, model_path: str, tokenize_fn: Callable[[str], str]):
        import kenlm
        self._model = kenlm.LanguageModel(model_path)
        self.model_path = model_path
        self._tokenize = tokenize_fn

    def score(self, text: str) -> Tuple[float, int]:
        tokenized = self._tokenize(text)
        if not tokenized:
            return 0.0, 0
        s = self._model.score(tokenized)
        return float(s), 0


_scorer_cache: Optional[LmScorer] = None


def get_lm_scorer(service_dir: str) -> Optional[LmScorer]:
    """懒加载中文 LM；不可用时为 None。"""
    global _scorer_cache
    if _scorer_cache is not None:
        return _scorer_cache
    path = get_model_path(service_dir)
    if not path:
        return None
    try:
        _scorer_cache = LmScorer(path, tokenize_for_lm)
        return _scorer_cache
    except Exception as e:
        print(f"[lm_scorer] KenLM 加载失败: {e}", file=sys.stderr)
        return None
