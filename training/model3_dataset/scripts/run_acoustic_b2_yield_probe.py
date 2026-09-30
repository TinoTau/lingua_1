# -*- coding: utf-8 -*-
"""Bounded Model3 V2 Acoustic B2 yield probe (Route B2). No training / no formal dataset."""
from __future__ import annotations

import json
import os
import subprocess
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
import sys

if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
DOCS = REPO / "docs/user_correction/model3"
FW_DUMP_DIR = REPO / "docs/tone-v2/_audit_scratch/tone_full_chain_runtime_2026_07_29"
MANIFEST = REPO / "test wav/dialog_200/cases.manifest.json"
HARNESS = REPO / "training/model3_dataset/offline_harness/acoustic_b2_formal_materialize.cjs"
ELECTRON = REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
WORK = REPO / "training/model3_dataset/offline_harness/_b2_yield_work"
OUT_DIR = DOCS

PROTECTED = {
    "d002",
    "d003",
    "d019",
    "d049",
    "d099",
    "d131",
    "d139",
    "d142",
    "d160",
    "d176",
    "d179",
    "d181",
    "d195",
}

from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    derive_malformed_regions,
    label_spans_v2,
)


def load_manifest_refs() -> dict[str, str]:
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    out = {}
    for c in m.get("cases") or []:
        cid = c.get("id")
        if not cid:
            continue
        out[cid] = c.get("expectedText") or c.get("text") or c.get("utterance") or ""
    return out


