"""Model3 runtime inference host — APPROVED_EXISTING_SIDECAR pattern.

ONE process-level singleton. ONE explicitly identified checkpoint per process.
Production / Electron default identity: MODEL3_V2_S3_RANDOM_INIT_V1.
Explicit rollback (env only): MODEL3_SYNTHETIC_V1 — never silent fallback.

Electron TS client always passes label / checkpoint_dir / expected hashes /
config_hash_mode from model3-checkpoint-registry. The DEFAULT_* constants below
are the same production identity seal for omitted-field / standalone-debug loads
only — not a second ownership path.

ONE inference per pathFineSpans sequence (not per span process call).
Fail-fast on weights SHA / config hash / feature-contract mismatch.
No silent KEEP-all, no acoustic features, no silent Synthetic fallback.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Optional

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

import torch

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    encode_surface,
)

# Production identity seal — same as MODEL3_PRODUCTION_IDENTITY_ID (S3).
# Used only when the load message omits fields (standalone/debug); Electron always sends them.
DEFAULT_LABEL = "MODEL3_V2_S3_RANDOM_INIT_V1"
EXPECTED_WEIGHTS_SHA256 = "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1"
EXPECTED_CONFIG_HASH = "8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221"
DEFAULT_CONFIG_HASH_MODE = "config_file_sha256"
EXPECTED_FEAT_NAMES = list(FEAT_NAMES)
_CJK = re.compile(r"[\u4e00-\u9fff]")

DEFAULT_CKPT_DIR = (
    _REPO
    / "training"
    / "model3_dataset"
    / "model3_v2_s3_random_init_v1_ckpts"
    / "seed_2026083013"
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class Model3HostState:
    def __init__(self) -> None:
        self.model: Optional[Model3BiGRUV1] = None
        self.vocab: dict[str, int] = {}
        self.device = torch.device("cpu")
        self.checkpoint_dir: Optional[str] = None
        self.weights_sha256: Optional[str] = None
        self.label: str = DEFAULT_LABEL
        self.load_error: Optional[str] = None
        self.loaded = False
        self.load_count = 0
        self.inference_count = 0

    def _fail_load(self, error: str) -> dict[str, Any]:
        self.loaded = False
        self.load_error = error
        self.model = None
        self.vocab = {}
        self.checkpoint_dir = None
        self.weights_sha256 = None
        return {
            "ok": False,
            "error": error,
            "loaded": False,
            "label": self.label,
            "load_count": self.load_count,
        }

    def load(self, msg: dict[str, Any]) -> dict[str, Any]:
        self.label = str(msg.get("label") or DEFAULT_LABEL)
        ckpt_dir = Path(str(msg.get("checkpoint_dir") or DEFAULT_CKPT_DIR))
        expected_w = str(msg.get("expected_weights_sha256") or EXPECTED_WEIGHTS_SHA256).lower()
        expected_c = str(msg.get("expected_config_hash") or EXPECTED_CONFIG_HASH).lower()
        config_hash_mode = str(msg.get("config_hash_mode") or DEFAULT_CONFIG_HASH_MODE).lower()
        weights = ckpt_dir / "weights.pt"
        vocab_path = ckpt_dir / "vocab.json"
        config_path = ckpt_dir / "config.json"
        allow_path = ckpt_dir / "feature_allowlist.json"

        if not weights.is_file():
            return self._fail_load(f"checkpoint_missing:{weights}")
        digest = sha256_file(weights).lower()
        if digest != expected_w:
            return self._fail_load(f"checkpoint_hash_mismatch:got={digest}:expected={expected_w}")

        if not config_path.is_file():
            return self._fail_load(f"config_missing:{config_path}")
        config = json.loads(config_path.read_text(encoding="utf-8"))
        cfg_field = str(config.get("config_hash") or "").lower()
        cfg_file = sha256_file(config_path).lower()
        # Exact seal: either embedded config_hash OR sha256(config.json) ??never skip.
        if config_hash_mode == "config_file_sha256":
            if cfg_file != expected_c:
                return self._fail_load(
                    f"config_file_hash_mismatch:got={cfg_file}:expected={expected_c}"
                )
            cfg_hash = cfg_file
        else:
            if cfg_field != expected_c:
                return self._fail_load(
                    f"config_hash_mismatch:got={cfg_field}:expected={expected_c}"
                )
            cfg_hash = cfg_field

        if allow_path.is_file():
            allow = json.loads(allow_path.read_text(encoding="utf-8"))
            names = list(allow.get("feat_names") or [])
            if names != EXPECTED_FEAT_NAMES:
                return self._fail_load(f"feature_contract_mismatch:got={names}:expected={EXPECTED_FEAT_NAMES}")
            if int(allow.get("feat_dim") or -1) != FEAT_DIM:
                return self._fail_load(f"feat_dim_mismatch:got={allow.get('feat_dim')}:expected={FEAT_DIM}")

        if not vocab_path.is_file():
            return self._fail_load(f"vocab_missing:{vocab_path}")
        vocab = json.loads(vocab_path.read_text(encoding="utf-8"))
        if not isinstance(vocab, dict) or "<pad>" not in vocab:
            return self._fail_load("vocab_invalid")

        try:
            model = Model3BiGRUV1(vocab_size=len(vocab))
            state = torch.load(str(weights), map_location="cpu")
            model.load_state_dict(state)
            model.eval()
            model.to(self.device)
        except Exception as e:  # noqa: BLE001
            return self._fail_load(f"model_load_exception:{e}")

        self.model = model
        self.vocab = {str(k): int(v) for k, v in vocab.items()}
        self.checkpoint_dir = str(ckpt_dir)
        self.weights_sha256 = digest
        self.loaded = True
        self.load_error = None
        self.load_count += 1
        return {
            "ok": True,
            "loaded": True,
            "label": self.label,
            "weights_sha256": digest,
            "config_hash": cfg_hash,
            "feat_names": EXPECTED_FEAT_NAMES,
            "feat_dim": FEAT_DIM,
            "vocab_size": len(self.vocab),
            "load_count": self.load_count,
            "checkpoint_dir": str(ckpt_dir),
        }

    def _pack_spans(self, spans: list[dict[str, Any]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        n = len(spans)
        tokens = torch.zeros(1, n, 8, dtype=torch.long)
        feats = torch.zeros(1, n, FEAT_DIM)
        avail = torch.ones(1, n, FEAT_DIM)
        for i, sp in enumerate(spans):
            surface = str(sp.get("surface") or "")
            tokens[0, i] = torch.tensor(encode_surface(surface, self.vocab), dtype=torch.long)
            cjk_len = len(_CJK.findall(surface))
            recall = float(sp.get("first_pass_cand_count") or 0)
            rel_pos = i / max(n - 1, 1)
            is_anchor = 1.0 if sp.get("isAnchor") else 0.0
            pinyin_avail = 1.0 if sp.get("pinyin_channel_avail") else 0.0
            recall_avail = 1.0 if sp.get("recall_first_pass_avail", True) else 0.0
            row = [
                is_anchor,
                math.log1p(float(len(surface))),
                float(rel_pos),
                math.log1p(recall) if recall_avail else 0.0,
                math.log1p(float(cjk_len)),
                pinyin_avail,
            ]
            feats[0, i] = torch.tensor(row)
            if not recall_avail:
                avail[0, i, 3] = 0.0
            if not pinyin_avail:
                avail[0, i, 5] = 0.0
                feats[0, i, 5] = 0.0
        return tokens, feats, avail

    def infer(self, msg: dict[str, Any]) -> dict[str, Any]:
        if not self.loaded or self.model is None:
            return {"ok": False, "error": self.load_error or "not_loaded", "label": self.label}
        spans = list(msg.get("spans") or [])
        if not spans:
            return {
                "ok": True,
                "decisions": [],
                "latency_ms": 0,
                "label": self.label,
                "inference_count": self.inference_count,
            }
        t0 = time.time()
        try:
            tokens, feats, avail = self._pack_spans(spans)
            with torch.no_grad():
                logits = self.model(tokens, feats, avail)  # [1, N, 2]
            decisions = []
            n = len(spans)
            for i, sp in enumerate(spans):
                is_anchor = bool(sp.get("isAnchor"))
                keep_logit = float(logits[0, i, 0].item())
                retry_logit = float(logits[0, i, 1].item())
                # Eligibility: Anchor never effective RETRY (host-side mask).
                if is_anchor:
                    decision = "KEEP"
                    eligible = False
                else:
                    decision = "RETRY" if retry_logit > keep_logit else "KEEP"
                    eligible = True
                margin = retry_logit - keep_logit
                feat_row = [float(feats[0, i, j].item()) for j in range(FEAT_DIM)]
                avail_row = [float(avail[0, i, j].item()) for j in range(FEAT_DIM)]
                token_row = [int(tokens[0, i, j].item()) for j in range(tokens.shape[2])]
                surface_used = str(sp.get("surface") or "")
                decisions.append(
                    {
                        "span_id": str(sp.get("span_id") or ""),
                        "decision": decision,
                        "keep_logit": keep_logit,
                        "retry_logit": retry_logit,
                        "margin": margin,
                        "eligible": eligible,
                        # Observation-only: exact packed features used for this forward.
                        "features": {
                            "isAnchor": feat_row[0],
                            "span_len_log1p": feat_row[1],
                            "span_rel_position": feat_row[2],
                            "first_pass_cand_log1p": feat_row[3],
                            "current_cjk_len_log1p": feat_row[4],
                            "pinyin_channel_avail": feat_row[5],
                        },
                        # Exact model-visible tensors (SSOT for offline replay).
                        "surface_used": surface_used,
                        "surface_char_len": len(surface_used),
                        "feat_vector": feat_row,
                        "avail_mask": avail_row,
                        "token_ids": token_row,
                        "raw_first_pass_cand_count": int(sp.get("first_pass_cand_count") or 0),
                        "raw_pinyin_channel_avail": bool(sp.get("pinyin_channel_avail")),
                        "seq_index": i,
                        "seq_len": n,
                    }
                )
            self.inference_count += 1
            return {
                "ok": True,
                "decisions": decisions,
                "latency_ms": int((time.time() - t0) * 1000),
                "label": self.label,
                "inference_count": self.inference_count,
                "load_count": self.load_count,
                "weights_sha256": self.weights_sha256,
            }
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "error": f"infer_exception:{e}",
                "traceback": traceback.format_exc()[-800:],
                "label": self.label,
            }


STATE = Model3HostState()


def handle(msg: dict[str, Any]) -> dict[str, Any]:
    cmd = str(msg.get("cmd") or "")
    if cmd == "load":
        return STATE.load(msg)
    if cmd == "infer":
        return STATE.infer(msg)
    if cmd == "ping":
        return {
            "ok": True,
            "loaded": STATE.loaded,
            "label": STATE.label,
            "load_count": STATE.load_count,
            "inference_count": STATE.inference_count,
        }
    return {"ok": False, "error": f"unknown_cmd:{cmd}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({"ok": False, "error": f"bad_json:{e}"}) + "\n")
            sys.stdout.flush()
            continue
        try:
            out = handle(msg)
        except Exception as e:  # noqa: BLE001
            out = {"ok": False, "error": f"host_exception:{e}", "traceback": traceback.format_exc()[-800:]}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
