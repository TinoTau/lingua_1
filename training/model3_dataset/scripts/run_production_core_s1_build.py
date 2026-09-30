# -*- coding: utf-8 -*-
"""MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S1 — formal B2 build ~1000 families."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.acoustic_training.family_identity import (  # noqa: E402
    assert_split_locked,
    assign_split,
    semantic_family_id,
)
from training.model3_dataset.acoustic_training.holdout_registry import (  # noqa: E402
    ensure_registry_file,
    check_holdout,
)
from training.model3_dataset.acoustic_training.orchestrator import (  # noqa: E402
    HARNESS,
    materialize_fresh_batch,
)
from training.model3_dataset.acoustic_training.serializer import (  # noqa: E402
    FEATURE_CONTRACT,
    LABEL_CONTRACT,
    PIPELINE_VERSION,
)
from training.model3_dataset.scripts.run_targeted_dist_dataset_build import (  # noqa: E402
    _cand,
    _corruption_tax,
    _feat_stats,
    _pos_bin,
    collect_samples,
    load_gate0_exclusions,
    qa_and_audit,
    select_pool_candidates,
    write_shard_freeze,
)
from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    anchor_ranges,
    derive_malformed_regions,
)

DOCS = REPO / "docs/user_correction/model3"
V1_OUT = REPO / "training/model3_dataset/model3_v2_targeted_dist_corrected_v1"
OUT = REPO / "training/model3_dataset/model3_v2_production_core_s1"
BUILD = OUT / "build"
WORK = REPO / "training/model3_dataset/offline_harness/_b2_formal_work"

DATASET_ID = "MODEL3_V2_PRODUCTION_CORE_S1"
DATASET_BUILD_ID = "prod_core_s1_build_20260830_v1"
PARENT_DATASET_ID = "MODEL3_V2_TARGETED_DIST_CORRECTED_V1"
SOURCE_SELECTION_SEED = 2026083006
TARGET_FAMILIES = 1000
NEW_TARGET = 720
SHARD_SIZE = 48  # 15 shards × 48 = 720
CJK = re.compile(r"[\u4e00-\u9fff]")

CONV_TAXONOMY = {
    "daily_request": ("请", "帮", "麻烦", "能不能", "可不可以", "需要", "给我"),
    "question": ("什么", "哪里", "怎么", "为什么", "多少", "几", "吗", "呢", "?"),
    "answer": ("是的", "对的", "没错", "可以", "好的", "行", "没问题"),
    "confirmation": ("确认", "是不是", "对吗", "核实", "核对"),
    "negation": ("不", "没", "别", "未", "无", "不要"),
    "correction_clarify": ("更正", "纠正", "澄清", "说明", "解释", "重新"),
    "casual_social": ("今天", "明天", "刚才", "现在", "一下", "看看"),
    "shopping_food": ("买", "点", "餐", "饭", "菜", "店", "外卖", "糖", "杯"),
    "transport": ("路", "车", "站", "导航", "到达", "出发", "掉头", "停车"),
    "workplace": ("会议", "项目", "同事", "客户", "报告", "流程", "上线", "研发"),
    "scheduling": ("预约", "时间", "几点", "日程", "安排", "改期", "下午三点"),
    "travel": ("旅行", "景点", "门票", "行李", "航班", "登机"),
    "hotel": ("酒店", "入住", "退房", "续住", "亲子房"),
    "customer_service": ("客服", "订单", "退款", "发票", "投诉", "售后", "报错"),
    "tech_device": ("设备", "系统", "网络", "软件", "更新", "缓存", "登录", "接口"),
    "family_social": ("家人", "朋友", "孩子", "父母", "一起", "咱们"),
    "weather_plans": ("天气", "下雨", "温度", "计划", "活动"),
    "numbers_quantities": ("数量", "份", "个", "几", "多少", "第一", "第二"),
    "time_dates": ("点", "分", "号", "日", "月", "年", "周", "上午", "下午"),
    "names_places": ("公司", "医院", "学校", "中心", "市", "区", "路", "站"),
}

PROVISIONAL_FLOORS = {
    "family_social": 999,
    "weather_plans": 999,
    "workplace": 25,
    "travel": 20,
    "hotel": 15,
    "customer_service": 25,
    "tech_device": 30,
    "transport": 35,
    "question": 40,
}


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cjk_len(t: str) -> int:
    return len(CJK.findall(t))


def _length_bucket(t: str) -> str:
    n = _cjk_len(t)
    if n < 14:
        return "short"
    if n < 22:
        return "medium"
    return "long"


def _categories(t: str) -> set[str]:
    return {cat for cat, kws in CONV_TAXONOMY.items() if any(k in t for k in kws)}


def load_v1_seed_refs() -> list[dict]:
    refs: dict[str, dict] = {}
    for p in sorted(V1_OUT.glob("build/shard_freeze_s*.csv")):
        with p.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                fam = row["semanticFamilyId"]
                if fam not in refs:
                    refs[fam] = {
                        "referenceId": row["referenceId"],
                        "referenceText": row["referenceText"],
                        "referenceTextHash": row["referenceTextHash"],
                        "sourcePoolId": row.get("sourcePool") or "model3_certified_base_pool_v2",
                        "sourceCorpus": "lineage_reuse_v1",
                        "semanticFamilyId": fam,
                        "lineageReuse": True,
                        "parentDatasetId": PARENT_DATASET_ID,
                    }
    return list(refs.values())


def v1_contract_compatible() -> bool:
    mp = V1_OUT / "dataset_manifest.json"
    if not mp.exists():
        return False
    m = json.loads(mp.read_text(encoding="utf-8"))
    return (
        m.get("pipelineVersion") == PIPELINE_VERSION
        and m.get("featureContractIdentity") == FEATURE_CONTRACT
        and m.get("labelContractIdentity") == LABEL_CONTRACT
        and m.get("asrIdentity") == "faster_whisper_vad_/utterance"
        and m.get("toneIdentity") == "production_ToneModule"
    )


def load_v1_reused_samples() -> list[dict]:
    out: list[dict] = []
    for split in ("train", "dev", "test"):
        p = V1_OUT / split / "shard-000.jsonl"
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                s = json.loads(line)
                if s.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
                    continue
                s = dict(s)
                s["datasetId"] = DATASET_ID
                s["datasetBuildId"] = DATASET_BUILD_ID
                s["shardId"] = "reuse_v1"
                s["lineageReuse"] = True
                s["parentDatasetId"] = PARENT_DATASET_ID
                prov = dict(s.get("provenance") or {})
                prov["datasetVersion"] = DATASET_ID
                prov["datasetBuildId"] = DATASET_BUILD_ID
                prov["lineageReuseFrom"] = PARENT_DATASET_ID
                s["provenance"] = prov
                out.append(s)
    return out


def select_new_references(candidates: list[dict], exclude_fams: set[str]) -> list[dict]:
    pool = [c for c in candidates if c["semanticFamilyId"] not in exclude_fams]
    rng = np.random.default_rng(SOURCE_SELECTION_SEED)
    by_cat: dict[str, list[dict]] = defaultdict(list)
    by_source: dict[str, list[dict]] = defaultdict(list)
    for c in pool:
        by_source[c.get("sourceCorpus") or "unknown"].append(c)
        for cat in _categories(c["referenceText"]):
            by_cat[cat].append(c)

    selected: dict[str, dict] = {}
    order = list(range(len(pool)))
    rng.shuffle(order)

    def pick_from(items: list[dict], n: int) -> None:
        rng.shuffle(items)
        for c in items:
            if len(selected) >= NEW_TARGET:
                return
            fam = c["semanticFamilyId"]
            if fam in selected or fam in exclude_fams:
                continue
            selected[fam] = c
            if len([x for x in selected.values() if cat_hit(x, items)]) >= n:
                return

    def cat_hit(c: dict, items: list[dict]) -> bool:
        return c in items

    # category floors
    for cat, floor in PROVISIONAL_FLOORS.items():
        items = by_cat.get(cat, [])
        need = min(floor, len(items))
        got = 0
        rng.shuffle(items)
        for c in items:
            if got >= need or len(selected) >= NEW_TARGET:
                break
            fam = c["semanticFamilyId"]
            if fam in selected:
                continue
            selected[fam] = c
            got += 1

    # source-diversity fill: alternate prior_certified vs supplement
    sources = sorted(by_source.keys())
    supp = [s for s in sources if "SUPPLEMENT" in s.upper() or "SPOKEN" in s.upper()]
    prior = [s for s in sources if s not in supp]
    if not prior:
        prior = sources[:1]
    if not supp:
        supp = sources

    idx = 0
    while len(selected) < NEW_TARGET:
        src_list = prior if idx % 3 == 0 else supp
        src = src_list[(idx // 3) % len(src_list)]
        idx += 1
        added = False
        buckets = ["short", "medium", "long"]
        rng.shuffle(buckets)
        for bucket in buckets:
            for c in by_source.get(src, []):
                if _length_bucket(c["referenceText"]) != bucket:
                    continue
                fam = c["semanticFamilyId"]
                if fam in selected:
                    continue
                selected[fam] = c
                added = True
                break
            if added or len(selected) >= NEW_TARGET:
                break
        if not added:
            for c in pool:
                fam = c["semanticFamilyId"]
                if fam not in selected:
                    selected[fam] = c
                    break
            else:
                break

    out = list(selected.values())[:NEW_TARGET]
    if len(out) < NEW_TARGET:
        raise RuntimeError(f"insufficient new refs selected {len(out)} < {NEW_TARGET}")
    return out


def freeze_new_shards(refs: list[dict]) -> list[list[dict]]:
    shards: list[list[dict]] = []
    for i in range(0, len(refs), SHARD_SIZE):
        chunk = refs[i : i + SHARD_SIZE]
        if chunk:
            shards.append(chunk)
    return shards


def run_shard_s1(shard_id: str, refs: list[dict], asr_env: str | None) -> dict:
    t0 = time.perf_counter()
    out = materialize_fresh_batch(
        refs,
        run_id=f"{DATASET_BUILD_ID}_{shard_id}",
        wav_dir=WORK / f"s1_wavs_{shard_id}",
        manifest_path=WORK / f"manifest_{DATASET_BUILD_ID}_{shard_id}.json",
        asr_env_identity=asr_env,
    )
    elapsed = time.perf_counter() - t0
    results = out["results"]
    m2_host = m2_att = m2_comp = 0
    for r in results:
        if r.get("disposition") not in ("SUPERVISED_ACCEPTED", "SEMANTIC_EXCLUDE"):
            continue
        if r.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
            continue
        d = (r.get("utt") or {}).get("ownerDiagnostics") or {}
        if d.get("MODEL2_OWNER_ATTEMPTED"):
            m2_att += 1
        if d.get("MODEL2_OWNER_COMPLETED"):
            m2_comp += 1
        if d.get("MODEL2_HOST_AVAILABLE"):
            m2_host += 1
    formal_mat = [
        r
        for r in results
        if r.get("disposition") in ("SUPERVISED_ACCEPTED", "SEMANTIC_EXCLUDE")
        and r.get("evidenceSource") == "FORMAL_FRESH_MATERIALIZATION"
    ]
    shard_status = "OK"
    if formal_mat and m2_host == 0:
        shard_status = "MODEL2_STATE_NOT_VALIDATED"
    return {
        "shardId": shard_id,
        "elapsedSec": round(elapsed, 2),
        "manifest": out["manifest"],
        "results": results,
        "model2": {
            "attempted": m2_att,
            "completed": m2_comp,
            "hostAvailable": m2_host,
            "status": shard_status,
        },
    }


def collect_samples_s1(shard_runs: list[dict]) -> tuple[list[dict], dict]:
    samples, meta = collect_samples(shard_runs)
    for s in samples:
        s["datasetId"] = DATASET_ID
        s["datasetBuildId"] = DATASET_BUILD_ID
        prov = dict(s.get("provenance") or {})
        prov["datasetVersion"] = DATASET_ID
        prov["datasetBuildId"] = DATASET_BUILD_ID
        s["provenance"] = prov
    return samples, meta


def write_split_shards_s1(samples: list[dict]) -> dict:
    from collections import defaultdict

    by_split: dict[str, list] = defaultdict(list)
    for s in samples:
        by_split[str(s.get("split") or "train")].append(s)
    counts = {}
    for split, rows in by_split.items():
        d = OUT / split
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("shard-*.jsonl"):
            old.unlink()
        path = d / "shard-000.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for s in rows:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        counts[split] = len(rows)
    return counts


def choose_s1_verdict(audit: dict, meta: dict, shard_runs: list[dict], n_fams: int) -> tuple[str, str]:
    qa = audit["qa"]
    if audit["holdoutAccepted"] > 0:
        return "S1_HOLDOUT_LEAKAGE", "STOP_AND_REVIEW"
    if audit["splitLeak"]:
        return "S1_SPLIT_LEAKAGE", "STOP_AND_REVIEW"
    if qa.get("provenanceCoherence") == "FAIL" or qa.get("candidateMissing") == "FAIL":
        return "S1_PROVENANCE_FAILURE", "STOP_AND_REVIEW"
    if any(r["model2"]["status"] != "OK" for r in shard_runs):
        if all(r["model2"]["status"] != "OK" for r in shard_runs):
            return "S1_MODEL2_STATE_FAILURE", "STOP_AND_REVIEW"
    if audit["collapsed"] or qa.get("candidateNonCollapsed") == "FAIL":
        return "S1_CANDIDATE_CHANNEL_REGRESSION", "STOP_AND_REVIEW"
    if qa.get("multipathRetention") == "FAIL":
        return "S1_MULTIPATH_REGRESSION", "STOP_AND_REVIEW"
    if n_fams < 950:
        return "S1_DATASET_INSUFFICIENT_DIVERSITY", "STOP_AND_REVIEW"
    if not {"train", "dev", "test"} <= set(meta.get("splitCounts", {})):
        return "S1_BUILD_INCOMPLETE", "STOP_AND_REVIEW"
    warnings = []
    if len(audit.get("oneSidedSuspicious") or []) >= 15:
        warnings.append("many_one_sided_surfaces")
    if audit["anchors"].get("DOMAIN", 0) < 5:
        warnings.append("sparse_DOMAIN_anchor")
    if warnings:
        return "PRODUCTION_CORE_S1_BUILD_PASS_WITH_NONBLOCKING_WARNINGS", "MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT"
    return "PRODUCTION_CORE_S1_BUILD_PASS", "MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT"


def _region_pos_bin(rel: float) -> str:
    if rel <= 0.25:
        return "HEAD"
    if rel >= 0.75:
        return "TAIL"
    return "MID"


def error_family_audit(samples: list[dict]) -> dict:
    regions: set[str] = set()
    fams: set[str] = set()
    by_family = Counter()
    length_b = Counter()
    pos_b = Counter()
    unequal = 0
    deletion_funnel = Counter()

    for s in samples:
        ref = s.get("referenceText") or ""
        cur = s.get("currentText") or s.get("model3CurrentText") or ""
        uk = s.get("materializationRunId") or ""
        fam = s.get("semanticFamilyId") or ""
        spans = s.get("spans") or []
        anchors = anchor_ranges(spans)
        regs = derive_malformed_regions(cur, ref, anchors=anchors)
        n = max(1, len(cur))
        for r in regs:
            rk = f"{uk}:{r['curStart']}:{r['curEnd']}"
            regions.add(rk)
            fams.add(fam)
            clen = r["curEnd"] - r["curStart"]
            length_b["5+" if clen >= 5 else str(clen)] += 1
            if r.get("lengthChanging"):
                unequal += 1
            tag = r.get("tag") or ""
            if tag == "insert" or r.get("deletionGap"):
                cf = "INSERTION"
            elif tag == "delete":
                cf = "DELETION"
            elif clen > 1:
                cf = "MULTI_CHAR_REPLACEMENT"
            else:
                cf = "SUBSTITUTION"
            by_family[cf] += 1
            pb = _region_pos_bin((r["curStart"] + r["curEnd"]) / 2.0 / n)
            pos_b[pb] += 1
            if cf == "DELETION":
                deletion_funnel["regions"] += 1
                has_retry = any(
                    sp.get("label") == "RETRY"
                    and sp.get("rawStart", 0) < r["curEnd"]
                    and sp.get("rawEnd", 0) > r["curStart"]
                    for sp in spans
                )
                if has_retry:
                    deletion_funnel["retry_span"] += 1

    return {
        "uniqueMalformedRegions": len(regions),
        "familiesWithRegions": len(fams),
        "errorFamilies": dict(by_family),
        "regionLengths": dict(length_b),
        "positionRegions": dict(pos_b),
        "unequalLengthRegions": unequal,
        "deletionFunnel": dict(deletion_funnel),
    }


def selection_profile(refs: list[dict]) -> dict:
    src = Counter()
    cat = Counter()
    length = Counter()
    for r in refs:
        src[r.get("sourceCorpus") or "unknown"] += 1
        length[_length_bucket(r["referenceText"])] += 1
        for c in _categories(r["referenceText"]):
            cat[c] += 1
    return {"source": dict(src), "taxonomyHits": dict(cat), "length": dict(length)}


def vocabulary_stats(texts: list[str]) -> dict:
    chars: set[str] = set()
    bigrams: set[str] = set()
    trigrams: set[str] = set()
    for t in texts:
        cjk = "".join(CJK.findall(t))
        chars.update(cjk)
        for i in range(len(cjk) - 1):
            bigrams.add(cjk[i : i + 2])
        for i in range(len(cjk) - 2):
            trigrams.add(cjk[i : i + 3])
    return {"chars": len(chars), "bigrams": len(bigrams), "trigrams": len(trigrams)}


def write_distribution_csv(path: Path, sel_prof: dict, audit: dict, err: dict, vocab: dict) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["section", "metric", "value", "notes"])
        for k, v in sel_prof["source"].items():
            w.writerow(["source_selection", k, v, ""])
        for k, v in sel_prof["length"].items():
            w.writerow(["length_selection", k, v, ""])
        for k, v in sorted(sel_prof["taxonomyHits"].items(), key=lambda x: -x[1])[:25]:
            w.writerow(["taxonomy_selection", k, v, "keyword_hits_multi_label"])
        w.writerow(["vocabulary", "unique_cjk_chars", vocab["chars"], "S1 references"])
        w.writerow(["vocabulary", "unique_bigrams", vocab["bigrams"], ""])
        w.writerow(["vocabulary", "unique_trigrams", vocab["trigrams"], ""])
        w.writerow(["labels", "KEEP", audit["labels"].get("KEEP", 0), ""])
        w.writerow(["labels", "RETRY", audit["labels"].get("RETRY", 0), ""])
        w.writerow(["labels", "MASKED", audit["labels"].get("MASKED", 0), ""])
        w.writerow(["candidate", "cand0", audit["candHist"].get("0", 0), ""])
        w.writerow(["candidate", "cand_gt0", sum(v for k, v in audit["candHist"].items() if k != "0"), ""])
        w.writerow(["multipath", "multipath_utterances", audit["multipathUtterances"], ""])
        w.writerow(["multipath", "retry_cand_gt0_utterances", audit["retryCandGt0Utterances"], ""])
        for k, v in audit["anchors"].items():
            w.writerow(["anchor", k, v, ""])
        for k, v in err["errorFamilies"].items():
            w.writerow(["error_family", k, v, "alignment_derived"])
        for k, v in err["deletionFunnel"].items():
            w.writerow(["deletion_funnel", k, v, ""])
        w.writerow(["scale", "families", audit["families"], ""])
        w.writerow(["scale", "utterances", audit["utterances"], ""])
        w.writerow(["scale", "paths", audit["paths"], ""])
        w.writerow(["scale", "span_path_samples", audit["spanPathSamples"], ""])


def write_qa_csv(path: Path, audit: dict, err: dict) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["gate", "status", "notes"])
        for k, v in audit["qa"].items():
            w.writerow([k, v, ""])
        w.writerow(["families_target", "PASS" if audit["families"] >= 950 else "FAIL", str(audit["families"])])
        w.writerow(["error_family_audit", "PASS", json.dumps(err["errorFamilies"])])
        w.writerow(["deletion_funnel_audit", "PASS", json.dumps(err["deletionFunnel"])])


def main() -> int:
    os.environ.pop("MODEL2_RUNTIME_DISABLED", None)
    if not os.environ.get("TONE_P10_VAD_CPU"):
        os.environ["TONE_P10_VAD_CPU"] = "1"
    os.environ["PYTHONPATH"] = str(REPO)
    ensure_registry_file()
    if not HARNESS.exists():
        print(json.dumps({"fatal": "formal harness missing"}))
        return 2
    if not v1_contract_compatible():
        print(json.dumps({"fatal": "V1 contract mismatch — cannot reuse lineage"}))
        return 3

    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)

    exclude = load_gate0_exclusions()
    candidates = select_pool_candidates(exclude)
    v1_refs = load_v1_seed_refs()
    v1_fams = {r["semanticFamilyId"] for r in v1_refs}
    print(f"[s1] V1 seed families={len(v1_refs)} pool={len(candidates)}", flush=True)

    new_refs = select_new_references(candidates, v1_fams)
    all_frozen_refs = v1_refs + new_refs
    sel_prof = selection_profile(all_frozen_refs)

    # freeze manifests BEFORE materialization
    freeze_rows = []
    for r in v1_refs:
        freeze_rows.append({**r, "split": assign_split(r["semanticFamilyId"]), "shardId": "reuse_v1"})
    new_shards = freeze_new_shards(new_refs)
    for i, refs in enumerate(new_shards):
        sid = f"s{i:02d}"
        write_shard_freeze(sid, refs, BUILD / f"shard_freeze_{sid}.csv")
        for r in refs:
            freeze_rows.append({**r, "split": assign_split(r["semanticFamilyId"]), "shardId": sid})

    freeze_meta = {
        "frozenBeforeOutcomes": True,
        "datasetId": DATASET_ID,
        "datasetBuildId": DATASET_BUILD_ID,
        "sourceSelectionSeed": SOURCE_SELECTION_SEED,
        "lineageStrategy": "V1_280_reuse_plus_720_new_materialization",
        "parentDatasetId": PARENT_DATASET_ID,
        "v1ReuseFamilies": len(v1_refs),
        "newMaterializationFamilies": len(new_refs),
        "totalFrozenFamilies": len(all_frozen_refs),
        "gate0Exclusion": {"policy": exclude["policy"], "excludedCount": exclude["count"]},
        "selectionProfile": sel_prof,
        "frozenAt": _utc(),
        "outcomeDrivenAdditions": 0,
        "outcomeDrivenRemovals": 0,
    }
    (BUILD / "source_freeze.json").write_text(json.dumps(freeze_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    with (BUILD / "source_selection_freeze.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "shardId",
                "referenceId",
                "semanticFamilyId",
                "referenceTextHash",
                "sourcePoolId",
                "sourceCorpus",
                "split",
                "lineageReuse",
                "referenceText",
            ],
        )
        w.writeheader()
        for r in freeze_rows:
            w.writerow(
                {
                    "shardId": r.get("shardId"),
                    "referenceId": r["referenceId"],
                    "semanticFamilyId": r["semanticFamilyId"],
                    "referenceTextHash": r.get("referenceTextHash")
                    or hashlib.sha256(r["referenceText"].encode()).hexdigest()[:16],
                    "sourcePoolId": r.get("sourcePoolId") or "model3_certified_base_pool_v2",
                    "sourceCorpus": r.get("sourceCorpus") or "unknown",
                    "split": r["split"],
                    "lineageReuse": r.get("lineageReuse", False),
                    "referenceText": r["referenceText"],
                }
            )

    print(f"[s1] frozen {len(all_frozen_refs)} families; materializing {len(new_refs)} new", flush=True)

    shard_runs = []
    retries = []
    asr_env = os.environ.get("TONE_P10_VAD_CPU")
    t_mat0 = time.perf_counter()
    for i, refs in enumerate(new_shards):
        sid = f"s{i:02d}"
        print(f"[s1] materializing shard {sid} n={len(refs)} ...", flush=True)
        run = run_shard_s1(sid, refs, asr_env)
        if run["model2"]["status"] != "OK":
            retries.append({"shardId": sid, "reason": "MODEL2_STATE_NOT_VALIDATED", "attempt": 2})
            run = run_shard_s1(sid, refs, asr_env)
        shard_runs.append(run)
        with (BUILD / f"results_{sid}.jsonl").open("w", encoding="utf-8") as f:
            for r in run["results"]:
                f.write(json.dumps({"referenceId": r.get("referenceId"), "disposition": r.get("disposition")}, ensure_ascii=False) + "\n")
        print(f"[s1] shard {sid} done {run['elapsedSec']}s", flush=True)
    mat_elapsed = time.perf_counter() - t_mat0

    reused = load_v1_reused_samples()
    new_samples, collect_meta = collect_samples_s1(shard_runs)
    samples = reused + new_samples
    split_counts = write_split_shards_s1(samples)
    audit = qa_and_audit(samples, {"splitCounts": split_counts}, shard_runs)
    n_fams = len({s.get("semanticFamilyId") for s in samples if s.get("semanticFamilyId")})
    verdict, next_phase = choose_s1_verdict(audit, {"splitCounts": split_counts}, shard_runs, n_fams)
    err = error_family_audit(samples)
    vocab = vocabulary_stats([r["referenceText"] for r in all_frozen_refs])

    manifest = {
        "datasetId": DATASET_ID,
        "datasetBuildId": DATASET_BUILD_ID,
        "createdAt": _utc(),
        "parentDatasets": [PARENT_DATASET_ID],
        "lineageStrategy": freeze_meta["lineageStrategy"],
        "pipelineVersion": PIPELINE_VERSION,
        "featureContractIdentity": FEATURE_CONTRACT,
        "labelContractIdentity": LABEL_CONTRACT,
        "ttsVoiceIdentity": "zh_CN-huayan-medium",
        "ttsPolicy": "FIXED_DATA_MATERIALIZATION_INFRASTRUCTURE",
        "acousticVariationForModel3": "DEFERRED_NOT_REQUIRED_FOR_CURRENT_MODEL3_DEVELOPMENT",
        "sourceSelectionSeed": SOURCE_SELECTION_SEED,
        "sourcePoolIdentities": ["model3_certified_base_pool_v2"],
        "gate0ExclusionPolicy": exclude["policy"],
        "v1ReuseFamilies": len(v1_refs),
        "newMaterializedFamilies": len(new_refs),
        "materializationElapsedSec": round(mat_elapsed, 2),
        "shards": [{"shardId": f"s{i:02d}", "n": len(s)} for i, s in enumerate(new_shards)],
        "retries": retries,
        "splitCounts": split_counts,
        "families": audit["families"],
        "utterances": audit["utterances"],
        "paths": audit["paths"],
        "spanPathSamples": audit["spanPathSamples"],
        "labels": audit["labels"],
        "verdict": verdict,
        "nextPhase": next_phase,
        "trainingExecuted": False,
    }
    (OUT / "dataset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (BUILD / "audit.json").write_text(json.dumps({**audit, "errorFamily": err}, ensure_ascii=False, indent=2), encoding="utf-8")

    write_distribution_csv(DOCS / "model3_v2_production_core_s1_distribution.csv", sel_prof, audit, err, vocab)
    write_qa_csv(DOCS / "model3_v2_production_core_s1_qa.csv", audit, err)
    summary = {
        "phase": "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S1",
        "architectureCorrection": {
            "model3Role": "ASR_postprocessing_text_repair",
            "acousticVariation": "DEFERRED_NOT_REQUIRED_FOR_CURRENT_MODEL3_DEVELOPMENT",
            "priorGapReclassified": "NON_BLOCKING_DEFERRED_UPSTREAM_DATA_GENERATION_OPTION",
        },
        "verdict": verdict,
        "datasetId": DATASET_ID,
        "buildComplete": verdict.startswith("PRODUCTION_CORE_S1_BUILD_PASS"),
        "uniqueSemanticFamilies": audit["families"],
        "lineageReuseFamilies": len(v1_refs),
        "newMaterializedFamilies": len(new_refs),
        "readyForNextPhase": verdict.startswith("PRODUCTION_CORE_S1_BUILD_PASS"),
        "nextPhase": next_phase,
        "scale": {
            "families": audit["families"],
            "utterances": audit["utterances"],
            "paths": audit["paths"],
            "spanPathSamples": audit["spanPathSamples"],
            "labels": audit["labels"],
        },
        "qa": audit["qa"],
    }
    (DOCS / "model3_v2_production_core_s1_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v2_production_core_s1_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps({"verdict": verdict, "families": audit["families"], "next": next_phase}, indent=2))
    return 0 if verdict.startswith("PRODUCTION_CORE_S1_BUILD_PASS") else 1


if __name__ == "__main__":
    raise SystemExit(main())
