# -*- coding: utf-8 -*-
"""中文同音纠错核心逻辑。"""

from .rescore import phonetic_correct, rescore_with_lm

__all__ = ["phonetic_correct", "rescore_with_lm"]
