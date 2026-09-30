# -*- coding: utf-8 -*-
"""Audit-only automatic target-scope derivation (no case IDs, no known-target strings).

Uses existing Model3 V2 malformed-region alignment (difflib SequenceMatcher).
Must NOT be imported by runtime / production pipeline code.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any

from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    derive_malformed_regions,
    subtract_anchors,
)

_PUNCT_RE = re.compile(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…·`~@#$%^&*+=<>|/\\]")

# Lightweight Traditional→Simplified fold for audit eligibility only.
_TRAD_SIMP_MAP = {
    "點": "点",
    "軟": "软",
    "醫": "医",
    "顯": "显",
    "訂": "订",
    "單": "单",
    "嗎": "吗",
    "麼": "么",
    "為": "为",
    "這": "这",
    "們": "们",
    "說": "说",
    "請": "请",
    "對": "对",
    "開": "开",
    "關": "关",
    "時": "时",
    "間": "间",
    "後": "后",
    "從": "从",
    "電": "电",
    "話": "话",
    "語": "语",
    "員": "员",
    "會": "会",
    "業": "业",
    "務": "务",
    "與": "与",
    "於": "于",
    "經": "经",
    "過": "过",
    "還": "还",
    "沒": "没",
    "東": "东",
    "長": "长",
    "門": "门",
    "問": "问",
    "題": "题",
    "號": "号",
    "裡": "里",
    "裏": "里",
    "並": "并",
    "確": "确",
    "認": "认",
    "發": "发",
    "現": "现",
    "環": "环",
    "線": "线",
    "網": "网",
    "頁": "页",
    "訊": "讯",
    "臺": "台",
    "櫃": "柜",
    "檯": "台",
    "燈": "灯",
    "車": "车",
    "輛": "辆",
    "價": "价",
    "錢": "钱",
    "塊": "块",
    "萬": "万",
    "億": "亿",
    "優": "优",
    "餘": "余",
    "係": "系",
    "報": "报",
    "準": "准",
    "備": "备",
    "註": "注",
    "冊": "册",
    "錄": "录",
    "處": "处",
    "據": "据",
    "類": "类",
    "劃": "划",
    "計": "计",
    "議": "议",
    "義": "义",
    "產": "产",
    "區": "区",
    "國": "国",
    "際": "际",
    "衛": "卫",
    "藝": "艺",
    "術": "术",
    "複": "复",
    "習": "习",
    "靜": "静",
    "態": "态",
    "體": "体",
    "雲": "云",
    "靈": "灵",
    "廳": "厅",
    "廚": "厨",
    "廁": "厕",
    "廠": "厂",
    "場": "场",
    "牆": "墙",
    "檢": "检",
    "驗": "验",
    "測": "测",
    "試": "试",
    "調": "调",
    "邊": "边",
    "達": "达",
    "遠": "远",
    "適": "适",
    "選": "选",
    "郵": "邮",
    "鄉": "乡",
    "馬": "马",
    "魚": "鱼",
    "雞": "鸡",
    "齊": "齐",
    "齒": "齿",
    "齡": "龄",
    "擊": "击",
    "兩": "两",
    "個": "个",
    "將": "将",
    "來": "来",
    "實": "实",
    "種": "种",
    "樣": "样",
    "貨": "货",
    "質": "质",
    "賓": "宾",
    "館": "馆",
    "樓": "楼",
    "層": "层",
        "廣": "广",
        "幾": "几",
        "緩": "缓",
        "態": "态",
        "麼": "么",
}
_TRAD_SIMP = str.maketrans(_TRAD_SIMP_MAP)


def fold_cjk_variant(s: str) -> str:
    return (s or "").translate(_TRAD_SIMP)


def norm_text(s: str) -> str:
    return _PUNCT_RE.sub("", fold_cjk_variant(s or "")).lower()


def is_punctuation_only_diff(cur: str, ref: str) -> bool:
    return norm_text(cur) == norm_text(ref)


def is_digit_style_only(cur: str, ref: str) -> bool:
    c = norm_text(cur)
    r = norm_text(ref)
    if not c and not r:
        return True
    num = str.maketrans("零一二三四五六七八九〇两兩", "0123456789022")
    return c.translate(num) == r.translate(num) and bool(c.translate(num))


def is_substantive_lexical_target(asr: str, ref: str) -> bool:
    """Defensible local repair target for mechanism stats (multi-char lexical)."""
    r = norm_text(ref)
    if not r:
        return False
    if is_punctuation_only_diff(asr, ref) or is_digit_style_only(asr, ref):
        return False
    return len(r) >= 2


@dataclass
class DerivedTarget:
    curStart: int
    curEnd: int
    refStart: int | None
    refEnd: int | None
    tag: str
    asrSurface: str
    refSurface: str
    lengthChanging: bool
    confidence: str  # HIGH | MEDIUM | LOW | UNRESOLVED
    eligibility: str
    notes: str = ""


@dataclass
class TargetScopeResult:
    scopeClass: str
    targets: list[DerivedTarget] = field(default_factory=list)
    deletionGaps: int = 0
    ambiguous: bool = False
    notes: str = ""


def _raw_opcodes(current: str, reference: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    sm = difflib.SequenceMatcher(a=current, b=reference, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        out.append(
            {
                "tag": tag,
                "curStart": i1,
                "curEnd": i2 if tag != "insert" else i1,
                "refStart": j1,
                "refEnd": j2,
                "asrSurface": current[i1:i2] if tag != "insert" else "",
                "refSurface": reference[j1:j2] if tag != "delete" else "",
                "deletionGap": tag == "insert",
                "lengthChanging": (i2 - i1) != (j2 - j1),
            }
        )
    return out


def _expand_phonetic_context(
    asr: str,
    reference: str,
    cs: int,
    ce: int,
    rs: int | None,
    re_: int | None,
    max_total: int = 3,
) -> tuple[int, int, int | None, int | None, str, str]:
    """Expand single-char replace with equal neighbors (≤3 chars) for local diagnostic window."""
    asr_surf = asr[cs:ce]
    ref_surf = reference[rs:re_] if isinstance(rs, int) and isinstance(re_, int) else ""
    if len(norm_text(ref_surf)) >= 2 or not isinstance(rs, int) or not isinstance(re_, int):
        return cs, ce, rs, re_, asr_surf, ref_surf
    # expand left/right while characters match across asr/ref alignment neighborhood
    lcs, lce, lrs, lre = cs, ce, rs, re_
    # left
    while lcs > 0 and lrs > 0 and len(norm_text(reference[lrs:lre])) < max_total:
        if asr[lcs - 1] == reference[lrs - 1] or fold_cjk_variant(asr[lcs - 1]) == fold_cjk_variant(reference[lrs - 1]):
            lcs -= 1
            lrs -= 1
        else:
            break
    # right
    while lce < len(asr) and lre < len(reference) and len(norm_text(reference[lrs:lre])) < max_total:
        if asr[lce] == reference[lre] or fold_cjk_variant(asr[lce]) == fold_cjk_variant(reference[lre]):
            lce += 1
            lre += 1
        else:
            break
    return lcs, lce, lrs, lre, asr[lcs:lce], reference[lrs:lre]


def _confidence_for_region(asr: str, ref: str, tag: str) -> str:
    if is_punctuation_only_diff(asr, ref) or is_digit_style_only(asr, ref):
        return "LOW"
    a = norm_text(asr)
    r = norm_text(ref)
    if not a and not r:
        return "UNRESOLVED"
    alen, rlen = len(a), len(r)
    if not is_substantive_lexical_target(asr, ref):
        # single-char phonetic may be MEDIUM for reporting, not HIGH for prevalence
        if max(alen, rlen) == 1 and tag == "replace":
            return "MEDIUM"
        return "LOW"
    if tag in ("replace", "delete") and 2 <= max(alen, rlen) <= 8 and abs(alen - rlen) <= 4:
        return "HIGH"
    if 2 <= max(alen, rlen) <= 12:
        return "MEDIUM"
    if max(alen, rlen) > 24:
        return "LOW"
    return "MEDIUM"


def derive_target_scope(
    asr: str,
    reference: str,
    *,
    anchor_ranges: list[tuple[int, int]] | None = None,
    has_fine_spans: bool = True,
) -> TargetScopeResult:
    """Derive diagnostic repair targets from ASR↔reference alignment.

    No caseId. No hardcoded expected target strings.
    """
    asr = asr or ""
    reference = reference or ""

    if not reference:
        return TargetScopeResult(scopeClass="TARGET_SCOPE_NOT_EVALUATED", notes="missing_reference")

    if norm_text(asr) == norm_text(reference) and (asr or reference):
        return TargetScopeResult(scopeClass="FINAL_ALREADY_EQUIVALENT", notes="norm_equal_incl_trad_simp")

    if not asr and reference:
        return TargetScopeResult(
            scopeClass="NO_REPAIRABLE_TARGET" if not has_fine_spans else "DELETION_NO_REPAIRABLE_TARGET",
            deletionGaps=1,
            notes="empty_asr_with_reference",
        )

    opcodes = _raw_opcodes(asr, reference)
    if not opcodes:
        return TargetScopeResult(scopeClass="FINAL_ALREADY_EQUIVALENT", notes="no_opcodes")

    deletion_gaps = sum(1 for o in opcodes if o.get("deletionGap"))
    cur_regions = derive_malformed_regions(asr, reference, anchors=anchor_ranges)

    if deletion_gaps and not cur_regions:
        return TargetScopeResult(
            scopeClass="NO_REPAIRABLE_TARGET",
            deletionGaps=deletion_gaps,
            notes="deletion_gap_no_finespan_surface",
        )

    targets: list[DerivedTarget] = []
    for r in cur_regions:
        cs, ce = int(r["curStart"]), int(r["curEnd"])
        asr_surf = asr[cs:ce]
        best = None
        best_ov = -1
        for o in opcodes:
            if o.get("deletionGap"):
                continue
            ocs, oce = int(o["curStart"]), int(o["curEnd"])
            ov = max(0, min(ce, oce) - max(cs, ocs))
            if ov > best_ov:
                best_ov = ov
                best = o
        ref_surf = ""
        rs = re_ = None
        tag = r.get("tag") or "replace"
        length_changing = bool(r.get("lengthChanging"))
        if best:
            ref_surf = str(best.get("refSurface") or "")
            rs, re_ = best.get("refStart"), best.get("refEnd")
            tag = str(best.get("tag") or tag)
            length_changing = bool(best.get("lengthChanging"))
            cs, ce, rs, re_, asr_surf, ref_surf = _expand_phonetic_context(
                asr, reference, cs, ce, rs if isinstance(rs, int) else None, re_ if isinstance(re_, int) else None
            )
        if is_punctuation_only_diff(asr_surf, ref_surf) or is_digit_style_only(asr_surf, ref_surf):
            continue
        conf = _confidence_for_region(asr_surf, ref_surf, tag)
        eligibility = "ELIGIBLE"
        if conf in ("LOW", "UNRESOLVED"):
            eligibility = "LOW_CONFIDENCE"
        elif not is_substantive_lexical_target(asr_surf, ref_surf):
            eligibility = "NON_SUBSTANTIVE"
            if conf == "HIGH":
                conf = "MEDIUM"
        elif not ref_surf and asr_surf:
            eligibility = "AMBIGUOUS"
            conf = "UNRESOLVED" if conf == "HIGH" else conf
        targets.append(
            DerivedTarget(
                curStart=cs,
                curEnd=ce,
                refStart=int(rs) if isinstance(rs, int) else None,
                refEnd=int(re_) if isinstance(re_, int) else None,
                tag=tag,
                asrSurface=asr_surf,
                refSurface=ref_surf,
                lengthChanging=length_changing,
                confidence=conf,
                eligibility=eligibility,
            )
        )

    if anchor_ranges:
        pre = derive_malformed_regions(asr, reference, anchors=None)
        for r in pre:
            kept = subtract_anchors(r["curStart"], r["curEnd"], anchor_ranges)
            if not kept and r["curEnd"] > r["curStart"]:
                targets.append(
                    DerivedTarget(
                        curStart=int(r["curStart"]),
                        curEnd=int(r["curEnd"]),
                        refStart=None,
                        refEnd=None,
                        tag="anchor_blocked",
                        asrSurface=asr[int(r["curStart"]) : int(r["curEnd"])],
                        refSurface="",
                        lengthChanging=bool(r.get("lengthChanging")),
                        confidence="HIGH",
                        eligibility="OUTSIDE_CURRENT_RETRY_CONTRACT",
                        notes="anchor_barrier",
                    )
                )

    if not targets:
        if opcodes and all(
            is_punctuation_only_diff(o["asrSurface"], o["refSurface"])
            or is_digit_style_only(o["asrSurface"], o["refSurface"])
            for o in opcodes
            if not o.get("deletionGap")
        ):
            return TargetScopeResult(scopeClass="FINAL_ALREADY_EQUIVALENT", notes="ortho_or_punct_filtered")
        if deletion_gaps and not has_fine_spans:
            return TargetScopeResult(
                scopeClass="NO_REPAIRABLE_TARGET",
                deletionGaps=deletion_gaps,
                notes="deletion_no_finespan",
            )
        return TargetScopeResult(
            scopeClass="REFERENCE_DIFF_AMBIGUOUS_ALIGNMENT",
            ambiguous=True,
            deletionGaps=deletion_gaps,
            notes="no_eligible_local_region",
        )

    outside = [t for t in targets if t.eligibility == "OUTSIDE_CURRENT_RETRY_CONTRACT"]
    eligible = [
        t
        for t in targets
        if t.eligibility == "ELIGIBLE" and t.confidence in ("HIGH", "MEDIUM") and is_substantive_lexical_target(t.asrSurface, t.refSurface)
    ]
    low = [t for t in targets if t.confidence in ("LOW", "UNRESOLVED") or t.eligibility in ("AMBIGUOUS", "NON_SUBSTANTIVE", "LOW_CONFIDENCE")]

    if eligible:
        return TargetScopeResult(
            scopeClass="REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION",
            targets=targets,
            deletionGaps=deletion_gaps,
        )
    if outside and not eligible:
        return TargetScopeResult(
            scopeClass="OUTSIDE_CURRENT_RETRY_CONTRACT",
            targets=targets,
            deletionGaps=deletion_gaps,
        )
    if low and not eligible:
        return TargetScopeResult(
            scopeClass="REFERENCE_DIFF_AMBIGUOUS_ALIGNMENT",
            targets=targets,
            ambiguous=True,
            deletionGaps=deletion_gaps,
        )
    return TargetScopeResult(
        scopeClass="REFERENCE_DIFF_NO_REPAIRABLE_LOCAL_REGION",
        targets=targets,
        deletionGaps=deletion_gaps,
    )


def structural_family_id(ref_surface: str, mechanism: str) -> str:
    n = norm_text(ref_surface) or "EMPTY"
    key = n[:8] if len(n) > 8 else n
    return f"{mechanism}:{key}"
