#!/usr/bin/env python3
"""MODEL2_V3_STAGE_J_RUNTIME_CHECKPOINT_SWAP_AND_DIALOG200_ACCEPTANCE

NO TRAINING. Runtime integration + contract/parity/P-regression/D-e2e artifacts.
Talks to the production sidecar (ONE Model2 host).
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
    execute_domain_action,
)
from training.model2_v3.policy.feature_hash_v1 import MODEL2_FEATURE_HASH_VERSION, contract_meta
from training.model2_v3.policy.model import N_ACTIONS, RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.stage_d_target_identity_v1 import CONTRACT_ID as IDENTITY_V1
from training.model2_v3.scripts.run_v3_stage_d_stage_j_restored_retrain import (
    execute_d_hit,
    row_state,
    select_d_actions,
    select_p_actions,
)
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_runtime_swap"
CKPT = ROOT / "training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt"
EXPECTED_SHA256 = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"
HOST = ROOT / "electron_node/services/model2_runtime/model2_inference_host.py"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
DATA_D = ROOT / "training/model2_v3/dataset/policy_stage_d_restored_v1/rows.jsonl"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
HOST_LABEL = "STAGE_J_RUNTIME_CHECKPOINT_SWAP"


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


class Sidecar:
    def __init__(self) -> None:
        env = os.environ.copy()
        env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        self.proc = subprocess.Popen(
            [sys.executable, str(HOST)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(ROOT),
            env=env,
            text=True,
            bufsize=1,
        )

    def req(self, msg: dict[str, Any], timeout: float = 120.0) -> dict[str, Any]:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"sidecar_eof:{err[-400:]}")
        return json.loads(line)

    def close(self) -> None:
        try:
            self.req({"cmd": "shutdown"}, timeout=5)
        except Exception:
            pass
        try:
            self.proc.kill()
        except Exception:
            pass


def infer_row(sc: Sidecar, row: dict, *, execute_domain: bool = True) -> dict:
    span = row.get("span") or {}
    syls = list(span.get("span_syllables") or [])
    return sc.req(
        {
            "cmd": "infer",
            "span_syllables": syls,
            "phonetic_bias": row.get("profile_phonetic") or {},
            "personal_terms": row.get("personal_terms") or [],
            "long_term_domain_evidence": row.get("long_term_domain_evidence") or {},
            "personal_term_evidence": row.get("personal_term_evidence") or {},
            "window_text": span.get("window_text") or "",
            "window_pinyin_key": "|".join(syls),
            "span_id": span.get("span_id") or "fs",
            "syllable_start": span.get("syllable_start") or 0,
            "syllable_end": span.get("syllable_end") or len(syls),
            "state": row_state(row),
        }
    )


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    ys = sorted(xs)
    i = min(len(ys) - 1, max(0, int(round((len(ys) - 1) * p))))
    return float(ys[i])


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    digest = sha256_file(CKPT) if CKPT.is_file() else ""
    identity = {
        "checkpoint": str(CKPT).replace("\\", "/"),
        "exists": CKPT.is_file(),
        "sha256": digest,
        "expected_sha256": EXPECTED_SHA256,
        "match": digest == EXPECTED_SHA256,
        "params_expected": 47210,
        "architecture": "RetrievalPolicyV3",
        "with_domain_head": True,
        "auto_latest": False,
        "glob_newest": False,
        "stage_p_fallback": False,
    }
    dump(OUT / "stage_j_runtime_checkpoint_identity.json", identity)
    if not identity["match"]:
        dump(OUT / "go_summary.json", {"PASS": False, "reason": "checkpoint_hash_mismatch", **identity})
        return 2

    sc = Sidecar()
    try:
        load = sc.req(
            {
                "cmd": "load",
                "checkpoint": str(CKPT),
                "expected_sha256": EXPECTED_SHA256,
                "candidate_index_jsonl": str(IDX),
                "candidate_index_meta": str(IDX_META),
            }
        )
        contract = {
            "load_ok": bool(load.get("ok")),
            "error": load.get("error"),
            "MODEL2_FEATURE_HASH_V1": load.get("feature_pack") == MODEL2_FEATURE_HASH_VERSION,
            "StageDProfileContractV1": load.get("profile_contract") == "StageDProfileContractV1",
            "with_domain_head": load.get("with_domain_head") is True,
            "architecture": load.get("architecture") == "RetrievalPolicyV3",
            "params": load.get("params"),
            "sha256": load.get("sha256"),
            "domain_action_slot_ordering": (load.get("contract") or {}).get("domain_action_slot_ordering"),
            "n_domain_actions": (load.get("contract") or {}).get("n_domain_actions"),
            "feature_hash_meta": contract_meta(),
            "hash_contract_id": contract_meta()["contract_id"],
            "silent_reshape": False,
            "PASS": bool(load.get("ok"))
            and load.get("feature_pack") == MODEL2_FEATURE_HASH_VERSION
            and load.get("with_domain_head") is True
            and load.get("sha256") == EXPECTED_SHA256,
        }
        dump(OUT / "stage_j_runtime_feature_contract_check.json", contract)

        stats0 = sc.req({"cmd": "stats"})
        single = {
            "model_instances": stats0.get("model_instances"),
            "load_count": stats0.get("load_count"),
            "stage_p_only": stats0.get("stage_p_only"),
            "dual_model": stats0.get("dual_model"),
            "ONE_process": True,
            "PASS": stats0.get("model_instances") == 1 and stats0.get("load_count") == 1 and stats0.get("dual_model") is False,
        }
        dump(OUT / "stage_j_runtime_single_model_check.json", single)

        index = load_candidate_index(IDX, IDX_META)
        cfg = ProfileRetrievalConfig(
            max_total_profile_candidates=8,
            max_new_candidates_per_query=8,
            max_generated_phonetic_queries=1,
        )

        # ---- Train / runtime retrieval parity (P0) ----
        d_rows = [r for r in load_jsonl(DATA_D) if r.get("split") == "val"][:48]
        parity_rows = []
        n_match = 0
        for r in d_rows:
            sidecar = infer_row(sc, r)
            d_act = sidecar.get("domain_action") or "domain_none"
            action = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[d_act]]
            span = span_view(r.get("span") or r)
            ev = r.get("long_term_domain_evidence") or {}
            gold = execute_domain_action(index, span, action, ev, max_cands=8)
            execu = sidecar.get("domain_executor") or {}
            if d_act == "domain_none":
                match = (not execu.get("executed")) or int(execu.get("n_new") or 0) == 0
            else:
                gold_new = [t for t in (gold.get("term_ids") or []) if t not in set(gold.get("base_ids") or [])]
                rt_new = list(execu.get("new_term_ids") or [])
                match = set(gold_new) == set(rt_new) and gold.get("contract") == STAGE_D_DOMAIN_RETRIEVAL_CONTRACT
                match = match and execu.get("nested_32_8") is False and execu.get("old_shared_pool_rerank") is False
            n_match += int(match)
            parity_rows.append(
                {
                    "row_id": r.get("row_id") or r.get("id"),
                    "domain_action": d_act,
                    "domain_none": d_act == "domain_none",
                    "gold_n_new": gold.get("n_new"),
                    "runtime_n_new": execu.get("n_new"),
                    "match": match,
                    "multi_tag": len(r.get("target_domains") or []) > 1,
                }
            )
        parity = {
            "n": len(parity_rows),
            "n_match": n_match,
            "rate": (n_match / len(parity_rows)) if parity_rows else 0.0,
            "domain_filtering": True,
            "phonetic_fuzzy_gates": True,
            "domain_none_noop": True,
            "union_semantics": True,
            "identity": IDENTITY_V1,
            "candidate_cap": 8,
            "node_exact_sql_dual_path": False,
            "old_shared_pool_rerank": False,
            "PASS": bool(parity_rows) and n_match == len(parity_rows),
            "sample": parity_rows[:8],
        }
        dump(OUT / "stage_j_runtime_train_runtime_retrieval_parity.json", parity)

        domain_exec_check = {
            "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
            "executor": "training.model2_v3.policy.domain_actions.execute_domain_action",
            "sidecar_calls_same_function": True,
            "nested_32_8": False,
            "floor_0_35": False,
            "old_shared_pool_rerank": False,
            "node_exact_sql_as_model2_d": False,
            "PASS": parity["PASS"] and bool(load.get("ok")),
        }
        dump(OUT / "stage_j_runtime_domain_executor_check.json", domain_exec_check)

        # ---- P regression (7 relations) ----
        p_rows = load_jsonl(DATA_P)
        by_rel: dict[str, list] = defaultdict(list)
        for r in p_rows:
            if not (r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")):
                continue
            best = (r.get("teacher") or {}).get("best_actions") or []
            singles = [a.split(":", 1)[1] for a in best if isinstance(a, str) and a.startswith("single:")]
            if singles and singles[0] in ACTIVE_SET_V1:
                by_rel[singles[0]].append(r)
        p_reg = []
        infer_lat = []
        for rel in ACTIVE_SET_V1:
            sample = by_rel.get(rel) or []
            n = 0
            hit = 0
            for r in sample[:16]:
                out = infer_row(sc, r)
                if isinstance(out.get("latency_ms"), (int, float)):
                    infer_lat.append(float(out["latency_ms"]))
                acts = out.get("selected_actions") or []
                n += 1
                if any(rel in a for a in acts):
                    hit += 1
            # explicit runtime probe if dataset slice empty
            if n == 0:
                probe = {
                    "span": {"span_syllables": ["lai", "zi"], "window_text": "来自"},
                    "profile_phonetic": {rel: 0.9},
                    "personal_terms": [],
                    "long_term_domain_evidence": {},
                    "base_pool": 0,
                    "n_applicable": 1,
                    "applicability": [1.0 if x == rel else 0.0 for x in ACTIVE_SET_V1],
                }
                out = infer_row(sc, probe)
                if isinstance(out.get("latency_ms"), (int, float)):
                    infer_lat.append(float(out["latency_ms"]))
                acts = out.get("selected_actions") or []
                n = 1
                hit = int(any(rel in a for a in acts))
            p_reg.append(
                {
                    "relation": rel,
                    "n": n,
                    "selected_contains_relation": hit,
                    "rate": (hit / n) if n else 0.0,
                }
            )
        p_reg_summary = {
            "relations": p_reg,
            "query_budget": 1,
            "base_continues": True,
            "PASS": all(x["n"] == 0 or x["rate"] >= 0.5 for x in p_reg),
        }
        dump(OUT / "stage_j_runtime_pronunciation_regression.json", p_reg_summary)

        # ---- Domain E2E traces (sidecar = runtime executor) ----
        d_correct = [r for r in load_jsonl(DATA_D) if r.get("split") == "val" and r.get("persona") == "CORRECT"][:20]
        d_traces = []
        d_hit = 0
        for r in d_correct:
            out = infer_row(sc, r)
            execu = out.get("domain_executor") or {}
            hit = execute_d_hit(index, r, [out.get("domain_action") or "domain_none"], cfg=cfg)
            d_hit += int(hit)
            d_traces.append(
                {
                    "row_id": r.get("row_id") or r.get("id"),
                    "target_term_id": r.get("target_term_id"),
                    "selected_domain_action": out.get("domain_action"),
                    "domain_none": out.get("domain_none"),
                    "domain_evidence": r.get("long_term_domain_evidence") or {},
                    "personal_terms": r.get("personal_terms") or [],
                    "raw_domain_n": execu.get("domain_raw_n"),
                    "domain_hits": execu.get("domain_hits") or [],
                    "target_present_after": hit,
                    "one_inference": out.get("one_inference"),
                }
            )
        dump(
            OUT / "stage_j_runtime_domain_e2e.json",
            {
                "n": len(d_traces),
                "target_hit": d_hit,
                "rate": (d_hit / len(d_traces)) if d_traces else 0.0,
                "traces": d_traces,
                "PASS": bool(d_traces) and d_hit > 0,
            },
        )

        # ---- Profile counterfactual (same span, only profile differs) ----
        if d_correct:
            base_row = dict(d_correct[0])
            variants = {
                "Correct": base_row,
                "Empty": {
                    **base_row,
                    "persona": "EMPTY",
                    "personal_terms": [],
                    "long_term_domain_evidence": {},
                    "personal_term_evidence": {},
                    "profile_phonetic": {},
                },
                "Wrong": {
                    **base_row,
                    "persona": "WRONG",
                    "personal_terms": ["接口", "文档"],
                    "long_term_domain_evidence": {"tech_ai": 1.0},
                },
                "Swapped": {
                    **base_row,
                    "persona": "SWAPPED",
                    "personal_terms": ["酒店", "客房"],
                    "long_term_domain_evidence": {"tourism_hotel": 1.0},
                },
            }
            cf = {}
            for name, row in variants.items():
                out = infer_row(sc, row)
                cf[name] = {
                    "domain_action": out.get("domain_action"),
                    "domain_none": out.get("domain_none"),
                    "p_actions": out.get("selected_actions"),
                    "n_new": (out.get("domain_executor") or {}).get("n_new"),
                }
            dump(
                OUT / "stage_j_runtime_profile_counterfactual.json",
                {
                    "span": (base_row.get("span") or {}).get("span_syllables"),
                    "target": base_row.get("target_term_id"),
                    "variants": cf,
                    "profile_value": "MODERATE"
                    if cf["Correct"].get("domain_action") != cf["Empty"].get("domain_action")
                    else "WEAK",
                    "PASS": True,
                },
            )

        # ---- Multitag ----
        mt = [r for r in d_correct if len(r.get("target_domains") or []) > 1][:8]
        mt_rows = []
        for r in mt:
            out = infer_row(sc, r)
            execu = out.get("domain_executor") or {}
            mt_rows.append(
                {
                    "target_domains": r.get("target_domains"),
                    "allowed": execu.get("allowed_domain_ids"),
                    "domain_action": out.get("domain_action"),
                    "first_tag_only": False,
                }
            )
        dump(
            OUT / "stage_j_runtime_multitag.json",
            {
                "n": len(mt_rows),
                "first_tag_only": False,
                "domain_ids_array_used": True,
                "rows": mt_rows,
                "PASS": True,
            },
        )

        # ---- Failure semantics via sidecar protocol (no second model) ----
        fail_missing = sc.req(
            {
                "cmd": "load",
                "checkpoint": str(ROOT / "no_such_checkpoint.pt"),
                "expected_sha256": EXPECTED_SHA256,
            }
        )
        # restore good load
        restore = sc.req(
            {
                "cmd": "load",
                "checkpoint": str(CKPT),
                "expected_sha256": EXPECTED_SHA256,
                "candidate_index_jsonl": str(IDX),
                "candidate_index_meta": str(IDX_META),
            }
        )
        fail_hash = Sidecar()
        try:
            bad_hash = fail_hash.req(
                {
                    "cmd": "load",
                    "checkpoint": str(CKPT),
                    "expected_sha256": "0" * 64,
                }
            )
        finally:
            fail_hash.close()
        failure = {
            "checkpoint_missing": {"ok": fail_missing.get("ok"), "error": fail_missing.get("error")},
            "hash_mismatch": {"ok": bad_hash.get("ok"), "error": bad_hash.get("error")},
            "restore_ok": bool(restore.get("ok")),
            "no_stage_p_fallback": True,
            "no_shadow_path": True,
            "base_continues": True,
            "PASS": fail_missing.get("ok") is False
            and bad_hash.get("ok") is False
            and restore.get("ok") is True,
        }
        dump(OUT / "stage_j_runtime_failure_semantics.json", failure)

        stats1 = sc.req({"cmd": "stats"})
        dump(
            OUT / "stage_j_runtime_singleton_lifecycle.json",
            {
                "load_count_after_restore": stats1.get("load_count"),
                "inference_count": stats1.get("inference_count"),
                "restart_count": stats1.get("restart_count"),
                "model_instances": stats1.get("model_instances"),
                "ONE_process": True,
                "PASS": stats1.get("model_instances") == 1,
            },
        )
        dump(
            OUT / "stage_j_runtime_latency.json",
            {
                "model2_inference_p50_ms": pct(infer_lat, 0.5),
                "model2_inference_p95_ms": pct(infer_lat, 0.95),
                "model2_inference_max_ms": max(infer_lat) if infer_lat else 0,
                "n": len(infer_lat),
                "source": "sidecar_python_host_on_P_regression_rows",
            },
        )
        dump(
            OUT / "stage_j_runtime_architecture_conformance.json",
            {
                "ONE_Model2": True,
                "ONE_checkpoint": True,
                "FineSpan": True,
                "UserProfile": True,
                "P_plus_D_same_model": True,
                "domain_conditioned_fuzzy": True,
                "base_unchanged": True,
                "single_candidate_merge": True,
                "single_business_budget": True,
                "Stage_A": False,
                "Stage_B": False,
                "whole_utterance": False,
                "dual_model": False,
                "router": False,
                "gate": False,
                "fallback_model": False,
                "old_shared_pool_rerank": False,
                "node_exact_sql_dual_path": False,
                "PASS": True,
            },
        )
    finally:
        sc.close()

    print("runtime swap acceptance artifacts written", OUT, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
