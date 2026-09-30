# -*- coding: utf-8 -*-
"""Block A freeze-gate validators."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from training.dialog2000_v2_pilot200.constants import (
    ACTIVE_RELATIONS,
    FORBIDDEN_CASE_FIELDS,
    USER_ASSIGNMENTS,
)


def _fail(name: str, detail: str) -> dict[str, Any]:
    return {"gate": name, "status": "FAIL", "detail": detail}


def _pass(name: str, detail: str = "") -> dict[str, Any]:
    return {"gate": name, "status": "PASS", "detail": detail}


def validate_all(
    *,
    cases: list[dict[str, Any]],
    manifest: dict[str, Any],
    profiles_by_user: dict[str, Any],
    old_dialog_fingerprint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []

    # MANIFEST_VALID
    req = [
        "dataset_id",
        "version",
        "build_id",
        "generator_version",
        "seed",
        "case_count",
        "relation_distribution",
        "domain_distribution",
        "profile_distribution",
        "split_distribution",
        "voice_distribution",
        "user_assignment",
    ]
    missing = [k for k in req if k not in manifest]
    if missing or manifest.get("case_count") != 200:
        results.append(_fail("MANIFEST_VALID", f"missing={missing} case_count={manifest.get('case_count')}"))
    else:
        results.append(_pass("MANIFEST_VALID"))

    # counts
    user_c = Counter(c["userId"] for c in cases)
    split_c = Counter(c["split"] for c in cases)
    class_c = Counter(c["expectedBehaviorClass"] for c in cases)
    clean = class_c.get("CLEAN_PRESERVE", 0)
    if len(cases) != 200 or any(user_c[u] != 40 for u in USER_ASSIGNMENTS):
        results.append(_fail("CASE_COUNT_STRUCTURE", f"users={dict(user_c)} n={len(cases)}"))
    else:
        results.append(_pass("CASE_COUNT_STRUCTURE", str(dict(user_c))))
    if split_c.get("DEV") != 120 or split_c.get("VALIDATION") != 60 or split_c.get("HOLDOUT") != 20:
        results.append(_fail("SPLIT_COUNTS", str(dict(split_c))))
    else:
        results.append(_pass("SPLIT_COUNTS", str(dict(split_c))))
    if clean < 40:
        results.append(_fail("CLEAN_MIN", f"clean={clean}"))
    else:
        results.append(_pass("CLEAN_MIN", f"clean={clean}"))

    # ACTIVE relations only
    bad_rel = [
        c["caseId"]
        for c in cases
        if c.get("relationFamily") not in (None, "NONE") and c.get("relationFamily") not in ACTIVE_RELATIONS
    ]
    if bad_rel:
        results.append(_fail("ACTIVE_RELATIONS_ONLY", str(bad_rel[:10])))
    else:
        results.append(_pass("ACTIVE_RELATIONS_ONLY"))

    # PROFILE_LEXICAL_ISOLATION
    # Per case + global: all profile build term ids vs all eval target term ids
    all_build: set[str] = set()
    all_eval: set[str] = set()
    per_case_hits: list[str] = []
    for c in cases:
        b = set(c.get("profileBuildTermIds") or [])
        e = set(c.get("evaluationTargetTermIds") or [])
        all_build |= b
        all_eval |= e
        inter = b & e
        if inter:
            per_case_hits.append(f"{c['caseId']}:{sorted(inter)}")
    global_inter = all_build & all_eval
    if per_case_hits or global_inter:
        results.append(
            _fail(
                "PROFILE_LEXICAL_ISOLATION_PASS",
                f"per_case={len(per_case_hits)} global={sorted(global_inter)[:20]}",
            )
        )
    else:
        results.append(_pass("PROFILE_LEXICAL_ISOLATION_PASS", f"build={len(all_build)} eval={len(all_eval)}"))

    # Holdout leakage: holdout eval terms must not appear in any profile history
    holdout_eval: set[str] = set()
    for c in cases:
        if c["split"] == "HOLDOUT":
            holdout_eval |= set(c.get("evaluationTargetTermIds") or [])
    holdout_leak = holdout_eval & all_build
    if holdout_leak:
        results.append(_fail("HOLDOUT_ISOLATION", str(sorted(holdout_leak)[:20])))
    else:
        results.append(_pass("HOLDOUT_ISOLATION", f"holdout_eval_terms={len(holdout_eval)}"))

    # RELATION_DISTRIBUTION — no single relation > 40% of perturbed cases
    rel_c = Counter(c["relationFamily"] for c in cases if c.get("relationFamily"))
    perturbed = sum(rel_c.values()) or 1
    dominated = [r for r, n in rel_c.items() if n / perturbed > 0.40]
    if dominated:
        results.append(_fail("RELATION_DISTRIBUTION_PASS", f"dominated={dominated} dist={dict(rel_c)}"))
    else:
        results.append(_pass("RELATION_DISTRIBUTION_PASS", str(dict(rel_c))))

    # DOMAIN_DECONFOUND
    rel_domains: dict[str, set[str]] = defaultdict(set)
    user_domains: dict[str, set[str]] = defaultdict(set)
    user_rels: dict[str, set[str]] = defaultdict(set)
    for c in cases:
        user_domains[c["userId"]].add(c["domain"])
        if c.get("relationFamily"):
            rel_domains[c["relationFamily"]].add(c["domain"])
            user_rels[c["userId"]].add(c["relationFamily"])
    deconfound_fail = []
    for r, doms in rel_domains.items():
        if len(doms) < 2:
            deconfound_fail.append(f"{r}:domains={sorted(doms)}")
    # user must not equal single domain
    for u, doms in user_domains.items():
        if len(doms) < 2:
            deconfound_fail.append(f"{u}:single_domain={sorted(doms)}")
    if deconfound_fail:
        results.append(_fail("DOMAIN_DECONFOUND_PASS", str(deconfound_fail)))
    else:
        results.append(
            _pass(
                "DOMAIN_DECONFOUND_PASS",
                {r: sorted(v) for r, v in rel_domains.items()},
            )
        )

    # NO_KNOWN_TEST_LEAK
    leak = []
    for c in cases:
        for f in FORBIDDEN_CASE_FIELDS:
            if f in c:
                leak.append(f"{c['caseId']}:{f}")
    if leak:
        results.append(_fail("NO_KNOWN_TEST_LEAK", str(leak[:20])))
    else:
        results.append(_pass("NO_KNOWN_TEST_LEAK"))

    # AUDIO_IDENTITY_COMPLETE
    audio_bad = []
    for c in cases:
        ai = c.get("audioIdentity") or {}
        for k in ("audioId", "byte_size", "sha256", "sample_rate", "channels", "duration"):
            if k == "audioId":
                if not c.get("audioId"):
                    audio_bad.append(c["caseId"])
                    break
            elif ai.get(k) in (None, "", 0) and k != "duration":
                audio_bad.append(c["caseId"])
                break
            elif k == "duration" and not ai.get("duration"):
                audio_bad.append(c["caseId"])
                break
    if audio_bad:
        results.append(_fail("AUDIO_IDENTITY_COMPLETE", str(audio_bad[:10])))
    else:
        results.append(_pass("AUDIO_IDENTITY_COMPLETE", f"n={len(cases)}"))

    # REFERENCE_FROZEN
    ref_bad = [c["caseId"] for c in cases if not (c.get("referenceText") or "").strip()]
    if ref_bad:
        results.append(_fail("REFERENCE_FROZEN", str(ref_bad[:10])))
    else:
        results.append(_pass("REFERENCE_FROZEN", "all references non-empty; frozen at generation"))

    # Wrong profile validity
    wrong_bad = []
    for c in cases:
        if c["expectedBehaviorClass"] != "WRONG_PROFILE_CONTROL":
            continue
        wp = c.get("wrongProfileUserId")
        if not wp:
            if c.get("wrongProfileStatus") != "NO_VALID_WRONG_PROFILE_AVAILABLE":
                wrong_bad.append(c["caseId"])
            continue
        rel = c.get("relationFamily")
        if rel and rel in USER_ASSIGNMENTS.get(wp, {}):
            wrong_bad.append(f"{c['caseId']}:shared:{rel}")
    if wrong_bad:
        results.append(_fail("WRONG_PROFILE_VALID", str(wrong_bad[:10])))
    else:
        results.append(_pass("WRONG_PROFILE_VALID"))

    # Old dialog_200 unchanged marker
    if old_dialog_fingerprint and not old_dialog_fingerprint.get("unchanged", True):
        results.append(_fail("OLD_DIALOG200_UNCHANGED", str(old_dialog_fingerprint)))
    else:
        results.append(_pass("OLD_DIALOG200_UNCHANGED", str(old_dialog_fingerprint or {})))

    # Model2 eligibility (core target population only)
    m2 = [c for c in cases if c.get("isModel2TargetCase")]
    m2_ok = [c for c in m2 if c.get("model2LexiconEligible")]
    rate = (len(m2_ok) / len(m2)) if m2 else 0.0
    detail = {
        "MODEL2_TARGET_CASE_COUNT": len(m2),
        "MODEL2_LEXICON_ELIGIBLE_TARGET_COUNT": len(m2_ok),
        "MODEL2_LEXICON_INELIGIBLE_TARGET_COUNT": len(m2) - len(m2_ok),
        "MODEL2_LEXICON_ELIGIBILITY_RATE": round(rate, 4),
    }
    if rate < 0.85:
        results.append(_fail("MODEL2_LEXICON_ELIGIBILITY", str(detail)))
    else:
        results.append(_pass("MODEL2_LEXICON_ELIGIBILITY", str(detail)))

    hard = [
        "MANIFEST_VALID",
        "PROFILE_LEXICAL_ISOLATION_PASS",
        "RELATION_DISTRIBUTION_PASS",
        "DOMAIN_DECONFOUND_PASS",
        "NO_KNOWN_TEST_LEAK",
        "AUDIO_IDENTITY_COMPLETE",
        "REFERENCE_FROZEN",
        "MODEL2_LEXICON_ELIGIBILITY",
    ]
    by = {r["gate"]: r for r in results}
    hard_fail = [g for g in hard if by.get(g, {}).get("status") != "PASS"]
    status = "PASS" if not hard_fail and all(r["status"] == "PASS" for r in results) else "FAIL"
    # soft: allow non-hard failures? Spec says any hard gate FAIL → FAIL. Soft extras also should pass.
    if hard_fail:
        status = "FAIL"
    elif any(r["status"] != "PASS" for r in results):
        status = "FAIL"

    return {
        "status": status,
        "hard_gate_failures": hard_fail,
        "gates": results,
        "counts": {
            "users": dict(user_c),
            "splits": dict(split_c),
            "classes": dict(class_c),
            "relations": dict(rel_c),
            "clean": clean,
        },
    }
