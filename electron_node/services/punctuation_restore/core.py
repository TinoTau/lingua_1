# -*- coding: utf-8 -*-
"""FunASR ct-punc 断句推理（GPU）"""

try:
    from funasr import AutoModel
except ImportError:
    AutoModel = None

_model = None


def load_model():
    global _model
    if _model is None:
        if AutoModel is None:
            raise RuntimeError("funasr not installed; cannot load ct-punc model")
        _model = AutoModel(
            model="ct-punc",
            model_revision="v2.0.4",
            device="cuda:0",
        )
    return _model


def punctuate(text: str) -> str:
    if not text or not text.strip():
        return text
    model = load_model()
    res = model.generate(input=text.strip())
    if not res:
        return text
    item = res[0]
    out = item.get("text") if isinstance(item, dict) else str(item)
    return out if out else text
