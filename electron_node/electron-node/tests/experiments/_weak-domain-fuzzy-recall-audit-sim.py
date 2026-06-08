#!/usr/bin/env python3
# READONLY audit simulation — Weak Domain Priority + Fuzzy Span Recall
import json
import sqlite3
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
DB = ROOT / "node_runtime/lexicon/v3/lexicon.sqlite"
OUT = ROOT / "electron_node/electron-node/tests/experiments/_weak-domain-fuzzy-recall-audit-sim.json"

ENABLED_DOMAINS = ["tech_ai", "travel", "transport", "restaurant"]
MIN_PRIOR = 0.5
MAX_FUZZY_VARIANTS = 4
FUNCTION_WORDS = {
    "有", "要", "想", "点", "做", "一", "杯", "个", "的", "了", "吗", "呢",
    "请", "帮", "我", "就", "行", "谢谢", "以", "下", "深", "温", "赶", "时间",
}

# Known pinyin keys for cafe targets (from prior probe)
PINYIN_KEY = {
    "钟贝": "zhong|bei",
    "贝少": "bei|shao",  # wrong
    "钟贝少": "zhong|bei|shao",
    "深便": "shen|bian",
    "蓝美马分": "lan|mei|ma|fen",
    "有蓝美马分": "you|lan|mei|ma|fen",
    "有蓝美马": "you|lan|mei|ma",
    "美食": "mei|shi",
    "做一杯美食": "zuo|yi|bei|mei|shi",
    "一杯美食": "yi|bei|mei|shi",
    "悲": "bei",
    "大悲": "da|bei",
    "悲就行谢谢": "bei|jiu|xing|xie|xie",
    "就行谢谢": "jiu|xing|xie|xie",
    "燕麦": "yan|mai",
    "少病": "shao|bing",
    "小背": "xiao|bei",
    "赶时间小背": "gan|shi|jian|xiao|bei",
    "时间小背": "shi|jian|xiao|bei",
}

TARGETS = {
    "d001": [
        ("钟贝少", "中杯"),
        ("深便", "顺便"),
        ("有蓝美马分", "蓝莓马芬"),
    ],
    "d002": [
        ("做一杯美食", "美式"),
        ("悲就行谢谢", "大杯"),
    ],
    "d003": [
        ("燕麦", None),
        ("少病", "少冰"),
        ("赶时间小背", "小杯"),
    ],
}

CROSS_SCENARIO = [
    ("hospital", "歇常規", "血常规", "xie|chang|gui"),
    ("hospital", "请家休息", "请假休息", None),
    ("bank", "传中", "中码", None),
    ("tech_deploy", "后选生", "候选生", None),
    ("friend", "义气", "一起", None),
    ("cafe", "钟贝", "中杯", "zhong|bei"),
]


def is_cjk(s: str) -> bool:
    return all("\u4e00" <= c <= "\u9fff" for c in s)


def gen_variants(span: str) -> list[str]:
    out: list[str] = []
    seen = set()

    def add(v: str) -> None:
        v = v.strip()
        if not v or v in seen:
            return
        if not is_cjk(v):
            return
        if len(v) < 2 or len(v) > 6:
            return
        seen.add(v)
        out.append(v)

    add(span)
    if len(span) >= 3:
        add(span[1:])
        add(span[:-1])
        add(span[1:-1])
    # function word strip (head/tail only, one pass)
    for fw in sorted(FUNCTION_WORDS, key=len, reverse=True):
        if span.startswith(fw) and len(span) > len(fw):
            add(span[len(fw):])
        if span.endswith(fw) and len(span) > len(fw):
            add(span[: -len(fw)])
    # 2-gram sliding for long spans
    if len(span) >= 4:
        for i in range(len(span) - 1):
            for j in range(i + 2, min(i + 6, len(span) + 1)):
                add(span[i:j])
    return out[:MAX_FUZZY_VARIANTS]


def bucket_lookup(conn, key: str, length: int, domain_ids: list[str]) -> dict:
    base = conn.execute(
        "SELECT word, prior_score, repair_target FROM base_lexicon "
        "WHERE pinyin_key=? AND length(word)=? AND enabled=1 AND repair_target=1 "
        "ORDER BY prior_score DESC LIMIT 12",
        (key, length),
    ).fetchall()
    domain_rows = []
    for did in domain_ids:
        rows = conn.execute(
            "SELECT word, domain_id, prior_score, repair_target FROM domain_lexicon "
            "WHERE domain_id=? AND pinyin_key=? AND length(word)=? AND enabled=1 AND repair_target=1 "
            "ORDER BY prior_score DESC LIMIT 8",
            (did, key, length),
        ).fetchall()
        domain_rows.extend(rows)
    return {"base": base, "domain": domain_rows}