def load_probe_inputs(limit: int = 30) -> list[dict]:
    refs = load_manifest_refs()
    prot_texts = {refs[c] for c in PROTECTED if c in refs and refs[c]}
    rows = []
    for f in sorted(FW_DUMP_DIR.glob("*.fw.json")):
        # files are named d001.fw.json → stem "d001.fw"
        name = f.name
        if not name.endswith(".fw.json"):
            continue
        cid = name[: -len(".fw.json")]
        if cid in PROTECTED:
            continue
        o = json.loads(f.read_text(encoding="utf-8"))
        asr = (o.get("rawText") or o.get("text") or "").strip()
        ref = (refs.get(cid) or o.get("expectedText") or "").strip()
        if ref in prot_texts:
            # exact protected sourceText / near-duplicate of protected inventory
            continue
        tone = o.get("utterance_tone") or {}
        slices = tone.get("acousticToneSlices") or []
        segs = o.get("segments") or []
        if not asr or not ref or not slices:
            continue
        rows.append(
            {
                "id": cid,
                "referenceText": ref,
                "currentText": asr,
                "acousticToneSlices": slices,
                "asrSegments": segs,
                "audioAssetId": o.get("audioPath") or f"dialog_200/{cid}.wav",
                "audioSourceProvenance": "EXISTING_PIPER_DIALOG200_WAV+HISTORICAL_FW_DUMP",
                "evidenceLevel": "TTS_ASR",
                "dumpPath": str(f),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def holdout_check(rows: list[dict]) -> list[str]:
    collisions = []
    refs = load_manifest_refs()
    prot_texts = {refs[c] for c in PROTECTED if c in refs and refs[c]}
    for r in rows:
        if r["id"] in PROTECTED:
            collisions.append(f"caseId:{r['id']}")
        if r["referenceText"] in prot_texts:
            collisions.append(f"refText:{r['id']}")
    return collisions


def run_harness(reqs: list[dict]) -> tuple[list[dict], float]:
    WORK.mkdir(parents=True, exist_ok=True)
    req_path = WORK / "req.jsonl"
    resp_path = WORK / "resp.jsonl"
    err_path = WORK / "err.txt"
    with req_path.open("w", encoding="utf-8") as f:
        for r in reqs:
            f.write(
                json.dumps(
                    {
                        "id": r["id"],
                        "referenceText": r["referenceText"],
                        "currentText": r["currentText"],
                        "acousticToneSlices": r["acousticToneSlices"],
                        "asrSegments": r["asrSegments"],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env["PROJECT_ROOT"] = str(REPO)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2> "{err_path}"'
    t0 = time.time()
    subprocess.run(cmd, shell=True, cwd=cwd, env=env)
    elapsed = time.time() - t0
    outs = []
    if resp_path.exists():
        for line in resp_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("[Logger]"):
                continue
            try:
                outs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return outs, elapsed


def region_family(tag: str, length_changing: bool) -> str:
    if tag == "insert" or tag == "delete":
        return "DELETION" if tag == "insert" else "DELETION" if tag == "delete" else tag.upper()
    if tag == "delete":
        return "DELETION"
    if tag == "insert":
        return "INSERTION"
    if tag == "replace":
        return "MULTI_CHAR_REPLACEMENT" if length_changing else "SUBSTITUTION"
    return (tag or "OTHER").upper()


def analyze(rows: list[dict], mats: list[dict], harness_s: float) -> dict:
    by_id = {m.get("id"): m for m in mats}
    funnel = Counter()
    funnel["N0"] = len(rows)
    cand_cells = Counter()
    cand_hist = Counter()
    label_hist = Counter()
    family_hist = Counter()
    readiness = Counter()
    readiness_retry = Counter()
    anchor_src = Counter()
    path_counts = []
    multipath = 0
    coherent_ok = 0
    coherent_fail = 0
    retry_samples = 0
    usable_samples = 0
    surface_labels: dict[str, Counter] = defaultdict(Counter)
    retry_examples = []
    provenance_rejects = []

    for src in rows:
        funnel["N1"] += 1  # audio already existed
        funnel["N2"] += 1  # ASR dump present
        ref = src["referenceText"]
        asr = src["currentText"]
        if asr != ref:
            funnel["N3"] += 1
        regions = derive_malformed_regions(asr, ref)
        if regions:
            funnel["N4"] += 1
        for r in regions:
            fam = region_family(r.get("tag") or "", bool(r.get("lengthChanging")))
            if r.get("tag") == "insert":
                fam = "INSERTION"
            elif r.get("tag") == "delete":
                fam = "DELETION"
            elif r.get("tag") == "replace":
                fam = (
                    "MULTI_CHAR_REPLACEMENT"
                    if r.get("lengthChanging")
                    else "SUBSTITUTION"
                )
            family_hist[fam] += 1

        mat = by_id.get(src["id"])
        if not mat or not mat.get("ok"):
            provenance_rejects.append({"id": src["id"], "reason": "lattice_fail", "mat": mat})
            coherent_fail += 1
            continue

        # provenance: currentText must match materialize currentText
        if (mat.get("currentText") or "") != asr:
            coherent_fail += 1
            provenance_rejects.append(
                {"id": src["id"], "reason": "CROSS_SAMPLE_PROVENANCE_MISMATCH_TEXT"}
            )
            continue

        # merge all paths' spans for labeling per path
        utt_has_repairable = False
        utt_has_overlap = False
        utt_has_tone_ready = False
        utt_has_valid_cand_state = False
        utt_has_retry = False
        utt_usable = False

        pc = int(mat.get("pathCount") or 0)
        path_counts.append(pc)
        if pc > 1:
            multipath += 1

        for path in mat.get("paths") or []:
            path_mat = {
                "currentText": asr,
                "referenceText": ref,
                "spans": path.get("spans") or [],
                "corruptions": [],
            }
            labeled, _stats, regs = label_spans_v2(path_mat)
            # N5: repairable non-anchor region exists
            non_anchor_regs = [r for r in regs if r.get("curEnd", 0) > r.get("curStart", 0)]
            if non_anchor_regs:
                utt_has_repairable = True

            for sp in labeled:
                lab = sp.get("label")
                if lab == "EXCLUDE_FROM_SUPERVISED":
                    lab = "EXCLUDE"
                label_hist[lab or "UNK"] += 1
                is_anchor = bool(sp.get("isAnchor"))
                anchor_src[sp.get("anchorSource") or ("DOMAIN" if is_anchor else "NONE")] += 1
                cand = int((sp.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0)
                # find matching materialize span for tone readiness
                match = next(
                    (
                        s
                        for s in (path.get("spans") or [])
                        if s.get("spanId") == sp.get("spanId")
                    ),
                    {},
                )
                tr = match.get("toneReadiness") or "unknown"
                readiness[tr] += 1
                if not is_anchor and lab in ("KEEP", "RETRY"):
                    cand_hist[cand] += 1
                    cell = f"{lab}_cand_{'gt0' if cand > 0 else '0'}"
                    cand_cells[cell] += 1
                    surf = sp.get("surface") or ""
                    if surf:
                        surface_labels[surf][lab] += 1
                if lab == "RETRY":
                    readiness_retry[tr] += 1
                    utt_has_retry = True
                    if match.get("toneReadiness") == "ready" or tr == "ready":
                        utt_has_tone_ready = True
                    # FineSpan overlap implied by RETRY projection
                    utt_has_overlap = True
                    if cand > 0:
                        utt_has_valid_cand_state = True
                    if len(retry_examples) < 12:
                        retry_examples.append(
                            {
                                "id": src["id"],
                                "pathId": path.get("pathId"),
                                "surface": sp.get("surface"),
                                "rawStart": sp.get("rawStart"),
                                "rawEnd": sp.get("rawEnd"),
                                "cand": cand,
                                "toneReadiness": tr,
                                "anchorSource": sp.get("anchorSource"),
                                "labelReason": sp.get("labelReason"),
                                "refSlice": ref[sp.get("rawStart", 0) : sp.get("rawEnd", 0)]
                                if len(ref) == len(asr)
                                else None,
                                "asrSlice": asr[sp.get("rawStart", 0) : sp.get("rawEnd", 0)],
                            }
                        )

            # valid cand state materialized if any non-fallback cand variation exists
            hist = Counter(
                int((s.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0)
                for s in (path.get("spans") or [])
            )
            if any(k > 0 for k in hist):
                utt_has_valid_cand_state = True
            if any((s.get("toneReadiness") == "ready") for s in (path.get("spans") or [])):
                utt_has_tone_ready = True
            if non_anchor_regs and any(
                sp.get("label") == "RETRY" for sp in labeled
            ):
                utt_has_overlap = True

        if utt_has_repairable:
            funnel["N5"] += 1
        if utt_has_overlap:
            funnel["N6"] += 1
        if utt_has_tone_ready:
            funnel["N7"] += 1
        if utt_has_valid_cand_state:
            funnel["N8"] += 1
        if utt_has_retry:
            funnel["N9"] += 1
            retry_samples += 1

        coherent_ok += 1
        # usable: coherent + at least one RETRY + cand state present on sample
        if utt_has_retry and utt_has_valid_cand_state:
            # stricter usable: RETRY with cand>0 somewhere preferred but N10 = coherent RETRY sample
            utt_usable = True
        # N10: coherent usable RETRY sample (with production cand channel not collapsed)
        if utt_has_retry and (cand_cells["RETRY_cand_gt0"] > 0 or utt_has_valid_cand_state):
            # per-utterance usable if has RETRY and utterance has some cand>0 OR RETRY cand>0
            has_retry_gt0 = any(
                ex["id"] == src["id"] and ex["cand"] > 0 for ex in retry_examples
            )
            # recompute from labeled paths above via scanning
            pass

        # finalize usable for this utterance
        retry_gt0_here = False
        for path in mat.get("paths") or []:
            path_mat = {
                "currentText": asr,
                "referenceText": ref,
                "spans": path.get("spans") or [],
                "corruptions": [],
            }
            labeled, _, _ = label_spans_v2(path_mat)
            for sp in labeled:
                if sp.get("label") != "RETRY" or sp.get("isAnchor"):
                    continue
                match = next(
                    (
                        s
                        for s in (path.get("spans") or [])
                        if s.get("spanId") == sp.get("spanId")
                    ),
                    {},
                )
                cand = int((match.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0)
                if cand > 0:
                    retry_gt0_here = True
        if utt_has_retry and (retry_gt0_here or utt_has_valid_cand_state):
            # Usable Model3 RETRY sample: coherent + RETRY present + cand channel not constant-collapse on utt
            if retry_gt0_here or utt_has_valid_cand_state:
                funnel["N10"] += 1
                usable_samples += 1

    # Fix N10 definition: count utterances with at least one RETRY span with cand>0 OR
    # (RETRY and natural cand>0 somewhere). Prefer RETRY+cand>0 for success criteria.
    # Recompute N10 cleanly:
    funnel["N10"] = 0
    usable_samples = 0
    retry_gt0_utt = 0
    for src in rows:
        mat = by_id.get(src["id"])
        if not mat or not mat.get("ok"):
            continue
        if (mat.get("currentText") or "") != src["currentText"]:
            continue
        has_retry = False
        has_retry_gt0 = False
        for path in mat.get("paths") or []:
            labeled, _, _ = label_spans_v2(
                {
                    "currentText": src["currentText"],
                    "referenceText": src["referenceText"],
                    "spans": path.get("spans") or [],
                    "corruptions": [],
                }
            )
            id_to_cand = {
                s["spanId"]: int((s.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0)
                for s in (path.get("spans") or [])
            }
            for sp in labeled:
                if sp.get("label") == "RETRY" and not sp.get("isAnchor"):
                    has_retry = True
                    if id_to_cand.get(sp.get("spanId"), 0) > 0:
                        has_retry_gt0 = True
        if has_retry_gt0:
            retry_gt0_utt += 1
            funnel["N10"] += 1
            usable_samples += 1
        elif has_retry:
            # counted in N9 but not N10
            pass

    n0 = max(funnel["N0"], 1)
    same_surface = []
    for surf, ctr in surface_labels.items():
        if ctr.get("KEEP", 0) > 0 and ctr.get("RETRY", 0) > 0:
            same_surface.append({"surface": surf, "KEEP": ctr["KEEP"], "RETRY": ctr["RETRY"]})

    return {
        "funnel": dict(funnel),
        "yields": {
            "USABLE_MODEL3_RETRY_YIELD": funnel["N10"] / n0,
            "N9_over_N0": funnel["N9"] / n0,
            "N8_over_N0": funnel["N8"] / n0,
            "N5_over_N0": funnel["N5"] / n0,
            "ASR_mismatch_rate": funnel["N3"] / n0,
            "retry_plus_cand_gt0_utterances": retry_gt0_utt,
        },
        "cand_cells": dict(cand_cells),
        "cand_hist": {str(k): v for k, v in sorted(cand_hist.items())},
        "label_hist": dict(label_hist),
        "family_hist": dict(family_hist),
        "readiness": dict(readiness),
        "readiness_retry": dict(readiness_retry),
        "anchor_src": dict(anchor_src),
        "path_count_hist": dict(Counter(path_counts)),
        "multipath_utterances": multipath,
        "coherent_ok": coherent_ok,
        "coherent_fail": coherent_fail,
        "provenance_rejects": provenance_rejects[:20],
        "retry_examples": retry_examples,
        "same_surface": same_surface[:30],
        "harness_elapsed_sec": round(harness_s, 2),
        "harness_per_utt_sec": round(harness_s / max(len(rows), 1), 2),
    }


def classify(report: dict) -> tuple[str, str, str]:
    y = report["yields"]
    cells = report["cand_cells"]
    funnel = report["funnel"]
    n0 = funnel["N0"]
    retry_gt0 = cells.get("RETRY_cand_gt0", 0)
    keep0 = cells.get("KEEP_cand_0", 0)
    keep_gt0 = cells.get("KEEP_cand_gt0", 0)
    retry0 = cells.get("RETRY_cand_0", 0)

    if report["coherent_fail"] and report["coherent_ok"] == 0:
        return "PROVENANCE_COHERENCE_FAILURE", "ZERO_USABLE_YIELD", "STOP_AND_REVIEW"
    if keep_gt0 + retry_gt0 == 0 and (keep0 + retry0) > 0:
        return (
            "B2_CANDIDATE_STATE_INSUFFICIENT"
            if funnel.get("N9", 0) > 0
            else "PRODUCTION_STATE_MATERIALIZATION_FAILURE",
            "ZERO_USABLE_YIELD",
            "STOP_AND_REVIEW",
        )
    if funnel.get("N9", 0) == 0:
        return "B2_ZERO_USABLE_RETRY", "ZERO_USABLE_YIELD", "MODEL3_V2_ACOUSTIC_YIELD_ENHANCEMENT_ARCHITECTURE_PROPOSAL"
    if retry_gt0 == 0 and funnel.get("N9", 0) > 0:
        return "B2_CANDIDATE_STATE_INSUFFICIENT", "LOW_YIELD", "STOP_AND_REVIEW"

    usable = y["USABLE_MODEL3_RETRY_YIELD"]
    # Architecture signal present, but N from existing dumps is thin and fresh TTS→ASR
    # could not be expanded this run → prefer extension unless N is comfortable.
    if usable > 0 and retry_gt0 > 0 and keep_gt0 > 0 and keep0 > 0:
        if n0 >= 40 and usable >= 0.25 and retry_gt0 >= 15:
            return (
                "B2_YIELD_PROBE_PASS",
                "STRONG_YIELD" if usable >= 0.4 else "USABLE_YIELD",
                "MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION_PLAN",
            )
        if n0 >= 25 and usable >= 0.2 and retry_gt0 >= 8:
            return (
                "B2_YIELD_PROBE_PASS",
                "USABLE_YIELD",
                "MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION_PLAN",
            )
        return (
            "B2_YIELD_PROMISING_MORE_PROBE_NEEDED",
            "INSUFFICIENT_SAMPLE" if n0 < 25 else "USABLE_YIELD",
            "MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION",
        )
    if usable > 0 and retry_gt0 > 0:
        if usable < 0.1:
            return "B2_LOW_YIELD", "LOW_YIELD", "MODEL3_V2_ACOUSTIC_YIELD_ENHANCEMENT_ARCHITECTURE_PROPOSAL"
        return "B2_YIELD_PROMISING_MORE_PROBE_NEEDED", "USABLE_YIELD", "MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION"
    return "B2_ZERO_USABLE_RETRY", "ZERO_USABLE_YIELD", "MODEL3_V2_ACOUSTIC_YIELD_ENHANCEMENT_ARCHITECTURE_PROPOSAL"


def main() -> int:
    t_all = time.time()
    rows = load_probe_inputs(limit=30)
    collisions = holdout_check(rows)
    if collisions:
        summary = {
            "probeVerdict": "PROTECTED_HOLDOUT_LEAKAGE",
            "collisions": collisions,
        }
        (OUT_DIR / "model3_v2_acoustic_yield_probe_summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 2

    mats, harness_s = run_harness(rows)
    report = analyze(rows, mats, harness_s)
    verdict, yield_cls, next_phase = classify(report)

    # pipeline parity flags
    ok_mats = [m for m in mats if m.get("ok")]
    lexical_nonzero = sum(1 for m in ok_mats if int(m.get("lexicalEdgeCount") or 0) > 0)
    cand_gt0_total = report["cand_cells"].get("KEEP_cand_gt0", 0) + report["cand_cells"].get(
        "RETRY_cand_gt0", 0
    )

    summary = {
        "phase": "MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE",
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "probeVerdict": verdict,
        "yieldClassification": yield_cls,
        "N": report["funnel"]["N0"],
        "b2ArchitectureTechnicallyValid": lexical_nonzero > 0 and cand_gt0_total > 0,
        "readyForImplementationPlan": verdict == "B2_YIELD_PROBE_PASS",
        "datasetBuildCanResume": False,
        "sampleSource": "EXISTING_NON_HOLDOUT_DIALOG200_FW_DUMPS",
        "sampleSourceNote": (
            "Live ASR service failed to start (cuDNN). Probe used existing production-equivalent "
            "Piper→ASR→Tone dumps for non-protected dialog_200 cases. No pronunciation perturbation. "
            "No new TTS generation in this run."
        ),
        "pronunciationPerturbationEnabled": False,
        "protectedCollisions": collisions,
        "funnel": report["funnel"],
        "yields": report["yields"],
        "cand_cells": report["cand_cells"],
        "cand_hist": report["cand_hist"],
        "label_hist": report["label_hist"],
        "family_hist": report["family_hist"],
        "readiness": report["readiness"],
        "readiness_retry": report["readiness_retry"],
        "anchor_src": report["anchor_src"],
        "multipath": {
            "path_count_hist": report["path_count_hist"],
            "multipath_utterances": report["multipath_utterances"],
        },
        "same_surface": report["same_surface"],
        "retry_examples": report["retry_examples"],
        "provenance": {
            "coherent_ok": report["coherent_ok"],
            "coherent_fail": report["coherent_fail"],
            "rejects": report["provenance_rejects"],
        },
        "compute": {
            "harness_elapsed_sec": report["harness_elapsed_sec"],
            "harness_per_utt_sec": report["harness_per_utt_sec"],
            "wall_sec": round(time.time() - t_all, 2),
            "tts_elapsed": "N/A_EXISTING_AUDIO",
            "asr_elapsed": "N/A_EXISTING_DUMP",
        },
        "pipelineParity": {
            "audio": "EXISTING_PIPER_WAV",
            "asr_fw": "HISTORICAL_PRODUCTION_DUMP",
            "tone": "HISTORICAL_AcousticToneSlice",
            "recall": "MandatoryToneRecall_via_lattice",
            "fineSpan": "runLatticeFineSpanGeneration",
            "featurePacking": "model3FirstPassCandidateCount+pack",
            "lexical_utt_with_edges": lexical_nonzero,
        },
        "nextPhase": next_phase,
        "nextPhaseExecuted": False,
        "governance": {
            "Model3Changed": False,
            "featureContractChanged": False,
            "RecallChanged": False,
            "ToneChanged": False,
            "formalDatasetBuilt": False,
            "trainingExecuted": False,
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "model3_v2_acoustic_yield_probe_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # funnel csv
    with (OUT_DIR / "model3_v2_acoustic_yield_funnel.csv").open("w", encoding="utf-8") as f:
        f.write("stage,count,rate_of_N0\n")
        n0 = max(report["funnel"]["N0"], 1)
        for k in [
            "N0",
            "N1",
            "N2",
            "N3",
            "N4",
            "N5",
            "N6",
            "N7",
            "N8",
            "N9",
            "N10",
        ]:
            v = report["funnel"].get(k, 0)
            f.write(f"{k},{v},{v/n0:.4f}\n")
        f.write(
            f"USABLE_MODEL3_RETRY_YIELD,{report['yields']['USABLE_MODEL3_RETRY_YIELD']:.6f},\n"
        )

    with (OUT_DIR / "model3_v2_acoustic_probe_candidate_distribution.csv").open(
        "w", encoding="utf-8"
    ) as f:
        f.write("cell,count\n")
        for k in ["KEEP_cand_0", "KEEP_cand_gt0", "RETRY_cand_0", "RETRY_cand_gt0"]:
            f.write(f"{k},{report['cand_cells'].get(k, 0)}\n")
        f.write("rawCand,count\n")
        for k, v in report["cand_hist"].items():
            f.write(f"{k},{v}\n")

    prov = {
        "contract": "MODEL3_V2_TRAINING_PROVENANCE_CONTRACT_DRAFT",
        "evidenceLevel": "TTS_ASR",
        "sampleIds": [r["id"] for r in rows],
        "audioSourceProvenance": "EXISTING_PIPER_DIALOG200_WAV+HISTORICAL_FW_DUMP",
        "LABEL_FEATURE_PROVENANCE_COHERENT_ok": report["coherent_ok"],
        "LABEL_FEATURE_PROVENANCE_COHERENT_fail": report["coherent_fail"],
        "CROSS_SAMPLE_PROVENANCE_MISMATCH": [
            x for x in report["provenance_rejects"] if "MISMATCH" in x.get("reason", "")
        ],
        "protectedHoldoutExcluded": True,
        "pronunciationPerturbation": False,
    }
    (OUT_DIR / "model3_v2_acoustic_probe_provenance_summary.json").write_text(
        json.dumps(prov, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "verdict": verdict,
                "yield": yield_cls,
                "N": report["funnel"]["N0"],
                "funnel": report["funnel"],
                "yields": report["yields"],
                "cand_cells": report["cand_cells"],
                "nextPhase": next_phase,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
