# -*- coding: utf-8 -*-
"""Accept MODEL3_SPOKEN_BASE_SUPPLEMENT_V1 into certified spoken base pool (offline)."""
from __future__ import annotations

import csv
import hashlib
import json
import random
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs/user_correction/model3"
SUPP = (
    REPO
    / "docs/user_correction/model3/model3_spoken_base/model3_spoken_base_v1_18000"
)
ELECTRON = REPO / "electron_node/electron-node"
PREV_CERT = 4955  # prior certified (carrier-cap) — recomputed below for honesty

_CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")
_PUNCT = re.compile(
    r"[\s\u3000-\u303f\uff00-\uffef.,!?;:'\"()[\]{}<>，。！？；：、（）【】「」—…·\-@#$%^&*+=|\\/~～]+",
    re.UNICODE,
)
# Repeated discourse tails / frames observed in supplement samples
_FRAME_TAILS = [
    "免得后面又要重新弄",
    "我这边好安排",
    "这边好安排",
    "这边没别的要求",
    "没别的要求",
    "就可以",
    "我确认完再跟你说",
    "别弄错了",
    "我刚才没听太清楚",
]


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()


def batch_opencc(texts: list[str]) -> list[str]:
    script = r"""
const OpenCC = require('opencc-js/t2cn');
const conv = OpenCC.Converter({ from: 't', to: 'cn' });
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => buf += d);
process.stdin.on('end', () => {
  for (const line of buf.split('\n')) {
    process.stdout.write(conv(line) + '\n');
  }
});
"""
    if not texts:
        return []
    payload = "\n".join(nfkc(t) for t in texts) + "\n"
    proc = subprocess.run(
        ["node", "-e", script],
        input=payload,
        capture_output=True,
        text=True,
        cwd=str(ELECTRON),
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[:800])
    out = proc.stdout.split("\n")
    while len(out) > len(texts) and out[-1] == "":
        out.pop()
    if len(out) < len(texts):
        out.extend([nfkc(t) for t in texts[len(out) :]])
    return [x.strip() for x in out[: len(texts)]]


def pattern_key(text: str) -> str:
    t = _PUNCT.sub("", text)
    # collapse digits
    t = re.sub(r"[0-9０-９]+", "#", t)
    return t


def structural_signature(text: str) -> str:
    """Explainable near-dup signature: strip known frames + keep CJK skeleton length buckets."""
    t = text
    for fr in _FRAME_TAILS:
        t = t.replace(fr, "⟨F⟩")
    # replace common subject/time prefixes lightly
    for p in (
        "我现在",
        "我估计",
        "麻烦你",
        "应该",
        "好像",
        "看起来",
        "这两天",
        "等一下",
        "到时候",
        "之前",
        "今天",
        "公司",
        "家里",
        "他这边",
        "这边我觉得",
    ):
        if t.startswith(p):
            t = "⟨P⟩" + t[len(p) :]
            break
    t = _PUNCT.sub("", t)
    # keep only CJK + markers
    return t


def load_jsonl_gt(path: Path, key: str) -> set[str]:
    out = set()
    if not path.exists():
        return out
    raws = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = o.get(key) or o.get("ground_truth_text") or o.get("gt_text") or ""
            if t.strip():
                raws.append(t)
    for n in batch_opencc(raws):
        if n and _CJK.search(n):
            out.add(n)
    return out


def load_dialog200() -> set[str]:
    candidates = [
        REPO / "test wav/dialog_200/cases.manifest.json",
        REPO / "test_wav/dialog_200/cases.manifest.json",
        REPO / "electron_node/electron-node/tests/fixtures/dialog_200/cases.manifest.json",
    ]
    hits = [p for p in candidates if p.exists()]
    if not hits:
        # limited non-recursive search under known roots
        for root in (REPO / "test wav", REPO / "electron_node"):
            if not root.exists():
                continue
            hits.extend(root.glob("**/dialog_200/**/cases.manifest.json"))
            if hits:
                break
    texts = []
    for h in hits[:3]:
        data = json.loads(h.read_text(encoding="utf-8"))
        cases = data if isinstance(data, list) else data.get("cases") or data.get("items") or []
        for c in cases:
            t = c.get("expectedText") or c.get("referenceText") or c.get("gt") or c.get("text") or ""
            if t.strip():
                texts.append(t)
    return set(batch_opencc(texts)) if texts else set()


