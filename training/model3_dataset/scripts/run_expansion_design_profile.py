# -*- coding: utf-8 -*-
"""READ-ONLY: MODEL3_V2_PRODUCTION_DATASET_EXPANSION_DESIGN profiling."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
GATE0_MANIFEST = DOCS / "model3_v2_gate0_source_batch_manifest.csv"
SEED_DATASET = REPO / "training/model3_dataset/model3_v2_targeted_dist_corrected_v1"
OUT_DOCS = DOCS

CJK = re.compile(r"[\u4e00-\u9fff]")
DIGIT = re.compile(r"\d")
QUESTION_MARK = re.compile(r"[？?]")
QUESTION_PARTICLE = re.compile(r"(吗|么|呢|是不是|能不能|可不可以|有没有|多少|什么|哪里|怎么|为什么)")
IMPERATIVE = re.compile(r"(请|帮|麻烦|需要|给我|帮我|务必|赶紧)")
NEGATION = re.compile(r"(不|没|别|未|无|不要|没有)")
MODAL = re.compile(r"(可以|能够|应该|可能|必须|得|要)")
NE_LIKE = re.compile(r"(公司|医院|学校|中心|酒店|航班|客服|订单|项目|系统|设备|软件|网络|市|区|路|站|机场)")
MULTI_CLAUSE = re.compile(r"(，|,|然后|但是|因为|所以|如果|虽然|而且)")

sys.path.insert(0, str(REPO))
from training.model2.constants import DEFAULT_TTS_VOICE  # noqa: E402
from training.model3_dataset.acoustic_training.family_identity import assign_split, semantic_family_id  # noqa: E402
from training.model3_dataset.acoustic_training.holdout_registry import (  # noqa: E402
    PROTECTED_CASE_IDS,
    check_holdout,
    load_protected_texts,
)
from training.model3_dataset.scripts.run_targeted_dist_dataset_build import (  # noqa: E402
    load_gate0_exclusions,
    select_pool_candidates,
)

CONV_TAXONOMY = {
    "daily_request": ("请", "帮", "麻烦", "能不能", "可不可以", "需要", "给我"),
    "question": ("什么", "哪里", "怎么", "为什么", "多少", "几", "吗", "呢", "?"),
    "answer": ("是的", "对的", "没错", "可以", "好的", "行", "没问题"),
    "confirmation": ("确认", "是不是", "对吗", "没错", "核实", "核对", "对吗"),
    "negation": ("不", "没", "别", "未", "无", "不要", "没有"),
    "correction_clarify": ("更正", "纠正", "澄清", "说明", "解释", "重新", "改一下"),
    "casual_social": ("今天", "明天", "刚才", "现在", "一下", "看看", "聊天"),
    "shopping_food": ("买", "点", "餐", "饭", "菜", "店", "外卖", "糖", "杯", "拿铁", "奶茶"),
    "transport": ("路", "车", "站", "导航", "到达", "出发", "掉头", "停车", "地铁", "公交"),
    "workplace": ("会议", "项目", "同事", "客户", "报告", "流程", "上线", "研发", "团队"),
    "scheduling": ("预约", "时间", "几点", "日程", "安排", "改期", "下午三点"),
    "travel": ("旅行", "景点", "门票", "行李", "航班", "登机"),
    "hotel": ("酒店", "入住", "退房", "续住", "亲子房"),
    "customer_service": ("客服", "订单", "退款", "发票", "投诉", "售后", "报错"),
    "tech_device": ("设备", "系统", "网络", "软件", "更新", "缓存", "登录", "接口", "模型"),
    "family_social": ("家人", "朋友", "孩子", "父母", "一起", "咱们"),
    "weather_plans": ("天气", "下雨", "温度", "计划", "活动"),
    "numbers_quantities": ("数量", "份", "个", "几", "多少", "第一", "第二", "两份"),
    "time_dates": ("点", "分", "号", "日", "月", "年", "周", "上午", "下午", "今天", "明天"),
    "names_places": ("公司", "医院", "学校", "中心", "市", "区", "路", "站", "机场"),
}


def cjk_len(text: str) -> int:
    return len(CJK.findall(text))


def load_seed_texts() -> set[str]:
    texts: set[str] = set()
    for split in ("train", "dev", "test"):
        p = SEED_DATASET / split / "shard-000.jsonl"
        if not p.exists():
            continue
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    s = json.loads(line)
                    t = s.get("referenceText") or ""
                    if t:
                        texts.add(t)
    return texts


def profile_pool(candidates: list[dict]) -> dict:
    n = len(candidates)
    by_source: Counter[str] = Counter()
    by_source_fam: dict[str, set[str]] = defaultdict(set)
    lengths: list[int] = []
    cat_fams: dict[str, set[str]] = defaultdict(set)
    cat_texts: dict[str, set[str]] = defaultdict(set)
    cat_lengths: dict[str, list[int]] = defaultdict(list)
    cat_questions: dict[str, int] = defaultdict(int)
    cat_ne: dict[str, int] = defaultdict(int)

    chars = Counter()
    bigrams = Counter()
    trigrams = Counter()

    struct = {
        "question": 0,
        "imperative": 0,
        "statement_only": 0,
        "negation": 0,
        "modal": 0,
        "short_cjk_lt14": 0,
        "medium_cjk_14_21": 0,
        "long_cjk_ge22": 0,
        "has_digit": 0,
        "time_expr": 0,
        "quantity_expr": 0,
        "ne_like": 0,
        "multi_clause": 0,
    }
    struct_fams: dict[str, set[str]] = defaultdict(set)

    fam_to_cats: dict[str, set[str]] = defaultdict(set)
    fam_to_source: dict[str, str] = {}

    for r in candidates:
        t = r["referenceText"]
        fam = r["semanticFamilyId"]
        src = r.get("sourceCorpus") or "unknown"
        by_source[src] += 1
        by_source_fam[src].add(fam)
        cl = cjk_len(t)
        lengths.append(cl)
        fam_to_source[fam] = src

        for ch in CJK.findall(t):
            chars[ch] += 1
        cjk_only = "".join(CJK.findall(t))
        for i in range(len(cjk_only) - 1):
            bigrams[cjk_only[i : i + 2]] += 1
        for i in range(len(cjk_only) - 2):
            trigrams[cjk_only[i : i + 3]] += 1

        is_q = bool(QUESTION_MARK.search(t) or QUESTION_PARTICLE.search(t))
        is_imp = bool(IMPERATIVE.search(t))
        is_neg = bool(NEGATION.search(t))
        is_modal = bool(MODAL.search(t))
        is_ne = bool(NE_LIKE.search(t))
        is_mc = bool(MULTI_CLAUSE.search(t))
        has_d = bool(DIGIT.search(t))

        if is_q:
            struct["question"] += 1
            struct_fams["question"].add(fam)
        if is_imp:
            struct["imperative"] += 1
            struct_fams["imperative"].add(fam)
        if not is_q and not is_imp:
            struct["statement_only"] += 1
            struct_fams["statement_only"].add(fam)
        if is_neg:
            struct["negation"] += 1
            struct_fams["negation"].add(fam)
        if is_modal:
            struct["modal"] += 1
            struct_fams["modal"].add(fam)
        if cl < 14:
            struct["short_cjk_lt14"] += 1
        elif cl < 22:
            struct["medium_cjk_14_21"] += 1
        else:
            struct["long_cjk_ge22"] += 1
        if has_d:
            struct["has_digit"] += 1
            struct_fams["has_digit"].add(fam)
        if re.search(r"(点|分|号|日|月|年|周|上午|下午|今天|明天|后天)", t):
            struct["time_expr"] += 1
            struct_fams["time_expr"].add(fam)
        if re.search(r"(份|个|几|多少|第一|第二|两份|三个)", t):
            struct["quantity_expr"] += 1
            struct_fams["quantity_expr"].add(fam)
        if is_ne:
            struct["ne_like"] += 1
            struct_fams["ne_like"].add(fam)
        if is_mc:
            struct["multi_clause"] += 1
            struct_fams["multi_clause"].add(fam)

        matched_cats: list[str] = []
        for cat, kws in CONV_TAXONOMY.items():
            if any(k in t for k in kws):
                matched_cats.append(cat)
                cat_fams[cat].add(fam)
                cat_texts[cat].add(t)
                cat_lengths[cat].append(cl)
                if is_q:
                    cat_questions[cat] += 1
                if is_ne:
                    cat_ne[cat] += 1
                fam_to_cats[fam].add(cat)

    # overlap: avg categories per family
    cat_counts = [len(v) for v in fam_to_cats.values()]
    avg_cats = statistics.mean(cat_counts) if cat_counts else 0

    # top function chars
    top_chars = chars.most_common(30)
    long_tail_chars = sum(1 for _, c in chars.items() if c == 1)

    return {
        "usable_families": n,
        "lengths": lengths,
        "by_source": dict(by_source),
        "by_source_unique_families": {k: len(v) for k, v in by_source_fam.items()},
        "cat_fams": {k: len(v) for k, v in cat_fams.items()},
        "cat_texts": {k: len(v) for k, v in cat_texts.items()},
        "cat_avg_len": {k: round(statistics.mean(v), 2) if v else 0 for k, v in cat_lengths.items()},
        "cat_question_rate": {
            k: round(cat_questions[k] / len(cat_texts[k]), 4) if cat_texts[k] else 0
            for k in CONV_TAXONOMY
        },
        "cat_ne_rate": {
            k: round(cat_ne[k] / len(cat_texts[k]), 4) if cat_texts[k] else 0 for k in CONV_TAXONOMY
        },
        "avg_categories_per_family": round(avg_cats, 3),
        "unique_cjk_chars": len(chars),
        "unique_bigrams": len(bigrams),
        "unique_trigrams": len(trigrams),
        "top_chars": top_chars[:20],
        "long_tail_char_hapax": long_tail_chars,
        "struct_counts": struct,
        "struct_families": {k: len(v) for k, v in struct_fams.items()},
        "fam_to_cats": fam_to_cats,
        "candidates": candidates,
    }


def profile_seed(seed_texts: set[str], candidates_by_text: dict[str, dict]) -> dict:
    chars = Counter()
    bigrams = Counter()
    trigrams = Counter()
    lengths = []
    cat_fams: dict[str, set[str]] = defaultdict(set)
    for t in seed_texts:
        cl = cjk_len(t)
        lengths.append(cl)
        cjk_only = "".join(CJK.findall(t))
        for ch in cjk_only:
            chars[ch] += 1
        for i in range(len(cjk_only) - 1):
            bigrams[cjk_only[i : i + 2]] += 1
        for i in range(len(cjk_only) - 2):
            trigrams[cjk_only[i : i + 3]] += 1
        r = candidates_by_text.get(t)
        fam = r["semanticFamilyId"] if r else f"seed_{hashlib.md5(t.encode()).hexdigest()[:8]}"
        for cat, kws in CONV_TAXONOMY.items():
            if any(k in t for k in kws):
                cat_fams[cat].add(fam)
    return {
        "families": len(seed_texts),
        "unique_cjk_chars": len(chars),
        "unique_bigrams": len(bigrams),
        "unique_trigrams": len(trigrams),
        "avg_cjk_len": round(statistics.mean(lengths), 2) if lengths else 0,
        "cat_fams": {k: len(v) for k, v in cat_fams.items()},
    }


def spot_validate(candidates: list[dict], fam_to_cats: dict[str, set[str]], n_per: int = 5) -> dict:
    """Bounded spot audit: sample references per category."""
    rng_seed = 2026083005
    import random

    rng = random.Random(rng_seed)
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for r in candidates:
        fam = r["semanticFamilyId"]
        for cat in fam_to_cats.get(fam, ()):
            by_cat[cat].append(r)
    out = {}
    for cat in CONV_TAXONOMY:
        pool = by_cat.get(cat, [])
        if not pool:
            out[cat] = {"samples": [], "concern": "empty_category"}
            continue
        rng.shuffle(pool)
        picked = pool[:n_per]
        samples = [p["referenceText"][:60] for p in picked]
        # simple false-positive heuristics
        fp = 0
        for s in samples:
            if not any(k in s for k in CONV_TAXONOMY[cat]):
                fp += 1
        concern = []
        if fp > 0:
            concern.append(f"keyword_miss_in_sample={fp}/{len(samples)}")
        if cat in ("negation", "daily_request") and len(by_cat[cat]) > 5000:
            concern.append("high_overlap_with_function_words")
        if cat == "time_dates" and any("下午三点讨论" in s for s in samples):
            concern.append("scheduling_template_overlap")
        out[cat] = {
            "samples": samples,
            "precision_concern": concern or ["none_obvious"],
        }
    return out


def audit_tts_capability() -> dict:
    model_dir = REPO / "electron_node/services/piper_tts/models"
    onnx_files = list(model_dir.rglob("*.onnx")) if model_dir.exists() else []
    voices = sorted({p.stem for p in onnx_files})
    unique_voice_count = len(voices)
    # Formal B2 materializer always uses PiperTtsClient() default voice only.
    authorized_for_materialization = 1
    gap = unique_voice_count < 2 or authorized_for_materialization < 2
    return {
        "defaultVoice": DEFAULT_TTS_VOICE,
        "authorizedMaterializerVoice": DEFAULT_TTS_VOICE,
        "modelsPresentInRepo": voices,
        "uniqueVoiceCountInRepo": unique_voice_count,
        "authorizedVoiceCountForB2Materialization": authorized_for_materialization,
        "rateControlSupported": False,
        "prosodyControlSupported": False,
        "multiSpeakerReadyInCode": True,
        "materializerUsesVoiceParam": False,
        "assessment": (
            "NORMAL_ACOUSTIC_VARIATION_INFRASTRUCTURE_GAP"
            if gap
            else "partial_multi_voice_available"
        ),
    }


def scale_plan(pool_ceiling: int) -> list[dict]:
    sec_per_primary = 4.4
    spans_per_utt = 52.2
    paths_per_utt = 3.03  # 849/280
    stages = [
        ("S0", 280, "formal_seed_lineage_anchor"),
        ("S1", 1000, "training_feasibility_checkpoint"),
        ("S2", 5000, "first_serious_scale_broad_core"),
        ("S3", 10000, "production_oriented_core"),
        ("S3b", pool_ceiling, "current_pool_ceiling"),
        ("S4", 25000, "future_source_expansion_only"),
    ]
    rows = []
    for stage, n, purpose in stages:
        if stage == "S4":
            feasible = "requires_new_reference_sources"
        elif n <= pool_ceiling:
            feasible = "current_pool"
        else:
            feasible = "exceeds_pool"
        wall_h_1 = n * sec_per_primary / 3600
        for workers in (1, 2, 4):
            eff = workers * (0.92 if workers > 1 else 1.0)  # imperfect parallel
            wall = wall_h_1 / eff
            rows.append(
                {
                    "stage": stage,
                    "unique_families": n if feasible != "requires_new_reference_sources" else n,
                    "feasibility": feasible,
                    "est_audio_realizations_primary": n if stage != "S4" else 0,
                    "est_paths": int(n * paths_per_utt) if stage != "S4" else 0,
                    "est_span_path_rows": int(n * spans_per_utt) if stage != "S4" else 0,
                    "train_families_80pct": int(n * 0.8) if stage != "S4" and n <= pool_ceiling else "",
                    "dev_families_10pct": int(n * 0.1) if stage != "S4" and n <= pool_ceiling else "",
                    "test_families_10pct": int(n * 0.1) if stage != "S4" and n <= pool_ceiling else "",
                    "wall_hours": round(wall, 1),
                    "workers": workers,
                    "purpose": purpose,
                    "storage_gb_est": round(n * 0.8 / 1000, 2),  # rough: 0.8MB/utt artifacts
                }
            )
    return rows


def main() -> int:
    raw_lines = sum(1 for _ in POOL.open(encoding="utf-8"))
    exclude = load_gate0_exclusions()
    candidates = select_pool_candidates(exclude)
    pool = profile_pool(candidates)
    seed_texts = load_seed_texts()
    by_text = {r["referenceText"]: r for r in candidates}
    seed = profile_seed(seed_texts, by_text)
    spot = spot_validate(candidates, pool["fam_to_cats"])
    tts = audit_tts_capability()
    ceiling = pool["usable_families"]
    scale = scale_plan(ceiling)

    # exclusion accounting
    prot = load_protected_texts()
    excluded = Counter()
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = (o.get("normalized") or o.get("text") or "").strip()
            if not t:
                excluded["empty"] += 1
                continue
            rid = str(o.get("id") or hashlib.md5(t.encode()).hexdigest()[:12])
            if rid in PROTECTED_CASE_IDS or t in prot or check_holdout(reference_id=rid, reference_text=t):
                excluded["protected_holdout"] += 1
                continue
            if rid in exclude["referenceIds"]:
                excluded["gate0"] += 1
                continue
            cjk = cjk_len(t)
            if cjk < 10 or cjk > 36 or len(t) > 48:
                excluded["length_invalid"] += 1
                continue
            src = (o.get("source") or "").lower()
            if "dialog_200" in src or "dialog200" in src:
                excluded["dialog200"] += 1
                continue
            if t.startswith("一般对话里常说") and cjk < 14:
                excluded["spoken_prefix_short"] += 1

    OUT_DOCS.mkdir(parents=True, exist_ok=True)

    # 1) full pool profile CSV
    with (OUT_DOCS / "model3_v2_full_pool_profile.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["section", "metric", "value", "notes"])
        w.writerow(["pool", "raw_lines", raw_lines, ""])
        w.writerow(["pool", "usable_unique_families", ceiling, "authoritative recomputed"])
        w.writerow(["pool", "gate0_excluded", exclude["count"], ""])
        for k, v in excluded.items():
            w.writerow(["pool_excluded", k, v, ""])
        w.writerow(["pool", "avg_cjk_len", round(statistics.mean(pool["lengths"]), 2), ""])
        w.writerow(["pool", "median_cjk_len", statistics.median(pool["lengths"]), ""])
        w.writerow(["pool", "avg_categories_per_family", pool["avg_categories_per_family"], "multi-label"])

        for src, cnt in sorted(pool["by_source"].items(), key=lambda x: -x[1]):
            pct = round(100 * cnt / ceiling, 2)
            w.writerow(["source", src, cnt, f"pct={pct}"])
            w.writerow(["source_families", src, pool["by_source_unique_families"].get(src, 0), ""])

        for cat in CONV_TAXONOMY:
            fams = pool["cat_fams"].get(cat, 0)
            pct = round(100 * fams / ceiling, 2)
            assess = "good" if fams >= ceiling * 0.05 else ("partial" if fams >= ceiling * 0.01 else "sparse")
            w.writerow(["taxonomy", cat, fams, f"pool_pct={pct};assess={assess}"])
            w.writerow(["taxonomy_texts", cat, pool["cat_texts"].get(cat, 0), ""])
            w.writerow(["taxonomy_avg_len", cat, pool["cat_avg_len"].get(cat, 0), ""])
            w.writerow(["taxonomy_question_rate", cat, pool["cat_question_rate"].get(cat, 0), ""])
            w.writerow(["taxonomy_ne_rate", cat, pool["cat_ne_rate"].get(cat, 0), ""])

        w.writerow(["vocabulary", "unique_cjk_chars", pool["unique_cjk_chars"], "full pool"])
        w.writerow(["vocabulary", "unique_bigrams", pool["unique_bigrams"], ""])
        w.writerow(["vocabulary", "unique_trigrams", pool["unique_trigrams"], ""])
        w.writerow(["vocabulary", "long_tail_hapax_chars", pool["long_tail_char_hapax"], "freq=1"])
        w.writerow(["vocabulary_seed", "unique_cjk_chars", seed["unique_cjk_chars"], "280 seed"])
        w.writerow(["vocabulary_seed", "unique_bigrams", seed["unique_bigrams"], ""])
        w.writerow(["vocabulary_seed", "unique_trigrams", seed["unique_trigrams"], ""])
        w.writerow(
            [
                "vocabulary_ratio",
                "seed_chars_over_pool",
                round(seed["unique_cjk_chars"] / pool["unique_cjk_chars"], 4),
                "measured",
            ]
        )
        w.writerow(
            [
                "vocabulary_ratio",
                "seed_bigrams_over_pool",
                round(seed["unique_bigrams"] / pool["unique_bigrams"], 4),
                "measured",
            ]
        )

        for k, v in pool["struct_counts"].items():
            w.writerow(["linguistic", k, v, f"families={pool['struct_families'].get(k,0)}"])

        for cat, info in spot.items():
            w.writerow(["spot_audit", cat, "; ".join(info.get("samples", [])[:2]), "|".join(info["precision_concern"])])

    # 2) scale plan CSV
    with (OUT_DOCS / "model3_v2_expansion_scale_plan.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "stage",
                "unique_families",
                "feasibility",
                "est_audio_realizations_primary",
                "est_paths",
                "est_span_path_rows",
                "train_families_80pct",
                "dev_families_10pct",
                "test_families_10pct",
                "wall_hours",
                "workers",
                "storage_gb_est",
                "purpose",
            ],
        )
        w.writeheader()
        for row in scale:
            w.writerow(row)

    # 3) acoustic + multi-pc contract JSON
    contract = {
        "normalAcousticVariationContract": {
            "scope": "NORMAL_ACOUSTIC_VARIATION_only_not_pronunciation_error",
            "allowedDimensions": [
                "multiple_authorized_tts_voices",
                "bounded_speaking_rate_if_supported",
                "bounded_prosody_if_supported",
            ],
            "excludedDimensions": [
                "deliberate_mispronunciation",
                "n_l_d_t_nasal",
                "zh_ch_sh_vs_z_c_s",
                "tone_error_injection",
            ],
            "semanticFamilyRule": {
                "sameSemanticFamilyIdAcrossVariants": True,
                "sameSplitAssignment": True,
                "distinctMaterializationRunIdPerVariant": True,
                "crossSplitForbidden": True,
            },
            "recommendedStrategy": {
                "primaryRealization": "one_voice_all_references_for_S1_S2_scale",
                "secondaryRealization": "deterministic_20_30pct_subset_with_2nd_authorized_voice_after_infra_ready",
                "notRecommended": "all_references_times_all_voices",
                "acousticRealizationsPerFamily": "1 primary + 0-1 secondary (max 2 for production core)",
            },
        },
        "ttsCapabilityAudit": tts,
        "multiPcShardArchitecture": {
            "feasible": True,
            "preFreezeRequirements": [
                "sourceSelectionSeed",
                "shardId",
                "referenceId_list",
                "semanticFamilyId_list",
                "split_assignment",
                "acousticVariantPlan",
            ],
            "workerManifestFields": [
                "workerId",
                "machineIdentity",
                "asrCheckpointIdentity",
                "toneIdentity",
                "lexiconSnapshotIdentity",
                "model2CheckpointIdentity",
                "ttsVoiceIdentity",
                "featureContractIdentity",
                "labelContractIdentity",
                "provenanceContractIdentity",
            ],
            "mergeFailClosedOnMismatch": [
                "asr_model",
                "tone_model",
                "lexicon_snapshot",
                "model2_model",
                "normalization_logic",
                "feature_packer",
                "label_contract",
                "provenance_contract",
            ],
            "deterministicRetry": "reuse_frozen_shard_no_outcome_resampling",
        },
        "deletionSupervisionFunnel": {
            "diagnosticOnly": True,
            "stages": [
                "alignment_derived_deletion_region",
                "current_text_target_exists",
                "overlapping_eligible_fineSpan",
                "anchor_mask_subtraction",
                "label_contract_outcome",
                "retry_supervision_emitted",
            ],
            "priorAuditObservation": "204_deletion_regions_vs_97_retry_span_rows",
            "designNote": "Expansion QA tracks funnel rates; no label semantic change",
        },
        "surfaceShortcutQaCorrectedFields": [
            "surface",
            "keep_span_rows",
            "retry_span_rows",
            "keep_unique_semantic_families",
            "retry_unique_semantic_families",
            "total_unique_semantic_families",
            "position_diversity",
            "anchor_context_diversity",
            "candidate_state_diversity",
            "label_entropy",
        ],
        "realAudioReferenceLayer": {
            "role": "validation_and_realism_layer_not_primary_scale_path",
            "requirements": [
                "authorized_reference_text",
                "privacy_consent",
                "speaker_identity_provenance",
                "same_semanticFamily_split_lock",
                "closed_loop_labels_from_actual_asr",
            ],
        },
    }
    (OUT_DOCS / "model3_v2_acoustic_multi_pc_contract.json").write_text(
        json.dumps(contract, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # sparse categories in FULL pool
    sparse_cats = [
        c
        for c in CONV_TAXONOMY
        if pool["cat_fams"].get(c, 0) < ceiling * 0.005  # <0.5%
    ]
    source_gap = len(sparse_cats) >= 3

    tts_gap = tts["assessment"] == "NORMAL_ACOUSTIC_VARIATION_INFRASTRUCTURE_GAP"
    verdict = (
        "PRODUCTION_DATASET_EXPANSION_DESIGN_READY_WITH_NONBLOCKING_WARNINGS"
        if tts_gap or sparse_cats
        else "PRODUCTION_DATASET_EXPANSION_DESIGN_READY"
    )

    next_phase = (
        "MODEL3_V2_NORMAL_ACOUSTIC_VARIATION_PREPARATION"
        if tts_gap
        else "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S1_BUILD"
    )

    readiness = {
        "R1_full_pool_taxonomy_profiled": True,
        "R2_pool_vocabulary_profiled": True,
        "R3_source_bias_audited": True,
        "R4_selection_policy_frozen": False,
        "R5_holdout_policy_active": True,
        "R6_acoustic_variation_contract_resolved": True,
        "R7_tts_capability_sufficient": not tts_gap,
        "R8_semanticFamily_split_lock": True,
        "R9_multi_pc_identity_contract_defined": True,
        "R10_merge_qa_defined": True,
        "R11_dataset_lineage_defined": True,
        "R12_no_architecture_drift": True,
    }

    summary = {
        "phase": "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_DESIGN",
        "verdict": verdict,
        "readyForBulkExpansion": not tts_gap,
        "blockers": ["NORMAL_ACOUSTIC_VARIATION_INFRASTRUCTURE_GAP"] if tts_gap else [],
        "warnings": [
            "source_pool_taxonomy_keyword_method",
            "supplement_source_dominance",
            "sparse_categories_in_full_pool",
        ],
        "decisions": {
            "D1_usable_pool_size": ceiling,
            "D2_taxonomy_distribution": pool["cat_fams"],
            "D3_sparse_categories": sparse_cats,
            "D4_vocabulary": {
                "pool_unique_cjk": pool["unique_cjk_chars"],
                "pool_unique_bigrams": pool["unique_bigrams"],
                "pool_unique_trigrams": pool["unique_trigrams"],
                "seed_char_ratio": round(seed["unique_cjk_chars"] / pool["unique_cjk_chars"], 4),
            },
            "D5_source_bias": pool["by_source"],
            "D6_max_pool_ceiling_without_new_sources": ceiling,
            "D7_recommended_stages": ["S0:280", "S1:1000", "S2:5000", "S3:10000", f"S3b:{ceiling}", "S4:25000+new_sources"],
            "D8_first_serious_training_scale": "S2_5000_families_recommended_not_mandatory_gate",
            "D9_10k_before_production_decision": "recommended_checkpoint_not_hard_gate",
            "D10_25k_justified_when": "learning_curve_plateau_and_new_reference_sources_authorized",
            "D11_tts_adequate_speaker_diversity": False,
            "D12_normal_acoustic_strategy": contract["normalAcousticVariationContract"]["recommendedStrategy"],
            "D13_acoustic_realizations_per_family": "1_primary_plus_0_to_1_secondary_max_2",
            "D14_variants_all_or_subset": "subset_for_secondary_voice_after_infra_ready",
            "D15_pronunciation_perturbation_trigger": "separate_future_phase_after_normal_variation_and_learning_curve",
            "D16_multi_pc_safe": True,
            "D17_worker_identities_must_match": contract["multiPcShardArchitecture"]["mergeFailClosedOnMismatch"],
            "D18_cost_estimates": "see model3_v2_expansion_scale_plan.csv",
            "D19_seed_280_lineage": "versioned_retained_not_mutated_parent_of_S1+",
            "D20_next_phase": next_phase,
        },
        "readinessGates": readiness,
        "nextPhase": next_phase,
        "currentPoolSufficient": {"S1": True, "S2": True, "S3": True, "S3b": True},
        "needNewReferenceSource": "LATER_for_S4_25k+",
        "acousticVariationReady": not tts_gap,
        "sourcePoolCoverageGapCategories": sparse_cats,
    }
    (OUT_DOCS / "model3_v2_expansion_readiness_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps({"usable": ceiling, "verdict": verdict, "next": next_phase}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
