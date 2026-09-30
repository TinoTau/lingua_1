"""Model2 Stage-J runtime inference host — APPROVED_EXISTING_SIDECAR.

ONE process-level singleton. ONE RetrievalPolicyV3(with_domain_head=True).
ONE frozen Stage-J checkpoint. ONE inference per FineSpan policy step.

Feature pack: MODEL2_FEATURE_HASH_V1 (feature_hash="v1") — required for Stage J.
Domain retrieval: existing execute_domain_action (restored domain-conditioned FuzzyPool).
Not a second FuzzyPool. Not Node queryDomainMultiRowsAtomic.

Fail-fast on checkpoint identity / architecture / feature-hash mismatch.
No silent reshape, no latest-glob, no Stage-P fallback.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Optional

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

import torch

from training.model2.candidates.index import (
    CandidateIndexMetaV1,
    build_candidate_index_from_sqlite,
)
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.profile_query import hypothesize_intended_syllables
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1 as _ACTIVE
from training.model2_v3.policy.actions import ACTION_CATALOG
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    N_DOMAIN_ACTIONS,
    STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
    execute_domain_action,
)
from training.model2_v3.policy.feature_hash_v1 import MODEL2_FEATURE_HASH_VERSION
from training.model2_v3.policy.model import (
    HIDDEN,
    N_ACTIONS,
    QB_CLASSES,
    RetrievalPolicyV3,
    pack_batch_inputs,
)
from training.model2_v3.policy.stage_d_target_identity_v1 import CONTRACT_ID as STAGE_D_IDENTITY_CONTRACT

LABEL = "STAGE_J_RUNTIME_CHECKPOINT_SWAP"
FEATURE_PACK = "MODEL2_FEATURE_HASH_V1"
FEATURE_HASH_ARG = "v1"
STAGE_P_QUERY_BUDGET_OP = 1
EXPECTED_PARAMS = 47210
EXPECTED_SHA256 = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"
PROFILE_CONTRACT = "StageDProfileContractV1"
ACTION_SPACE_VERSION = "RetrievalPolicyV3/ACTIVE_SET_V1+DOMAIN_ACTION_CATALOG"

DEFAULT_CKPT = (
    _REPO
    / "training"
    / "model2_v3"
    / "experiments"
    / "v3_stage_j_p_preservation"
    / "training"
    / "expA_frozen_trunk.pt"
)
DEFAULT_SQLITE = _REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
DEFAULT_TRAIN_INDEX = (
    _REPO / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
)
DEFAULT_TRAIN_META = (
    _REPO / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _sqlite_surface_id_map(sqlite_path: Path) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    try:
        conn = sqlite3.connect(str(sqlite_path))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, word, pinyin_key FROM term WHERE COALESCE(enabled, 1) = 1"
            )
        except sqlite3.OperationalError:
            rows = conn.execute("SELECT id, word, pinyin_key FROM term")
        for row in rows:
            key = (str(row["word"] or ""), str(row["pinyin_key"] or ""))
            if key[0] and key not in out:
                out[key] = str(row["id"])
        conn.close()
    except Exception:  # noqa: BLE001
        return out
    return out


class Model2HostState:
    def __init__(self) -> None:
        self.model: Optional[RetrievalPolicyV3] = None
        self.device = torch.device("cpu")
        self.checkpoint: Optional[str] = None
        self.checkpoint_sha256: Optional[str] = None
        self.load_error: Optional[str] = None
        self.loaded = False
        self.load_count = 0
        self.inference_count = 0
        self.restart_count = 0
        self.index: Optional[CandidateIndexMetaV1] = None
        self.index_source: Optional[str] = None
        self.sqlite_term_ids: dict[tuple[str, str], str] = {}
        self.contract: dict[str, Any] = {}

    def _fail_load(self, error: str) -> dict[str, Any]:
        self.loaded = False
        self.load_error = error
        self.model = None
        self.checkpoint = None
        self.checkpoint_sha256 = None
        return {
            "ok": False,
            "error": error,
            "loaded": False,
            "label": LABEL,
            "load_count": self.load_count,
        }

    def load(self, msg: dict[str, Any]) -> dict[str, Any]:
        checkpoint = str(msg.get("checkpoint") or DEFAULT_CKPT)
        expected = str(msg.get("expected_sha256") or EXPECTED_SHA256).lower()
        path = Path(checkpoint)
        if not path.is_file():
            return self._fail_load(f"checkpoint_missing:{path}")
        digest = sha256_file(path)
        if digest != expected:
            return self._fail_load(
                f"checkpoint_hash_mismatch:got={digest}:expected={expected}"
            )
        try:
            ckpt = torch.load(path, map_location="cpu", weights_only=False)
            if not isinstance(ckpt, dict) or "state_dict" not in ckpt:
                return self._fail_load("checkpoint_missing_state_dict")
            sd = ckpt["state_dict"]
            meta = ckpt.get("meta") if isinstance(ckpt.get("meta"), dict) else {}
            fh = str(meta.get("feature_hash") or "")
            if fh not in (FEATURE_PACK, FEATURE_HASH_ARG, MODEL2_FEATURE_HASH_VERSION):
                return self._fail_load(f"feature_hash_mismatch:{fh or 'missing'}")
            if "domain_action_head.weight" not in sd:
                return self._fail_load("architecture_mismatch:with_domain_head_required")
            d_shape = tuple(sd["domain_action_head.weight"].shape)
            expected_d = (N_DOMAIN_ACTIONS, HIDDEN)
            if d_shape != expected_d:
                return self._fail_load(
                    f"domain_head_shape_mismatch:got={list(d_shape)}:expected={list(expected_d)}"
                )
            a_shape = tuple(sd["action_head.weight"].shape)
            expected_a = (N_ACTIONS, HIDDEN)
            if a_shape != expected_a:
                return self._fail_load(
                    f"action_head_shape_mismatch:got={list(a_shape)}:expected={list(expected_a)}"
                )
            model = RetrievalPolicyV3(with_domain_head=True)
            missing, unexpected = model.load_state_dict(sd, strict=True)
            if missing or unexpected:
                return self._fail_load(
                    f"state_dict_mismatch:missing={list(missing)}:unexpected={list(unexpected)}"
                )
            n_params = int(model.param_count())
            if n_params != EXPECTED_PARAMS:
                return self._fail_load(
                    f"param_count_mismatch:got={n_params}:expected={EXPECTED_PARAMS}"
                )
            model.eval()
            self.model = model
            self.checkpoint = str(path.resolve())
            self.checkpoint_sha256 = digest
            self.load_error = None
            self.loaded = True
            self.load_count += 1
            self.contract = {
                "architecture": "RetrievalPolicyV3",
                "architecture_version": "RetrievalPolicyV3",
                "with_domain_head": True,
                "with_ambiguity_head": False,
                "ambiguity_head_available": False,
                "ambiguity_contract": "SingleCharDisambiguationContractV1",
                "feature_hash": FEATURE_PACK,
                "feature_hash_arg": FEATURE_HASH_ARG,
                "profile_contract": PROFILE_CONTRACT,
                "stage_d_retrieval_contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
                "stage_d_identity_contract": STAGE_D_IDENTITY_CONTRACT,
                "domain_action_slot_ordering": [a.action_id for a in DOMAIN_ACTION_CATALOG],
                "n_domain_actions": N_DOMAIN_ACTIONS,
                "n_actions": N_ACTIONS,
                "action_space_version": ACTION_SPACE_VERSION,
                "span_dim": 64,
                "item_dim": 32,
                "state_dim": 12,
                "hidden": HIDDEN,
                "params": n_params,
            }
            idx_info = self.load_index(msg)
            return {
                "ok": True,
                "loaded": True,
                "checkpoint": self.checkpoint,
                "sha256": self.checkpoint_sha256,
                "architecture": "RetrievalPolicyV3",
                "with_domain_head": True,
                "params": n_params,
                "feature_pack": FEATURE_PACK,
                "profile_contract": PROFILE_CONTRACT,
                "label": LABEL,
                "load_count": self.load_count,
                "contract": self.contract,
                "index": idx_info,
                "stage_p_only": False,
                "dual_model": False,
                "ambiguity_head_available": False,
            }
        except Exception as e:  # noqa: BLE001
            return self._fail_load(f"load_failed:{e}")

    def load_index(self, msg: dict[str, Any]) -> dict[str, Any]:
        jsonl = msg.get("candidate_index_jsonl")
        meta = msg.get("candidate_index_meta")
        sqlite = msg.get("lexicon_sqlite")
        try:
            if jsonl:
                jp, mp = Path(str(jsonl)), Path(str(meta or ""))
                if not jp.is_file() or not mp.is_file():
                    self.index = None
                    self.index_source = None
                    return {"ok": False, "error": "candidate_index_missing"}
                self.index = load_candidate_index(jp, mp)
                self.index_source = str(jp.resolve())
                self.sqlite_term_ids = {}
                return {
                    "ok": True,
                    "source": "jsonl",
                    "path": self.index_source,
                    "candidate_count": self.index.candidate_count,
                }
            if sqlite:
                sp = Path(str(sqlite))
                if not sp.is_file():
                    self.index = None
                    self.index_source = None
                    return {"ok": False, "error": f"lexicon_sqlite_missing:{sp}"}
                self.index = build_candidate_index_from_sqlite(
                    sp, lexicon_snapshot_id=f"runtime:{sp.name}", include_idiom=False
                )
                self.index_source = str(sp.resolve())
                self.sqlite_term_ids = _sqlite_surface_id_map(sp)
                return {
                    "ok": True,
                    "source": "sqlite",
                    "path": self.index_source,
                    "candidate_count": self.index.candidate_count,
                    "sqlite_term_map": len(self.sqlite_term_ids),
                }
            if DEFAULT_SQLITE.is_file():
                return self.load_index({"lexicon_sqlite": str(DEFAULT_SQLITE)})
            if DEFAULT_TRAIN_INDEX.is_file() and DEFAULT_TRAIN_META.is_file():
                return self.load_index(
                    {
                        "candidate_index_jsonl": str(DEFAULT_TRAIN_INDEX),
                        "candidate_index_meta": str(DEFAULT_TRAIN_META),
                    }
                )
            self.index = None
            self.index_source = None
            return {"ok": False, "error": "no_domain_index"}
        except Exception as e:  # noqa: BLE001
            self.index = None
            self.index_source = None
            return {"ok": False, "error": f"index_load_failed:{e}"}

    def _map_base_ids(self, base_hits: list[dict[str, Any]]) -> set[str]:
        ids: set[str] = set()
        if self.index is None:
            return ids
        for h in base_hits:
            surface = str(h.get("surface") or h.get("replacement") or "")
            pk = str(h.get("pinyin_key") or "")
            tid = str(h.get("term_id") or "")
            if tid and tid in self.index.by_term_id:
                ids.add(tid)
                continue
            recs = self.index.by_surface.get(surface) or []
            for rec in recs:
                if not pk or rec.pinyin_key == pk:
                    ids.add(rec.term_id)
        return ids

    def _domain_hits_payload(self, term_ids: list[str], new_ids: list[str]) -> list[dict[str, Any]]:
        if self.index is None:
            return []
        out = []
        for tid in new_ids:
            rec = self.index.by_term_id.get(tid)
            if rec is None:
                continue
            sqlite_id = self.sqlite_term_ids.get((rec.surface, rec.pinyin_key))
            out.append(
                {
                    "term_id": tid,
                    "sqlite_term_id": sqlite_id,
                    "surface": rec.surface,
                    "pinyin_key": rec.pinyin_key,
                    "domain_ids": list(rec.domain_ids or []),
                    "prior_score": float(rec.prior_score),
                    "term_type": rec.term_type,
                }
            )
        return out

    def infer(self, req: dict[str, Any]) -> dict[str, Any]:
        if not self.loaded or self.model is None:
            return {
                "ok": False,
                "error": self.load_error or "model_not_loaded",
                "model2_invoked": False,
                "selected_actions": [],
                "domain_action": None,
                "domain_none": True,
                "query_budget": 0,
            }
        try:
            span_syllables = list(req.get("span_syllables") or [])
            phonetic_bias = dict(req.get("phonetic_bias") or {})
            personal_terms = list(req.get("personal_terms") or [])
            domain_evidence = dict(req.get("long_term_domain_evidence") or req.get("domain_evidence") or {})
            term_evidence = dict(req.get("personal_term_evidence") or req.get("term_evidence") or {})
            state = dict(req.get("state") or {})
            state.setdefault("base_pool", int(req.get("base_pool") or 0))
            state.setdefault("query_budget", 8)
            state.setdefault("cand_budget", 8)
            appl = [1.0 if float(phonetic_bias.get(r) or 0) > 0 else 0.0 for r in _ACTIVE]
            state.setdefault("applicability", appl)
            state.setdefault("n_applicable", int(sum(1 for a in appl if a > 0)))
            state["personal_terms"] = personal_terms
            state["domain_evidence"] = domain_evidence
            state["term_evidence"] = term_evidence
            state.setdefault("max_lexical_items", 32)

            t0 = time.perf_counter()
            x = pack_batch_inputs(
                [span_syllables],
                [phonetic_bias],
                [state],
                device=self.device,
                feature_hash=FEATURE_HASH_ARG,
            )
            with torch.no_grad():
                out = self.model(*x)
                probs = torch.sigmoid(out["action_logits"][0]).cpu()
                qb_i = int(torch.argmax(out["query_budget_logits"][0]).item())
                cb_i = int(torch.argmax(out["cand_budget_logits"][0]).item())
                d_logits = out.get("domain_action_logits")
                if d_logits is None:
                    return {
                        "ok": False,
                        "error": "domain_head_missing_at_infer",
                        "model2_invoked": False,
                        "selected_actions": [],
                        "domain_action": None,
                        "domain_none": True,
                        "query_budget": 0,
                    }
                d_probs = torch.sigmoid(d_logits[0]).cpu()
            infer_ms = (time.perf_counter() - t0) * 1000.0
            self.inference_count += 1

            budget = STAGE_P_QUERY_BUDGET_OP
            scored: list[tuple[float, str]] = []
            for i, a in enumerate(ACTION_CATALOG):
                if a.kind != "single":
                    continue
                if not all(float(phonetic_bias.get(r) or 0) > 0 for r in a.relations):
                    continue
                _, nchg = hypothesize_intended_syllables(span_syllables, a.relations[0])
                if nchg <= 0:
                    continue
                scored.append((float(probs[i]), a.action_id))
            scored.sort(reverse=True)
            chosen = [aid for _, aid in scored[:budget]]

            d_scored = [
                (float(d_probs[i]), a.action_id) for i, a in enumerate(DOMAIN_ACTION_CATALOG)
            ]
            d_scored.sort(reverse=True)
            domain_action = d_scored[0][1] if d_scored else "domain_none"
            domain_none = domain_action == "domain_none"

            d_exec: dict[str, Any] = {
                "executed": False,
                "n_queries": 0,
                "n_new": 0,
                "term_ids": [],
                "domain_hits": [],
                "domain_raw_term_ids": [],
                "latency_ms": 0.0,
                "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
            }
            if not domain_none:
                t1 = time.perf_counter()
                try:
                    if self.index is None:
                        d_exec["error"] = "domain_index_missing"
                    else:
                        action = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[domain_action]]
                        span = FineSpanView(
                            span_id=str(req.get("span_id") or "fs"),
                            syllable_start=int(req.get("syllable_start") or 0),
                            syllable_end=int(
                                req.get("syllable_end") or (0 + len(span_syllables))
                            ),
                            span_syllables=span_syllables,
                            window_text=str(req.get("window_text") or ""),
                            window_pinyin_key=str(
                                req.get("window_pinyin_key") or "|".join(span_syllables)
                            ),
                            raw_start=int(req.get("raw_start") or 0),
                            raw_end=int(req.get("raw_end") or 0),
                        )
                        base_ids = self._map_base_ids(list(req.get("base_hits") or []))
                        res = execute_domain_action(
                            self.index,
                            span,
                            action,
                            domain_evidence,
                            base_ids=base_ids if base_ids else None,
                            max_cands=8,
                        )
                        new_ids = list(res.get("term_ids") or [])
                        if base_ids:
                            new_ids = [t for t in new_ids if t not in base_ids]
                        else:
                            base_py = set(res.get("base_ids") or [])
                            new_ids = [t for t in new_ids if t not in base_py]
                        d_exec = {
                            "executed": True,
                            "n_queries": int(res.get("n_queries") or 0),
                            "n_new": int(res.get("n_new") or len(new_ids)),
                            "term_ids": list(res.get("term_ids") or []),
                            "new_term_ids": new_ids,
                            "domain_hits": self._domain_hits_payload(
                                list(res.get("term_ids") or []), new_ids
                            ),
                            "domain_raw_term_ids": list(res.get("domain_raw_term_ids") or []),
                            "domain_raw_n": int(res.get("domain_raw_n") or 0),
                            "allowed_domain_ids": list(res.get("allowed_domain_ids") or []),
                            "nested_32_8": bool(res.get("nested_32_8")),
                            "hard_filter": bool(res.get("hard_filter")),
                            "contract": res.get("contract") or STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
                            "latency_ms": (time.perf_counter() - t1) * 1000.0,
                            "old_shared_pool_rerank": False,
                        }
                except Exception as e:  # noqa: BLE001
                    d_exec = {
                        "executed": False,
                        "error": f"domain_executor_failed:{e}",
                        "n_queries": 0,
                        "n_new": 0,
                        "term_ids": [],
                        "domain_hits": [],
                        "latency_ms": (time.perf_counter() - t1) * 1000.0,
                        "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
                    }

            payload: dict[str, Any] = {
                "ok": True,
                "model2_invoked": True,
                "one_inference": True,
                "selected_actions": chosen,
                "query_budget": budget,
                "model_query_budget_class": QB_CLASSES[qb_i] if qb_i < len(QB_CLASSES) else 1,
                "cand_budget_class": cb_i,
                "action_probs_top": [
                    {"action_id": aid, "prob": p} for p, aid in scored[:5]
                ],
                "domain_action": domain_action,
                "domain_none": domain_none,
                "domain_probs_top": [
                    {"action_id": aid, "prob": p} for p, aid in d_scored[:5]
                ],
                "domain_executor": d_exec,
                "latency_ms": infer_ms,
                "feature_pack": FEATURE_PACK,
                "sha256": self.checkpoint_sha256,
                "checkpoint": self.checkpoint,
                "label": LABEL,
                "inference_count": self.inference_count,
                "load_count": self.load_count,
                "empty_phonetic_skipped": False,
                "n_applicable": int(state.get("n_applicable") or 0),
                "p_feature_presence": any(float(phonetic_bias.get(r) or 0) > 0 for r in _ACTIVE),
                "d_feature_presence": any(float(v) > 0 for v in domain_evidence.values()),
            }
            # Observation-only: extra hashes when MODEL2_DIALOG200_TRACE=1.
            # Computed from a CPU copy after inference; does not change selected actions.
            if os.environ.get("MODEL2_DIALOG200_TRACE") == "1":
                parts: list[bytes] = []
                packed = x if isinstance(x, (tuple, list)) else (x,)
                for t in packed:
                    if torch.is_tensor(t):
                        parts.append(t.detach().cpu().contiguous().numpy().tobytes())
                payload["packed_feature_hash"] = hashlib.sha256(b"".join(parts)).hexdigest()
            return payload
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "error": f"inference_failed:{e}",
                "traceback": traceback.format_exc()[-800:],
                "model2_invoked": False,
                "selected_actions": [],
                "domain_action": None,
                "domain_none": True,
                "query_budget": 0,
            }

    def disambiguate(self, req: dict[str, Any]) -> dict[str, Any]:
        """Single-char SELECT/ABSTAIN. Untrained/missing head → ABSTAIN (fail closed).

        Does not call P/D forward. Does not argmax untrained logits.
        """
        t0 = time.perf_counter()
        request_id = str(req.get("request_id") or req.get("requestId") or "")
        candidates = req.get("candidates")
        n = len(candidates) if isinstance(candidates, list) else 0

        def abstain(reason: str) -> dict[str, Any]:
            return {
                "ok": True,
                "cmd": "disambiguate",
                "contract": "SingleCharDisambiguationContractV1",
                "request_id": request_id,
                "decision": "ABSTAIN",
                "selected_candidate_index": None,
                "abstain_reason": reason,
                "model_head_available": False,
                "ambiguity_invoked": True,
                "candidate_count": n,
                "latency_ms": (time.perf_counter() - t0) * 1000.0,
                "open_vocabulary": False,
            }

        if not self.loaded or self.model is None:
            return abstain("HEAD_NOT_AVAILABLE")
        if getattr(self.model, "ambiguity_head", None) is None:
            return abstain("HEAD_NOT_AVAILABLE")
        return abstain("HEAD_NOT_AVAILABLE")

    def stats(self) -> dict[str, Any]:
        return {
            "ok": True,
            "loaded": self.loaded,
            "checkpoint": self.checkpoint,
            "sha256": self.checkpoint_sha256,
            "load_error": self.load_error,
            "load_count": self.load_count,
            "inference_count": self.inference_count,
            "restart_count": self.restart_count,
            "model_instances": 1 if self.model is not None else 0,
            "index_source": self.index_source,
            "index_count": self.index.candidate_count if self.index is not None else 0,
            "label": LABEL,
            "feature_pack": FEATURE_PACK,
            "stage_p_only": False,
            "dual_model": False,
            "ambiguity_head_available": bool(
                self.model is not None and getattr(self.model, "ambiguity_head", None) is not None
            ),
        }


def main() -> None:
    host = Model2HostState()
    host.restart_count = 1
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"bad_json:{e}"}), flush=True)
            continue
        cmd = msg.get("cmd")
        if cmd == "ping":
            print(json.dumps(host.stats()), flush=True)
        elif cmd == "stats":
            print(json.dumps(host.stats()), flush=True)
        elif cmd == "load":
            print(json.dumps(host.load(msg)), flush=True)
        elif cmd == "load_index":
            print(json.dumps({"ok": True, "index": host.load_index(msg)}), flush=True)
        elif cmd == "infer":
            resp = host.infer(msg)
            resp["request_id"] = msg.get("request_id")
            print(json.dumps(resp), flush=True)
        elif cmd == "disambiguate":
            resp = host.disambiguate(msg)
            print(json.dumps(resp), flush=True)
        elif cmd == "shutdown":
            print(json.dumps({"ok": True, "shutdown": True}), flush=True)
            break
        else:
            print(json.dumps({"ok": False, "error": f"unknown_cmd:{cmd}"}), flush=True)


if __name__ == "__main__":
    main()