def recall_for_variant(conn, variant: str, mode: str) -> list[str]:
    key = PINYIN_KEY.get(variant)
    if not key:
        return []
    length = len(variant)
    if mode == "general_current":
        domain_ids = []
    elif mode == "weak_all_domain":
        domain_ids = ENABLED_DOMAINS
    elif mode == "restaurant_strong":
        domain_ids = ["restaurant"]
    else:
        domain_ids = []
    bucket = bucket_lookup(conn, key, length, domain_ids)
    words = []
    for r in bucket["domain"]:
        if r[2] >= MIN_PRIOR:
            words.append(r[0])
    for r in bucket["base"]:
        if r[1] >= MIN_PRIOR and r[0] not in words:
            words.append(r[0])
    return words[:8]


def simulate_case(conn, span: str, target: str | None) -> dict:
    variants = gen_variants(span)
    rows = []
    hit_general = False
    hit_weak = False
    for v in variants:
        g = recall_for_variant(conn, v, "general_current")
        w = recall_for_variant(conn, v, "weak_all_domain")
        expected = target and target in w
        if target and target in g:
            hit_general = True
        if expected:
            hit_weak = True
        rows.append(
            {
                "variant": v,
                "generalTop": g,
                "weakDomainTop": w,
                "expectedHitWeak": expected,
                "expectedHitGeneral": target in g if target else False,
            }
        )
    return {
        "span": span,
        "target": target,
        "fuzzyVariants": variants,
        "variantRows": rows,
        "expectedHitViaWeak": hit_weak,
        "expectedHitViaGeneral": hit_general,
    }


def cross_risk(conn, scenario: str, span: str, note: str, key: str | None) -> dict:
    variants = gen_variants(span)[:4]
    pollution = []
    for v in variants:
        if key and len(v) == len(span):
            k = key
        else:
            k = PINYIN_KEY.get(v)
        if not k:
            continue
        bucket = bucket_lookup(conn, k, len(v), ENABLED_DOMAINS)
        for r in bucket["domain"]:
            word, did, prior, _ = r
            if did == "restaurant" and scenario != "cafe":
                pollution.append({"variant": v, "word": word, "domain": did})
            if did == "tech_ai" and scenario in ("cafe", "friend", "hospital"):
                pollution.append({"variant": v, "word": word, "domain": did})
    risk = "low" if not pollution else ("medium" if len(pollution) <= 2 else "high")
    return {
        "scenario": scenario,
        "span": span,
        "note": note,
        "pollutionSamples": pollution[:5],
        "riskLevel": risk,
        "kenlmLikelyReject": True,
    }


def main() -> None:
    conn = sqlite3.connect(DB)
    cafe_sim = {}
    for case_id, spans in TARGETS.items():
        cafe_sim[case_id] = [simulate_case(conn, s, t) for s, t in spans]

    cross = [cross_risk(conn, *args) for args in CROSS_SCENARIO]

    # performance estimate
    perf = {
        "current": {
            "recall_avg_ms": 1.385,
            "recall_p95_ms": 4,
            "kenlm_queried_cases": 52,
            "kenlm_combination_avg_when_queried": "1-16",
        },
        "estimated_with_weak_fuzzy": {
            "recall_avg_ms": "2-4",
            "recall_p95_ms": "8-12",
            "sql_queries_per_span_multiplier": "1 + variants(<=4) * domains(4)",
            "kenlm_combination_increase": "only if recall hit increases; cap maxSentenceCandidates=16 unchanged",
        },
    }

    out = {
        "enabledDomains": ENABLED_DOMAINS,
        "cafeSimulation": cafe_sim,
        "crossScenarioRisk": cross,
        "performanceEstimate": perf,
        "aliasInDb": {
            "domain_alias_rows": conn.execute(
                "SELECT COUNT(*) FROM domain_lexicon WHERE is_alias=1"
            ).fetchone()[0],
            "canonical_with_aliases": conn.execute(
                "SELECT word, aliases FROM domain_lexicon WHERE is_alias=0 AND aliases!='[]'"
            ).fetchall()[:12],
        },
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(OUT))


if __name__ == "__main__":
    main()
