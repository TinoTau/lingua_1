"""Recovery shim for missing feature_v2.py (investigation unblock only).

Loads orphaned bytecode from _bytecode_backup (NOT from __pycache__,
to avoid overwrite when this shim is compiled).

Does NOT change Tone Decision / Candidate / Recall logic.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_GUARD = "_LINGUA_FEATURE_V2_BYTECODE_LOADING_"
if globals().get(_GUARD):
    raise ImportError("feature_v2 bytecode load re-entered")
globals()[_GUARD] = True

try:
    _pyc = Path(__file__).resolve().parent / "_bytecode_backup" / "feature_v2.cpython-310.pyc"
    if not _pyc.is_file():
        raise ImportError(f"feature_v2 orphaned bytecode missing: {_pyc}")

    _alt = "tone_module._feature_v2_bytecode"
    if _alt not in sys.modules:
        _spec = importlib.util.spec_from_file_location(_alt, str(_pyc))
        if _spec is None or _spec.loader is None:
            raise ImportError(f"cannot create import spec for {_pyc}")
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules[_alt] = _mod
        _spec.loader.exec_module(_mod)
    else:
        _mod = sys.modules[_alt]

    # Re-export public API used by inference.py
    extract_feature = _mod.extract_feature
    for _name in dir(_mod):
        if _name.startswith("_") and _name not in ("__all__",):
            continue
        if _name in globals():
            continue
        globals()[_name] = getattr(_mod, _name)
finally:
    globals().pop(_GUARD, None)