def load_existing_carrier_capped() -> set[str]:
    """Recompute prior certified pool (cap 30/carrier) for additive total."""
    from collections import Counter

    MAX = 30
    certified: dict[str, str] = {}
    carrier_credit: Counter[str] = Counter()

    def ingest(results: Path, plan: Path | None, sid: str, gt_key: str):
        plans = {}
        if plan and plan.exists():
            for r in (json.loads(l) for l in plan.open(encoding="utf-8") if l.strip()):
                plans[r.get("sample_plan_id")] = r
        rows = []
        for line in results.open(encoding="utf-8"):
            if not line.strip():
                continue
            r = json.loads(line)
            gt = r.get(gt_key) or r.get("ground_truth_text") or r.get("gt_text") or ""
            if not gt.strip():
                continue
            p = plans.get(r.get("sample_plan_id") or "", {})
            rows.append((gt, p.get("carrier_id") or ""))
        norms = batch_opencc([g for g, _ in rows])
        order = sorted(range(len(norms)), key=lambda i: hashlib.sha256(norms[i].encode()).hexdigest())
        for i in order:
            n = norms[i]
            if not n or not _CJK.search(n) or n in certified:
                continue
            cid = rows[i][1]
            if cid:
                if carrier_credit[cid] >= MAX:
                    continue
                carrier_credit[cid] += 1
            certified[n] = sid

    ingest(
        REPO / "training/model2/dataset/baseline_v1/results.jsonl",
        REPO / "training/model2/dataset/baseline_v1/generation_plan.jsonl",
        "baseline_v1",
        "ground_truth_text",
    )
    ingest(
        REPO / "training/model2/dataset/training_scale_v1/results.jsonl",
        REPO / "training/model2/dataset/training_scale_v1/plan.jsonl",
        "training_scale_v1",
        "gt_text",
    )
    ar = REPO / "training/model2/dataset/pseudo_user_accent_scale_v1/results.jsonl"
    if ar.exists():
        ingest(
            ar,
            REPO / "training/model2/dataset/pseudo_user_accent_scale_v1/generation_plan.jsonl",
            "accent_scale",
            "ground_truth_text",
        )
    return set(certified.keys())


