# -*- coding: utf-8 -*-
"""READ-ONLY: MODEL3_V2_PRODUCTION_DATASET_COVERAGE_SCALE_AUDIT."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
DATASET = REPO / "training/model3_dataset/model3_v2_targeted_dist_corrected_v1"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
CJK = re.compile(r"[\u4e00-\u9fff]")
DIGIT = re.compile(r"\d")
QUESTION = re.compile(r"[？?]|吗|么|呢|是不是|能不能|可不可以|有没有")

import sys

sys.path.insert(0, str(REPO))
from training.model3_dataset.acoustic_training.family_identity import (  # noqa: E402
    assign_split,
    semantic_family_id,
)
from training.model3_dataset.acoustic_training.holdout_registry import (  # noqa: E402
    PROTECTED_CASE_IDS,
    check_holdout,
    load_protected_texts,
)
from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    anchor_ranges,
    derive_malformed_regions,
)

# Conversation taxonomy keywords (diagnostic framework, not business domains)
CONV_TAXONOMY = {
    "daily_request": ("请", "帮", "麻烦", "能不能", "可不可以", "需要"),
    "question": ("什么", "哪里", "怎么", "为什么", "多少", "几", "吗", "呢", "?"),
    "confirmation": ("确认", "是不是", "对吗", "没错", "核实", "核对"),
    "negation": ("不", "没", "别", "未", "无", "不要"),
    "correction_clarify": ("更正", "纠正", "澄清", "说明", "解释", "重新"),
    "casual": ("今天", "明天", "刚才", "现在", "一下", "看看"),
    "shopping_food": ("买", "点", "餐", "饭", "菜", "店", "外卖", "糖", "杯"),
    "transport": ("路", "车", "站", "导航", "到达", "出发", "掉头", "停车"),
    "workplace": ("会议", "项目", "同事", "客户", "报告", "流程", "上线"),
    "scheduling": ("预约", "时间", "几点", "日程", "安排", "改期"),
    "travel_hotel": ("酒店", "入住", "退房", "航班", "行李", "旅行", "景点"),
    "customer_service": ("客服", "订单", "退款", "发票", "投诉", "售后"),
    "tech_device": ("设备", "系统", "网络", "软件", "更新", "缓存", "登录"),
    "family_social": ("家人", "朋友", "孩子", "父母", "一起"),
    "weather_plans": ("天气", "下雨", "温度", "计划", "活动"),
    "numbers_quantities": ("数量", "份", "个", "几", "多少", "第一", "第二"),
    "time_dates": ("点", "分", "号", "日", "月", "年", "周", "上午", "下午"),
    "names_places": ("公司", "医院", "学校", "中心", "市", "区", "路"),
}


def classify_region_family(region: dict, current: str, reference: str) -> str:
    tag = region.get("tag") or ""
    if region.get("deletionGap") or tag == "insert":
        return "INSERTION"
    if tag == "delete":
        return "DELETION"
    cur_len = region["curEnd"] - region["curStart"]
    ref_s = region.get("refStart")
    ref_e = region.get("refEnd")
    ref_len = (ref_e - ref_s) if isinstance(ref_s, int) and isinstance(ref_e, int) else None
    if cur_len > 1 or (ref_len is not None and ref_len > 1):
        if region.get("lengthChanging"):
            if ref_len is not None and cur_len != ref_len:
                if cur_len > (ref_len or 0):
                    return "INSERTION"  # net insert in replace context
                return "DELETION"
            return "MULTI_CHAR_REPLACEMENT"
        return "MULTI_CHAR_REPLACEMENT"
    return "SUBSTITUTION"


def phonetic_like(region: dict, current: str, reference: str) -> str | None:
    """Diagnostic only — simple same-length single-char heuristic."""
    s, e = region["curStart"], region["curEnd"]
    rs, re_ = region.get("refStart"), region.get("refEnd")
    if not isinstance(rs, int) or not isinstance(re_, int):
        return None
    cur = current[s:e]
    ref = reference[rs:re_]
    if len(cur) == 1 and len(ref) == 1 and cur != ref:
        return "PHONETIC_LIKE"
    if len(cur) == len(ref) and cur != ref:
        return "PHONETIC_LIKE"
    return "NON_PHONETIC"


def pos_bin(rel: float) -> str:
    if rel <= 0.25:
        return "HEAD"
    if rel >= 0.75:
        return "TAIL"
    return "MID"


def region_key(utt_key: str, r: dict) -> str:
    return f"{utt_key}:{r['curStart']}:{r['curEnd']}"


def load_samples() -> list[dict]:
    out = []
    for split in ("train", "dev", "test"):
        p = DATASET / split / "shard-000.jsonl"
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    s = json.loads(line)
                    s["_split"] = split
                    out.append(s)
    return out


def utterance_key(s: dict) -> str:
    return s.get("materializationRunId") or s.get("sampleId", "")


def audit_dataset(samples: list[dict]) -> dict:
    # utterance-level dedup (one row per materialization run)
    utt_map: dict[str, dict] = {}
    for s in samples:
        uk = utterance_key(s)
        if uk not in utt_map:
            utt_map[uk] = s

    retry_span_rows = 0
    keep_span_rows = 0
    region_retry_spans: set[str] = set()
    region_keys: set[str] = set()
    region_by_family: dict[str, set] = defaultdict(set)
    region_by_utt: dict[str, set] = defaultdict(set)
    fam_with_region: set[str] = set()
    utt_with_region: set[str] = set()

    family_tax: Counter[str] = Counter()
    corruption_family: Counter[str] = Counter()
    corruption_fam_families: dict[str, set] = defaultdict(set)
    corruption_fam_utts: dict[str, set] = defaultdict(set)
    corruption_fam_regions: dict[str, set] = defaultdict(set)
    retry_span_by_corruption: Counter[str] = Counter()

    length_buckets = Counter()
    length_families: dict[str, set] = defaultdict(set)
    unequal_len_regions: set[str] = set()
    unequal_families: set[str] = set()

    pos_region: dict[str, set] = defaultdict(set)
    pos_utt: dict[str, set] = defaultdict(set)
    retry_pos_utt: dict[str, set] = defaultdict(set)

    anchor_ctx = Counter()
    conv_current: dict[str, set] = defaultdict(set)
    conv_families: dict[str, set] = defaultdict(set)

    chars = Counter()
    bigrams = Counter()
    surfaces_retry = Counter()
    surfaces_keep = Counter()
    surface_fam: dict[str, set] = defaultdict(set)

    for uk, s in utt_map.items():
        ref = s.get("referenceText") or ""
        cur = s.get("currentText") or s.get("model3CurrentText") or ""
        fam = s.get("semanticFamilyId") or ""
        anchors = anchor_ranges(s.get("spans") or [])
        regions = derive_malformed_regions(cur, ref, anchors=anchors)
        n = max(1, len(cur))
        for ch in CJK.findall(ref):
            chars[ch] += 1
        for i in range(len(ref) - 1):
            bigrams[ref[i : i + 2]] += 1
        for cat, kws in CONV_TAXONOMY.items():
            if any(k in ref for k in kws):
                conv_current[cat].add(uk)
                conv_families[cat].add(fam)

        for r in regions:
            rk = region_key(uk, r)
            region_keys.add(rk)
            region_by_utt[uk].add(rk)
            region_by_family[fam].add(rk)
            fam_with_region.add(fam)
            utt_with_region.add(uk)
            cf = classify_region_family(r, cur, ref)
            corruption_family[cf] += 1
            corruption_fam_regions[cf].add(rk)
            corruption_fam_families[cf].add(fam)
            corruption_fam_utts[cf].add(uk)
            clen = r["curEnd"] - r["curStart"]
            lb = "5+" if clen >= 5 else str(clen)
            length_buckets[lb] += 1
            length_families[lb].add(fam)
            if r.get("lengthChanging"):
                unequal_len_regions.add(rk)
                unequal_families.add(fam)
            mid = (r["curStart"] + r["curEnd"]) / 2.0
            pb = pos_bin(mid / n)
            pos_region[pb].add(rk)
            pos_utt[pb].add(uk)

    # span×path level from all samples
    path_count = len(samples)
    retry_utt_cand_gt0: set[str] = set()
    multipath_utt: set[str] = set()
    anchor_hist = Counter()
    context_stats = Counter()

    for s in samples:
        uk = utterance_key(s)
        cur = s.get("currentText") or ""
        n = max(1, len(cur))
        fam = s.get("semanticFamilyId") or ""
        spans = s.get("spans") or []
        has_anchor = any(sp.get("isAnchor") for sp in spans)
        has_retry = False
        has_keep = False
        for sp in spans:
            lab = sp.get("label")
            if lab == "RETRY":
                retry_span_rows += 1
                has_retry = True
                surf = sp.get("surface") or ""
                surfaces_retry[surf] += 1
                surface_fam[surf].add(fam)
                rs = sp.get("rawStart", 0)
                re_ = sp.get("rawEnd", rs + 1)
                pb = pos_bin(((rs + re_) / 2.0) / n)
                retry_pos_utt[pb].add(uk)
                cand = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount")
                if cand is None:
                    cand = (sp.get("packedInferFields") or {}).get("firstPassCandidateCount")
                if cand and int(cand) > 0:
                    retry_utt_cand_gt0.add(uk)
                # map span to nearest region
                for r in derive_malformed_regions(
                    cur, s.get("referenceText") or "", anchors=anchor_ranges(spans)
                ):
                    if sp.get("rawStart", 0) < r["curEnd"] and sp.get("rawEnd", 0) > r["curStart"]:
                        cf = classify_region_family(r, cur, s.get("referenceText") or "")
                        rk = region_key(uk, r)
                        region_retry_spans.add(f"{rk}:{s.get('pathId')}")
                        retry_span_by_corruption[cf] += 1
                        break
                anc = sp.get("anchorSource") or "NONE"
                if has_anchor:
                    context_stats[f"retry_near_anchor_{anc}"] += 1
                else:
                    context_stats["retry_no_anchor"] += 1
            elif lab == "KEEP":
                keep_span_rows += 1
                surfaces_keep[sp.get("surface") or ""] += 1
            src = sp.get("anchorSource") or "NONE"
            if sp.get("isAnchor"):
                anchor_hist[src] += 1
        if has_retry and has_keep:
            context_stats["valid_malformed_valid"] += 1
        if has_retry:
            context_stats["utterance_with_retry"] += 1

    # multipath: count paths per utterance
    paths_per_utt: Counter[str] = Counter()
    for s in samples:
        paths_per_utt[utterance_key(s)] += 1
    for uk, c in paths_per_utt.items():
        if c > 1:
            multipath_utt.add(uk)

    # surface shortcut analysis
    shortcut_rows = []
    for surf, rc in surfaces_retry.items():
        kc = surfaces_keep.get(surf, 0)
        sup = kc + rc
        if sup < 20:
            continue
        fams = len(surface_fam[surf])
        ent = 0.0
        if sup > 0:
            p_k = kc / sup
            p_r = rc / sup
            ent = -(p_k * math.log(p_k + 1e-12) + p_r * math.log(p_r + 1e-12))
        shortcut_rows.append(
            {
                "surface": surf,
                "KEEP": kc,
                "RETRY": rc,
                "support": sup,
                "families": fams,
                "label_entropy": round(ent, 4),
                "one_sided": kc == 0 or rc == 0,
            }
        )
    shortcut_rows.sort(key=lambda x: -x["support"])

    return {
        "utterances": len(utt_map),
        "families": len({s.get("semanticFamilyId") for s in utt_map.values()}),
        "path_samples": path_count,
        "span_retry_rows": retry_span_rows,
        "span_keep_rows": keep_span_rows,
        "unique_malformed_regions": len(region_keys),
        "families_with_malformed_region": len(fam_with_region),
        "utterances_with_malformed_region": len(utt_with_region),
        "region_retry_span_path_rows": len(region_retry_spans),
        "corruption_family_regions": {k: len(v) for k, v in corruption_fam_regions.items()},
        "corruption_family_families": {k: len(v) for k, v in corruption_fam_families.items()},
        "corruption_family_utts": {k: len(v) for k, v in corruption_fam_utts.items()},
        "retry_span_by_corruption": dict(retry_span_by_corruption),
        "length_buckets": dict(length_buckets),
        "length_families": {k: len(v) for k, v in length_families.items()},
        "unequal_len_regions": len(unequal_len_regions),
        "unequal_len_families": len(unequal_families),
        "pos_region": {k: len(v) for k, v in pos_region.items()},
        "pos_utt": {k: len(v) for k, v in pos_utt.items()},
        "retry_pos_utt": {k: len(v) for k, v in retry_pos_utt.items()},
        "conv_current_utts": {k: len(v) for k, v in conv_current.items()},
        "conv_families": {k: len(v) for k, v in conv_families.items()},
        "unique_chars_ref": len(chars),
        "unique_bigrams_ref": len(bigrams),
        "retry_utt_cand_gt0": len(retry_utt_cand_gt0),
        "multipath_utt": len(multipath_utt),
        "anchor_hist": dict(anchor_hist),
        "context_stats": dict(context_stats),
        "shortcut_rows": shortcut_rows,
        "paths_per_utt": dict(Counter(paths_per_utt.values())),
    }


def audit_source_pool(exclude_gate0: bool = True) -> dict:
    gate0_ids = set()
    gate0_fams = set()
    if exclude_gate0 and (DOCS / "model3_v2_gate0_source_batch_manifest.csv").exists():
        with (DOCS / "model3_v2_gate0_source_batch_manifest.csv").open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                gate0_ids.add(row["referenceId"])
                gate0_fams.add(row["semanticFamilyId"])

    prot = load_protected_texts()
    rng_fams: set[str] = set()
    texts: set[str] = set()
    src_counter = Counter()
    len_hist = Counter()
    usable = 0
    protected = 0
    gate0_excl = 0
    cjk_total = 0
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = (o.get("normalized") or o.get("text") or "").strip()
            if not t:
                continue
            src = o.get("source") or "unknown"
            src_counter[src] += 1
            rid = str(o.get("id") or hashlib.md5(t.encode()).hexdigest()[:12])
            fam = semantic_family_id(rid, t)
            cjk = len(CJK.findall(t))
            if cjk < 10 or cjk > 36 or len(t) > 48:
                continue
            if t.startswith("一般对话里常说") and cjk < 14:
                continue
            if "dialog_200" in src.lower() or "dialog200" in src.lower():
                continue
            if rid in PROTECTED_CASE_IDS or t in prot or check_holdout(reference_id=rid, reference_text=t):
                protected += 1
                continue
            if rid in gate0_ids or fam in gate0_fams:
                gate0_excl += 1
                continue
            if t in texts:
                continue
            texts.add(t)
            rng_fams.add(fam)
            usable += 1
            lb = "short" if cjk < 14 else ("medium" if cjk < 22 else "long")
            len_hist[lb] += 1
            cjk_total += cjk

    return {
        "pool_total_lines": sum(1 for _ in POOL.open(encoding="utf-8")),
        "usable_unique_families_after_filters": len(rng_fams),
        "usable_unique_texts": usable,
        "protected_skipped": protected,
        "gate0_excluded": gate0_excl,
        "source_distribution": dict(src_counter.most_common(10)),
        "length_distribution": dict(len_hist),
        "avg_cjk_usable": round(cjk_total / usable, 2) if usable else 0,
    }


def cost_scenarios() -> list[dict]:
    # Observed: 280 utt in 1223s (~4.4s/utt end-to-end); gate0 48 in 231s (~4.8s)
    sec_per_utt = 4.4
    rows = []
    for n in (280, 1000, 5000, 10000, 25000, 50000, 100000):
        wall_h = n * sec_per_utt / 3600.0
        # span samples scale ~52 per utt from gate0/dataset observation
        span_est = int(n * 52.2)
        rows.append(
            {
                "utterances": n,
                "semantic_families_est": n,
                "span_path_samples_est": span_est,
                "wall_hours_est": round(wall_h, 1),
                "wall_days_1pc": round(wall_h / 24, 2),
                "wall_days_4pc_parallel": round(wall_h / 24 / 4, 2),
            }
        )
    return rows


def main() -> int:
    samples = load_samples()
    ds = audit_dataset(samples)
    pool = audit_source_pool()
    costs = cost_scenarios()

    # Write CSV artifacts
    DOCS.mkdir(parents=True, exist_ok=True)

    with (DOCS / "model3_v2_real_error_family_coverage.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "family",
                "unique_families",
                "unique_utterances",
                "unique_malformed_regions",
                "span_path_RETRY_rows",
                "assessment",
            ]
        )
        assessments = {
            "SUBSTITUTION": "well_represented",
            "MULTI_CHAR_REPLACEMENT": "partially_represented" if ds["corruption_family_regions"].get("MULTI_CHAR_REPLACEMENT", 0) < 50 else "well_represented",
            "INSERTION": "sparse" if ds["corruption_family_regions"].get("INSERTION", 0) < 20 else "partially_represented",
            "DELETION": "sparse" if ds["corruption_family_regions"].get("DELETION", 0) < 20 else "partially_represented",
        }
        for fam in ("SUBSTITUTION", "MULTI_CHAR_REPLACEMENT", "INSERTION", "DELETION"):
            w.writerow(
                [
                    fam,
                    ds["corruption_family_families"].get(fam, 0),
                    ds["corruption_family_utts"].get(fam, 0),
                    ds["corruption_family_regions"].get(fam, 0),
                    ds["retry_span_by_corruption"].get(fam, 0),
                    assessments.get(fam, "unknown"),
                ]
            )

    with (DOCS / "model3_v2_daily_conversation_coverage.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["category", "pool_families_est", "current_dataset_families", "current_utterances", "assessment"])
        for cat in CONV_TAXONOMY:
            cf = ds["conv_families"].get(cat, 0)
            cu = ds["conv_current_utts"].get(cat, 0)
            assess = "good" if cf >= 40 else ("partial" if cf >= 15 else "sparse")
            w.writerow([cat, "n/a", cf, cu, assess])

    with (DOCS / "model3_v2_source_pool_capacity.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["metric", "value"])
        for k, v in pool.items():
            w.writerow([k, v if not isinstance(v, dict) else json.dumps(v, ensure_ascii=False)])

    with (DOCS / "model3_v2_surface_shortcut_risk.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["surface", "KEEP", "RETRY", "support", "families", "label_entropy", "one_sided", "risk_note"],
        )
        w.writeheader()
        for row in ds["shortcut_rows"][:60]:
            note = "potential_shortcut" if row["one_sided"] and row["support"] >= 40 else (
                "low_entropy_contrast" if row["label_entropy"] < 0.15 and row["support"] >= 40 else "ok"
            )
            w.writerow({**row, "risk_note": note})

    with (DOCS / "model3_v2_scale_cost_options.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "stage",
                "unique_utterances",
                "span_path_samples_est",
                "wall_hours_est",
                "wall_days_1pc",
                "wall_days_4pc_parallel",
                "purpose",
            ],
        )
        w.writeheader()
        purposes = {
            280: "S0_pipeline_proof_current",
            1000: "S1_training_feasibility",
            5000: "S2_broad_conversation_core",
            10000: "S2b_conversation_expansion",
            25000: "S3_production_oriented",
            50000: "S3b_production_oriented",
            100000: "S4_long_tail",
        }
        for row in costs:
            w.writerow(
                {
                    "stage": purposes.get(row["utterances"], "expansion"),
                    "unique_utterances": row["utterances"],
                    "span_path_samples_est": row["span_path_samples_est"],
                    "wall_hours_est": row["wall_hours_est"],
                    "wall_days_1pc": row["wall_days_1pc"],
                    "wall_days_4pc_parallel": row["wall_days_4pc_parallel"],
                    "purpose": purposes.get(row["utterances"], ""),
                }
            )

    with (DOCS / "model3_v2_vocabulary_linguistic_coverage.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["metric", "current_dataset", "notes"])
        w.writerow(["unique_semantic_families", ds["families"], "primary diversity unit"])
        w.writerow(["unique_utterances", ds["utterances"], ""])
        w.writerow(["unique_chars_in_reference", ds["unique_chars_ref"], ""])
        w.writerow(["unique_bigrams_in_reference", ds["unique_bigrams_ref"], ""])
        w.writerow(["unique_malformed_regions", ds["unique_malformed_regions"], "independent errors"])
        w.writerow(["unequal_length_regions", ds["unequal_len_regions"], ""])
        w.writerow(["multipath_utterances", ds["multipath_utt"], ""])

    old_datasets = [
        ("MODEL3_V2_TARGETED_DIST_CORRECTED_V1", "SAFE_FOR_FORMAL_TRAINING", "current formal B2 baseline"),
        ("MODEL3_V2_REALDIST_EXPANDED_V1", "SAFE_ONLY_FOR_PRETRAIN_OR_AB_INITIO_COMPARE", "synthetic cand collapse risk; useful init compare only"),
        ("MODEL3_V2_LABELED", "DIAGNOSTIC_ONLY", "text-only relabel of V1; no acoustic provenance"),
        ("MODEL3_V1_SYNTHETIC_100K", "REJECT_FOR_FORMAL_TRAINING", "planned corruption / non-B2"),
    ]
    with (DOCS / "model3_v2_old_dataset_reuse_matrix.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["dataset", "classification", "reason"])
        for row in old_datasets:
            w.writerow(row)

    summary = {
        "phase": "MODEL3_V2_PRODUCTION_DATASET_COVERAGE_SCALE_AUDIT",
        "auditVerdict": "CURRENT_DATASET_VALID_BUT_PRODUCTION_SCALE_EXPANSION_REQUIRED",
        "currentDatasetValid": True,
        "sufficientForBoundedExperiment": True,
        "sufficientForProductionTraining": False,
        "expansionRequired": True,
        "architectureChangeRequired": False,
        "datasetId": "MODEL3_V2_TARGETED_DIST_CORRECTED_V1",
        "primaryScaleUnit": "unique_semantic_families",
        "current": {
            "families": ds["families"],
            "utterances": ds["utterances"],
            "pathSamples": ds["path_samples"],
            "spanPathSamples": sum(len(s.get("spans") or []) for s in samples),
            "uniqueMalformedRegions": ds["unique_malformed_regions"],
            "spanRetryRows": ds["span_retry_rows"],
        },
        "errorFamilies": ds["corruption_family_regions"],
        "unequalLengthRegions": ds["unequal_len_regions"],
        "sourcePoolUsableFamilies": pool["usable_unique_families_after_filters"],
        "recommendedScaleRangeFamilies": "5000-25000",
        "recommendedTrainingStrategy": "controlled_A_B_random_init_vs_RealDist_on_same_formal_split",
        "nextPhase": "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_DESIGN",
        "multiPcFeasible": True,
    }
    (DOCS / "model3_v2_production_dataset_audit_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    out = {"dataset": ds, "pool": pool, "summary": summary}
    (DOCS / "_audit_scratch_production_dataset.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
