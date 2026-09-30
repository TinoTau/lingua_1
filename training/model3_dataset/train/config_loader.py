# -*- coding: utf-8 -*-
"""MODEL3_V1_TRAINING_CONFIG_SSOT loader — fail-fast, no silent defaults for critical params."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = REPO / "training/model3_dataset/configs/model3_v1_training_config.json"

REQUIRED_TOP = [
    "configId",
    "version",
    "explicit_source",
    "architecture",
    "objective",
    "sampling_view",
    "datasets",
    "optimizer",
    "init",
    "seed_policy",
    "gates",
    "paths",
]

REQUIRED_OBJECTIVE = [
    "class_weight_retry",
    "auto_class_weight_formula",
    "pair_loss_enabled",
    "pair_loss_type",
    "pair_lambda",
    "pair_margin",
    "pair_ce_enabled",
]

REQUIRED_SAMPLING = [
    "sampling_view_id",
    "STRICT",
    "ANCHOR_CONDITIONED_HARD_KEEP",
    "NATURAL",
    "NO_ANCHOR",
]


class ConfigSSOTError(RuntimeError):
    pass


def sha_json(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def load_training_config(path: Path | None = None) -> dict:
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not cfg_path.is_absolute():
        cfg_path = REPO / cfg_path
    if not cfg_path.exists():
        raise ConfigSSOTError(f"missing training config SSOT: {cfg_path}")
    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    missing = [k for k in REQUIRED_TOP if k not in raw]
    if missing:
        raise ConfigSSOTError(f"config missing top-level keys: {missing}")
    obj = raw["objective"]
    missing_o = [k for k in REQUIRED_OBJECTIVE if k not in obj]
    if missing_o:
        raise ConfigSSOTError(f"objective missing keys: {missing_o}")
    samp = raw["sampling_view"]
    missing_s = [k for k in REQUIRED_SAMPLING if k not in samp]
    if missing_s:
        raise ConfigSSOTError(f"sampling_view missing keys: {missing_s}")
    if obj.get("auto_class_weight_formula") is not False:
        raise ConfigSSOTError("auto_class_weight_formula must be false")
    if obj.get("pair_ce_enabled") is not False:
        raise ConfigSSOTError("pair_ce_enabled must be false")
    if obj.get("pair_loss_type") != "PURE_MARGIN":
        raise ConfigSSOTError("pair_loss_type must be PURE_MARGIN")
    if float(obj["class_weight_retry"]) != 1.0:
        raise ConfigSSOTError("class_weight_retry must be 1.0 for this phase")
    if float(obj["pair_lambda"]) != 0.2:
        raise ConfigSSOTError("pair_lambda must be 0.2 for this phase")
    if float(obj["pair_margin"]) != 0.25:
        raise ConfigSSOTError("pair_margin must be 0.25 for this phase")
    if raw["init"].get("mode") != "random_from_scratch":
        raise ConfigSSOTError("init.mode must be random_from_scratch")
    seeds = raw["seed_policy"].get("seeds")
    if not seeds or len(seeds) < 3:
        raise ConfigSSOTError("seed_policy.seeds must have ≥3 seeds")
    resolved = {
        "config_path": str(cfg_path.relative_to(REPO)).replace("\\", "/"),
        "configId": raw["configId"],
        "version": raw["version"],
        "explicit_source": raw["explicit_source"],
        "architecture": raw["architecture"],
        "objective": dict(obj),
        "sampling_view": dict(samp),
        "datasets": dict(raw["datasets"]),
        "optimizer": dict(raw["optimizer"]),
        "init": dict(raw["init"]),
        "seed_policy": dict(raw["seed_policy"]),
        "gates": dict(raw["gates"]),
        "paths": dict(raw["paths"]),
        "runtime_freeze": dict(raw.get("runtime_freeze") or {}),
        "phase": raw.get("phase"),
    }
    resolved["config_hash"] = sha_json(
        {k: resolved[k] for k in resolved if k not in ("config_hash",)}
    )
    return resolved


def sampling_mix(resolved: dict) -> dict[str, float]:
    s = resolved["sampling_view"]
    return {
        "STRICT": float(s["STRICT"]),
        "ANCHOR_CONDITIONED_HARD_KEEP": float(s["ANCHOR_CONDITIONED_HARD_KEEP"]),
        "NATURAL": float(s["NATURAL"]),
        "NO_ANCHOR": float(s["NO_ANCHOR"]),
    }