def main():
    shards = sorted(SUPP.glob("model3_spoken_base_v1_*.csv"))
    assert len(shards) == 6, shards
    candidates = []
    for sh in shards:
        with sh.open(encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("source_type") != "LLM_SYNTHETIC_SPOKEN_BASE":
                    raise SystemExit(f"bad source_type {row}")
                if row.get("evidence_level") != "SYNTHETIC_TEXT":
                    raise SystemExit(f"bad evidence_level {row}")
                candidates.append(
                    {
                        "source_sentence_id": row["source_sentence_id"],
                        "text": row["text"],
                        "source_type": row["source_type"],
                        "evidence_level": row["evidence_level"],
                        "shard": sh.name,
                    }
                )
    assert len(candidates) == 18000, len(candidates)

    print("normalizing supplement…")
    norms = batch_opencc([c["text"] for c in candidates])
    for c, n in zip(candidates, norms):
        c["normalized"] = n

    print("loading existing pools…")
    existing_cert = load_existing_carrier_capped()
    print("  existing certified", len(existing_cert))
    baseline = load_jsonl_gt(
        REPO / "training/model2/dataset/baseline_v1/results.jsonl", "ground_truth_text"
    )
    scale = load_jsonl_gt(
        REPO / "training/model2/dataset/training_scale_v1/results.jsonl", "gt_text"
    )
    # scale may use ground_truth in some rows — also try plan
    if len(scale) < 1000:
        scale |= load_jsonl_gt(
            REPO / "training/model2/dataset/training_scale_v1/plan.jsonl", "gt_text"
        )
    accent = load_jsonl_gt(
        REPO / "training/model2/dataset/pseudo_user_accent_scale_v1/results.jsonl",
        "ground_truth_text",
    )
    d200 = load_dialog200()
    print("  baseline", len(baseline), "scale", len(scale), "accent", len(accent), "d200", len(d200))

    # exact dedup within new
    seen_new: set[str] = set()
    rejected = []
    survivors = []
    overlap_counts = Counter()

    for c in candidates:
        n = c["normalized"]
        reason = None
        if not n or not _CJK.search(n):
            reason = "empty_or_no_cjk"
        elif n in seen_new:
            reason = "exact_dup_within_new"
            overlap_counts["new_new"] += 1
        elif n in d200:
            reason = "dialog_200_contamination"
            overlap_counts["dialog_200"] += 1
        elif n in baseline:
            reason = "exact_overlap_baseline_v1"
            overlap_counts["baseline_v1"] += 1
        elif n in scale:
            reason = "exact_overlap_training_scale_v1"
            overlap_counts["training_scale_v1"] += 1
        elif n in accent:
            reason = "exact_overlap_accent_scale"
            overlap_counts["accent_scale"] += 1
        elif n in existing_cert:
            reason = "exact_overlap_existing_certified"
            overlap_counts["existing_certified"] += 1
        if reason:
            rejected.append({**c, "reject_reason": reason})
        else:
            seen_new.add(n)
            survivors.append(c)

    # near-duplicate: structural signature + edit-distance buckets via signature collision
    # Cap per structural signature (independent of carrier_id)
    MAX_PER_SIG = 8
    sig_credit: Counter[str] = Counter()
    accepted = []
    for c in sorted(survivors, key=lambda x: hashlib.sha256(x["normalized"].encode()).hexdigest()):
        sig = structural_signature(c["normalized"])
        # also pattern_key cluster
        pk = pattern_key(c["normalized"])
        if sig_credit[sig] >= MAX_PER_SIG:
            rejected.append({**c, "reject_reason": f"near_dup_structural_cap_{MAX_PER_SIG}"})
            overlap_counts["near_dup_structural"] += 1
            continue
        if sig_credit[f"pk:{pk}"] >= MAX_PER_SIG:
            rejected.append({**c, "reject_reason": f"near_dup_pattern_cap_{MAX_PER_SIG}"})
            overlap_counts["near_dup_pattern"] += 1
            continue
        # common prefix/suffix length with already accepted (sample O(n*k) limited)
        too_close = False
        for a in accepted[-200:]:  # local window for speed
            an = a["normalized"]
            cn = c["normalized"]
            if abs(len(an) - len(cn)) > 6:
                continue
            # longest common suffix/prefix
            pre = 0
            for x, y in zip(an, cn):
                if x == y:
                    pre += 1
                else:
                    break
            suf = 0
            for x, y in zip(reversed(an), reversed(cn)):
                if x == y:
                    suf += 1
                else:
                    break
            if pre >= 8 and suf >= 6 and len(cn) <= len(an) + 4:
                too_close = True
                break
            if suf >= 10 and pre >= 4:
                too_close = True
                break
        if too_close:
            rejected.append({**c, "reject_reason": "near_dup_prefix_suffix"})
            overlap_counts["near_dup_affix"] += 1
            continue
        sig_credit[sig] += 1
        sig_credit[f"pk:{pk}"] += 1
        accepted.append(c)

    total_certified = len(existing_cert | {a["normalized"] for a in accepted})
    # additive unique
    new_only = {a["normalized"] for a in accepted} - existing_cert
    total_v2 = len(existing_cert) + len(new_only)

    # human QA sample 500
    rng = random.Random(20260824)
    qa = accepted[:] if len(accepted) <= 500 else rng.sample(accepted, 500)

    # write outputs
    (OUT / "model3_spoken_base_supplement_v1_stats.json").write_text(
        json.dumps(
            {
                "dataset": "MODEL3_SPOKEN_BASE_SUPPLEMENT_V1",
                "candidate_rows": 18000,
                "source_type": "LLM_SYNTHETIC_SPOKEN_BASE",
                "evidence_level": "SYNTHETIC_TEXT",
                "spoken_like_class": "ACCEPT_WITH_LIMIT",
                "previous_certified": len(existing_cert),
                "new_accepted_unique": len(new_only),
                "new_rejected": len(rejected),
                "overlap_removed_counts": dict(overlap_counts),
                "near_dup_policy": {
                    "max_per_structural_signature": MAX_PER_SIG,
                    "max_per_pattern_key": MAX_PER_SIG,
                    "prefix_suffix_window": 200,
                },
                "total_certified_spoken_base": total_v2,
                "required_minimum": 15000,
                "BASE_CORPUS_GAP": total_v2 < 15000,
                "dialog_200_contamination": overlap_counts.get("dialog_200", 0),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    with (OUT / "model3_spoken_base_supplement_v1_overlap.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.writer(f)
        w.writerow(["pair", "exact_overlap_count"])
        for k, v in sorted(overlap_counts.items()):
            w.writerow([k, v])

    with (OUT / "model3_spoken_base_supplement_v1_rejected.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "source_sentence_id",
                "text",
                "normalized",
                "shard",
                "reject_reason",
                "source_type",
                "evidence_level",
            ],
        )
        w.writeheader()
        for r in rejected:
            w.writerow({k: r.get(k, "") for k in w.fieldnames})

    with (OUT / "model3_spoken_base_supplement_v1_human_qa_500.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "source_sentence_id",
                "text",
                "normalized",
                "shard",
                "review_natural_spoken",
                "review_structure_diverse",
                "review_mechanical",
                "review_comment",
            ],
        )
        w.writeheader()
        for a in qa:
            w.writerow(
                {
                    "source_sentence_id": a["source_sentence_id"],
                    "text": a["text"],
                    "normalized": a["normalized"],
                    "shard": a["shard"],
                    "review_natural_spoken": "",
                    "review_structure_diverse": "",
                    "review_mechanical": "",
                    "review_comment": "",
                }
            )

    # certified pool v2 list (ids)
    pool_path = OUT / "model3_certified_base_pool_v2.jsonl"
    with pool_path.open("w", encoding="utf-8") as f:
        for n in sorted(existing_cert):
            f.write(
                json.dumps(
                    {
                        "normalized": n,
                        "source": "prior_certified_v1",
                        "spoken_like_class": "ACCEPT_WITH_LIMIT",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
        for a in accepted:
            if a["normalized"] not in existing_cert:
                f.write(
                    json.dumps(
                        {
                            "normalized": a["normalized"],
                            "source_sentence_id": a["source_sentence_id"],
                            "source_type": a["source_type"],
                            "evidence_level": a["evidence_level"],
                            "shard": a["shard"],
                            "source": "MODEL3_SPOKEN_BASE_SUPPLEMENT_V1",
                            "spoken_like_class": "ACCEPT_WITH_LIMIT",
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )

    (OUT / "model3_certified_base_pool_v2_summary.json").write_text(
        json.dumps(
            {
                "previous_certified": len(existing_cert),
                "new_accepted": len(new_only),
                "new_rejected": len(rejected),
                "total_certified_spoken_base": total_v2,
                "required_minimum": 15000,
                "pass_ge_15000": total_v2 >= 15000,
                "dialog_200_contamination": overlap_counts.get("dialog_200", 0),
                "pool_jsonl": str(pool_path.relative_to(REPO)).replace("\\", "/"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # acceptance report
    (OUT / "model3_spoken_base_supplement_v1_acceptance_report.md").write_text(
        f"""# MODEL3_SPOKEN_BASE_SUPPLEMENT_V1 Acceptance Report

**Date:** 2026-08-24  
**Class:** `ACCEPT_WITH_LIMIT` (LLM_SYNTHETIC_SPOKEN_BASE — not real dialogue)

## Counts

| Metric | Value |
|--------|------:|
| Candidates | 18000 |
| New accepted unique | {len(new_only)} |
| New rejected | {len(rejected)} |
| Previous certified | {len(existing_cert)} |
| **Total certified** | **{total_v2}** |
| >=15000 | {"YES" if total_v2 >= 15000 else "NO"} |
| dialog_200 contamination | {overlap_counts.get("dialog_200", 0)} |

## Overlap / near-dup removals

```json
{json.dumps(dict(overlap_counts), ensure_ascii=False, indent=2)}
```

## Near-dup policy

- max {MAX_PER_SIG} per structural signature (discourse-frame stripped)
- max {MAX_PER_SIG} per digit/punct pattern key
- prefix/suffix affinity filter (local window)
- **No** blind carrier_id=30 cap (no carrier_id on supplement)

## Human QA

`model3_spoken_base_supplement_v1_human_qa_500.csv` — review columns blank (PENDING).

## Provenance

Accepted rows retain `source_sentence_id`, `source_type`, `evidence_level`, `shard` in `model3_certified_base_pool_v2.jsonl`.
""",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "previous": len(existing_cert),
                "new_accepted": len(new_only),
                "rejected": len(rejected),
                "total": total_v2,
                "ge_15k": total_v2 >= 15000,
                "d200": overlap_counts.get("dialog_200", 0),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
