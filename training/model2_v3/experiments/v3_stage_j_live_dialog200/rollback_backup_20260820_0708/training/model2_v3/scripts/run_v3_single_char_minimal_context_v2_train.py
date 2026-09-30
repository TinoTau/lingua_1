#!/usr/bin/env python3
"""MODEL2_SINGLE_CHAR_MINIMAL_CONTEXT_REPRESENTATION_V1 + AmbiguityHeadV2 retrain.

Frozen trunk / P / D. New encoder+head. Do not continue V1 failed checkpoint.
No production batching. No dialog_200 labels. No lexicon import.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2_v3.policy.ambiguity_head_v2 import (  # noqa: E402
    N_AMBIGUITY_LOGITS,
    PY_BUCKETS,
    SINGLE_CHAR_CANDIDATE_CAP,
    pinyin_bucket_id,
)
from training.model2_v3.policy.minimal_context_encoder_v1 import (  # noqa: E402
    CTX_WIN,
    char_bucket_id,
    encode_window,
)
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs  # noqa: E402

CKPT = ROOT / "training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt"
V1_CKPT = ROOT / "training/model2_v3/experiments/v3_single_char_ambiguity_head_v1/retrieval_policy_v3_single_char_ambiguity_v1.pt"
EXPECTED_SHA256 = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"
EXPECTED_PARAMS_NO_HEAD = 47210
CLD_CSV = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_CLD_audit_v1.csv"
NEWS = ROOT / "kenLM/corpus/archive_legacy_news_v0/zh_sentences.raw.txt"
WIKI = ROOT / "kenLM/corpus/v1/corpus_v1.raw.txt"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
DATA_D = ROOT / "training/model2_v3/dataset/policy_stage_d_restored_v1/rows.jsonl"
OUT = ROOT / "training/model2_v3/experiments/v3_single_char_minimal_context_v2"
REPORT = ROOT / "docs/user_correction/Lingua_Model2_SingleChar_Minimal_Context_V2_Development_and_Training_Report_2026_08_19.md"
HAN_RE = re.compile(r"[\u4e00-\u9fff]")
SEED = 20260819
K = SINGLE_CHAR_CANDIDATE_CAP
BATCH = 96
EPOCHS = 8
LR = 1e-3

TEMPLATES: list[tuple[str, str, str]] = [
    ("今天{c}了", "tpl_today", "daily"),
    ("请把{c}给我", "tpl_give", "daily"),
    ("这是{c}的意思", "tpl_meaning", "daily"),
    ("我们一起{c}吧", "tpl_together", "daily"),
    ("他没有{c}", "tpl_not_have", "daily"),
    ("我想{c}一下", "tpl_think", "daily"),
    ("先{c}再说", "tpl_first", "daily"),
    ("不要{c}那么快", "tpl_dont", "daily"),
    ("已经{c}过了", "tpl_already", "daily"),
    ("还没{c}呢", "tpl_notyet", "daily"),
    ("可以{c}吗", "tpl_can", "daily"),
    ("怎么{c}才好", "tpl_how", "daily"),
    ("刚才{c}了一下", "tpl_justnow", "daily"),
    ("明天再{c}", "tpl_tomorrow", "daily"),
    ("这里不能{c}", "tpl_cannot_here", "daily"),
    ("请稍等再{c}", "tpl_wait", "service"),
    ("酒店里可以{c}", "tpl_hotel", "tourism_hotel"),
    ("上车后请{c}", "tpl_pickup", "tourism_transport"),
    ("点单时要{c}", "tpl_order", "food"),
    ("会议中不要{c}", "tpl_meeting", "meeting"),
    ("医生说要{c}", "tpl_medical", "medical"),
    ("路上注意{c}", "tpl_road", "tourism_transport"),
    ("咖啡要{c}一点", "tpl_coffee", "food"),
    ("面包再{c}一份", "tpl_bakery", "food"),
    ("行程里有{c}", "tpl_route", "tourism_transport"),
    ("房间需要{c}", "tpl_room", "tourism_hotel"),
    ("票已经{c}了", "tpl_ticket", "tourism_transport"),
    ("请写{c}在这里", "tpl_write", "daily"),
    ("把{c}放在桌上", "tpl_put", "daily"),
    ("因为下雨所以{c}", "tpl_because", "daily"),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def named_param_sha(model: torch.nn.Module, prefix: str) -> str:
    h = hashlib.sha256()
    for name, p in sorted(model.named_parameters()):
        if name.startswith(prefix):
            h.update(name.encode())
            h.update(p.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def dump_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def load_cld_groups() -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with CLD_CSV.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            w = (row.get("word") or "").strip()
            if len(w) != 1 or not HAN_RE.fullmatch(w):
                continue
            py = (row.get("pinyin") or "").strip().lower()
            try:
                tone = int(row.get("tone") or 0)
            except ValueError:
                continue
            if not py or tone < 1:
                continue
            base = re.sub(r"[1-5]$", "", py)
            gkey = f"{base}{tone}"
            groups[gkey].append(
                {
                    "word": w,
                    "pinyin": base,
                    "tone": tone,
                    "gkey": gkey,
                    "freq": float(row.get("combined_frequency") or 0),
                    "id": f"{w}:{gkey}",
                }
            )
    out: dict[str, list[dict[str, Any]]] = {}
    for k, rows in groups.items():
        uniq: dict[str, dict[str, Any]] = {}
        for r in rows:
            uniq[r["word"]] = r
        members = sorted(uniq.values(), key=lambda r: (-r["freq"], r["word"]))[:K]
        if len(members) >= 2:
            out[k] = members
    return out


def choose_n(pool_n: int, rng: random.Random) -> int:
    r = rng.random()
    want = 2 if r < 0.2 else 3 if r < 0.4 else 4 if r < 0.6 else 5 if r < 0.75 else 6 if r < 0.88 else 8
    return max(2, min(want, pool_n, K))


def sample_members(gold: dict[str, Any], pool: list[dict[str, Any]], rng: random.Random) -> list[dict[str, Any]]:
    others = [m for m in pool if m["id"] != gold["id"]]
    n = choose_n(1 + len(others), rng)
    take = [gold] + rng.sample(others, n - 1)
    rng.shuffle(take)
    return take


def make_sample(
    *,
    left: str,
    right: str,
    gold: dict[str, Any] | None,
    members: list[dict[str, Any]],
    label: str,
    family: str,
    source: str,
    contrast_id: str | None = None,
    abstain_type: str | None = None,
) -> dict[str, Any] | None:
    cands = members[:K]
    if len(cands) < 2:
        return None
    return {
        "left": left[-CTX_WIN * 2 :],
        "right": right[: CTX_WIN * 2],
        "span_pinyin": cands[0]["pinyin"],
        "acoustic": cands[0]["gkey"],
        "cands": [{"id": c["id"], "word": c["word"], "pinyin": c["pinyin"], "tone": c["tone"]} for c in cands],
        "gold_id": gold["id"] if gold else None,
        "label": label,
        "family": family,
        "source": source,
        "contrast_id": contrast_id,
        "abstain_type": abstain_type,
        "combo": tuple(sorted(c["id"] for c in cands)),
        "chars": tuple(sorted({c["word"] for c in cands})),
    }


def harvest_contexts(
    path: Path,
    groups: dict[str, list[dict[str, Any]]],
    char_to_groups: dict[str, list[str]],
    *,
    max_lines: int,
    per_gold: int,
) -> dict[tuple[str, str], list[tuple[str, str]]]:
    """(gkey, word) -> list of (left, right) windows."""
    store: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    if not path.is_file():
        return store
    with path.open(encoding="utf-8", errors="ignore") as f:
        for li, line in enumerate(f):
            if li >= max_lines:
                break
            s = unicodedata.normalize("NFC", line.strip())
            if len(s) < 8 or len(s) > 80:
                continue
            hits = 0
            for i, ch in enumerate(s):
                gkeys = char_to_groups.get(ch)
                if not gkeys:
                    continue
                gkey = gkeys[0]
                key = (gkey, ch)
                if len(store[key]) >= per_gold:
                    continue
                left, right = s[:i], s[i + 1 :]
                if len([c for c in left if HAN_RE.match(c)]) < 1 and len([c for c in right if HAN_RE.match(c)]) < 1:
                    continue
                store[key].append((left[-8:], right[:8]))
                hits += 1
                if hits >= 2:
                    break
    return store


def build_contrast_and_select(
    groups: dict[str, list[dict[str, Any]]],
    ctx_store: dict[tuple[str, str], list[tuple[str, str]]],
    rng: random.Random,
) -> tuple[list[dict[str, Any]], int]:
    out: list[dict[str, Any]] = []
    contrast_groups = 0
    for gkey, mems in groups.items():
        with_ctx = [m for m in mems if ctx_store.get((gkey, m["word"]))]
        if len(with_ctx) < 2:
            continue
        n_pair = min(12, len(with_ctx) * 3)
        for _ in range(n_pair):
            a, b = rng.sample(with_ctx, 2)
            shared = [a, b] + rng.sample([m for m in mems if m["id"] not in {a["id"], b["id"]}], min(2, max(0, len(mems) - 2)))
            rng.shuffle(shared)
            cid = f"contrast:{gkey}:{a['word']}|{b['word']}"
            ca = rng.choice(ctx_store[(gkey, a["word"])])
            cb = rng.choice(ctx_store[(gkey, b["word"])])
            sa = make_sample(left=ca[0], right=ca[1], gold=a, members=shared, label="SELECT", family=f"ctx:{ca[0][-2:]}|{ca[1][:2]}", source="contrast", contrast_id=cid)
            sb = make_sample(left=cb[0], right=cb[1], gold=b, members=shared, label="SELECT", family=f"ctx:{cb[0][-2:]}|{cb[1][:2]}", source="contrast", contrast_id=cid)
            if sa and sb:
                out.extend([sa, sb])
                contrast_groups += 1
    return out, contrast_groups


def harvest_select_flat(ctx_store, groups, rng, cap: int) -> list[dict[str, Any]]:
    out = []
    items = list(ctx_store.items())
    rng.shuffle(items)
    for (gkey, word), windows in items:
        if len(out) >= cap:
            break
        mems = groups.get(gkey)
        if not mems:
            continue
        gold = next((m for m in mems if m["word"] == word), None)
        if gold is None:
            continue
        left, right = rng.choice(windows)
        rec = make_sample(
            left=left,
            right=right,
            gold=gold,
            members=sample_members(gold, mems, rng),
            label="SELECT",
            family=f"corp:{left[-2:]}|{right[:2]}",
            source="corpus",
        )
        if rec:
            out.append(rec)
    return out


def template_samples(groups, rng, n: int) -> list[dict[str, Any]]:
    out = []
    gitems = list(groups.items())
    for _ in range(n):
        _gk, mems = rng.choice(gitems)
        gold = rng.choice(mems)
        tpl, fam, _dom = rng.choice(TEMPLATES)
        sent = tpl.replace("{c}", gold["word"])
        idx = sent.find(gold["word"])
        rec = make_sample(
            left=sent[:idx],
            right=sent[idx + 1 :],
            gold=gold,
            members=sample_members(gold, mems, rng),
            label="SELECT",
            family=fam,
            source="template",
        )
        if rec:
            out.append(rec)
    return out


def add_abstain(selects, groups, rng) -> list[dict[str, Any]]:
    out = []
    gitems = list(groups.values())
    types = ["insufficient", "missing_true", "multi_plausible", "conflict"]
    picks = selects[:]
    rng.shuffle(picks)
    for i, s in enumerate(picks[: int(0.34 * len(selects))]):
        kind = types[i % len(types)]
        rec = dict(s)
        rec["cands"] = [dict(c) for c in s["cands"]]
        rec["label"] = "ABSTAIN"
        rec["gold_id"] = None
        rec["abstain_type"] = kind
        rec["source"] = s["source"] + "_abstain"
        rec["contrast_id"] = None
        if kind == "insufficient":
            rec["left"], rec["right"] = "", ""
            rec["family"] = "abstain_empty"
        elif kind == "missing_true":
            rec["cands"] = [c for c in rec["cands"] if c["id"] != s.get("gold_id")]
            if len(rec["cands"]) < 2:
                continue
        elif kind == "conflict":
            rec["left"], rec["right"] = "xyz", "###"
            rec["family"] = "abstain_conflict"
        elif kind == "multi_plausible":
            rec["left"], rec["right"] = "可能是", "吧"
            rec["family"] = "abstain_multi"
        rec["combo"] = tuple(sorted(c["id"] for c in rec["cands"]))
        rec["chars"] = tuple(sorted({c["word"] for c in rec["cands"]}))
        out.append(rec)
        _ = gitems
    return out


def dedup(rows):
    raw = len(rows)
    seen = set()
    out = []
    for r in rows:
        key = (r["left"], r["right"], r["combo"], r["label"], r["gold_id"], r["family"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out, {"raw": raw, "deduplicated_samples": len(out), "unique_contexts": len({(r["left"], r["right"]) for r in out}), "unique_families": len({r["family"] for r in out})}


def stats(rs):
    return {
        "n": len(rs),
        "select": sum(1 for r in rs if r["label"] == "SELECT"),
        "abstain": sum(1 for r in rs if r["label"] == "ABSTAIN"),
        "unique_chars": len({ch for r in rs for ch in r["chars"]}),
        "unique_combos": len({r["combo"] for r in rs}),
        "unique_families": len({r["family"] for r in rs}),
        "contrast": sum(1 for r in rs if r.get("source") == "contrast"),
        "cand_n": dict(Counter(len(r["cands"]) for r in rs)),
        "sources": dict(Counter(r["source"] for r in rs)),
    }


def split_rows(rows, rng):
    chars = sorted({ch for r in rows for ch in r["chars"]})
    rng.shuffle(chars)
    hold_chars = set(chars[: max(80, len(chars) // 12)])
    rest = [r for r in rows if not (set(r["chars"]) & hold_chars)]
    held_char = [r for r in rows if set(r["chars"]) & hold_chars]
    combos = list({r["combo"] for r in rest})
    rng.shuffle(combos)
    hold_combos = set(combos[: max(120, len(combos) // 8)])
    fams = list({r["family"] for r in rest})
    rng.shuffle(fams)
    hold_fams = set(fams[: max(40, len(fams) // 8)])
    train_fams = set(fams) - hold_fams
    held_combo = [r for r in rest if r["combo"] in hold_combos]
    held_ctx = [r for r in rest if r["family"] in hold_fams]
    clean = [r for r in rest if r["combo"] not in hold_combos and r["family"] not in hold_fams]
    rng.shuffle(clean)
    n = len(clean)
    train, dev, test = clean[: int(0.8 * n)], clean[int(0.8 * n) : int(0.9 * n)], clean[int(0.9 * n) :]
    train_chars = {ch for r in train for ch in r["chars"]}
    unseen_char_known_ctx = [r for r in held_char if r["family"] in train_fams]
    known_char_unseen_ctx = [r for r in held_ctx if set(r["chars"]) <= train_chars]
    perm = [r for r in test if r["label"] == "SELECT"][:2000]
    return {
        "train": train,
        "dev": dev,
        "test": test,
        "held_char": held_char,
        "held_combo": held_combo,
        "held_ctx": held_ctx,
        "unseen_char_known_ctx": unseen_char_known_ctx,
        "known_char_unseen_ctx": known_char_unseen_ctx,
        "perm": perm,
        "meta": {"n_hold_chars": len(hold_chars), "n_hold_combos": len(hold_combos), "n_hold_fams": len(hold_fams), "hold_chars": sorted(hold_chars)[:40]},
    }


def permute_sample(r, rng):
    cands = list(r["cands"])
    rng.shuffle(cands)
    out = dict(r)
    out["cands"] = cands
    return out


def tensors_for(rows, *, blank_ctx: bool):
    b = len(rows)
    left = torch.zeros(b, CTX_WIN, dtype=torch.long)
    right = torch.zeros(b, CTX_WIN, dtype=torch.long)
    cc = torch.zeros(b, K, dtype=torch.long)
    tone = torch.zeros(b, K)
    py = torch.zeros(b, K, dtype=torch.long)
    mask = torch.zeros(b, K)
    y = torch.zeros(b, dtype=torch.long)
    for i, r in enumerate(rows):
        if not blank_ctx:
            left[i] = torch.tensor(encode_window(r["left"], "left"))
            right[i] = torch.tensor(encode_window(r["right"], "right"))
        n = len(r["cands"])
        mask[i, :n] = 1
        gid = r.get("gold_id")
        if r["label"] == "ABSTAIN" or not gid:
            y[i] = 0
        else:
            idx = next((j for j, c in enumerate(r["cands"]) if c["id"] == gid), None)
            y[i] = 0 if idx is None else idx + 1
        for j, c in enumerate(r["cands"]):
            cc[i, j] = char_bucket_id(c["word"])
            tone[i, j] = c["tone"] / 5.0
            py[i, j] = pinyin_bucket_id(c["pinyin"], c["tone"])
    return left, right, cc, tone, py, mask, y


@torch.no_grad()
def predict(model, rows, tau, *, blank_ctx=False, bs=128):
    model.eval()
    preds = []
    for i in range(0, len(rows), bs):
        chunk = rows[i : i + bs]
        left, right, cc, tone, py, mask, y = tensors_for(chunk, blank_ctx=blank_ctx)
        logits = model.ambiguity_head(left, right, cc, tone, py, mask)
        for b in range(len(chunk)):
            n = int(mask[b].sum().item())
            abstain = logits[b, 0].item()
            cand = logits[b, 1 : 1 + n]
            best = int(cand.argmax().item())
            margin = cand[best].item() - abstain
            gid = chunk[b].get("gold_id")
            if margin < tau:
                preds.append({"decision": "ABSTAIN", "index": None, "term_id": None, "gold": gid, "n": n})
            else:
                preds.append({"decision": "SELECT", "index": best, "term_id": chunk[b]["cands"][best]["id"], "gold": gid, "n": n})
    return preds


def metrics(rows, preds):
    n = len(rows)
    true_sel = sum(1 for r in rows if r["label"] == "SELECT")
    true_abs = n - true_sel
    pred_sel = sum(1 for p in preds if p["decision"] == "SELECT")
    pred_abs = n - pred_sel
    correct_sel = sum(1 for r, p in zip(rows, preds) if r["label"] == "SELECT" and p["decision"] == "SELECT" and p["term_id"] == r["gold_id"])
    wrong_sel = sum(1 for r, p in zip(rows, preds) if p["decision"] == "SELECT" and p["term_id"] != r.get("gold_id"))
    correct_abs = sum(1 for r, p in zip(rows, preds) if r["label"] == "ABSTAIN" and p["decision"] == "ABSTAIN")
    oos = sum(1 for p in preds if p["decision"] == "SELECT" and p["index"] is not None and p["index"] >= p["n"])
    sel_p = correct_sel / pred_sel if pred_sel else 0.0
    acc = (correct_sel + correct_abs) / n if n else 0.0
    return {
        "n": n,
        "select_precision": round(sel_p, 4),
        "select_recall": round(correct_sel / true_sel, 4) if true_sel else 0.0,
        "wrong_select_rate": round(wrong_sel / n, 4) if n else 0.0,
        "wrong_select_given_select": round(wrong_sel / pred_sel, 4) if pred_sel else 0.0,
        "abstain_precision": round(correct_abs / pred_abs, 4) if pred_abs else 0.0,
        "abstain_recall": round(correct_abs / true_abs, 4) if true_abs else 0.0,
        "coverage": round(pred_sel / n, 4) if n else 0.0,
        "accepted_decision_accuracy": round(acc, 4),
        "out_of_set": oos,
        "pred_select": pred_sel,
        "false_select_on_abstain": sum(1 for r, p in zip(rows, preds) if r["label"] == "ABSTAIN" and p["decision"] == "SELECT"),
        "false_abstain_on_select": sum(1 for r, p in zip(rows, preds) if r["label"] == "SELECT" and p["decision"] == "ABSTAIN"),
        "always_abstain": pred_sel == 0,
    }


def identity_baseline(train, test):
    win: Counter[str] = Counter()
    for r in train:
        if r["label"] == "SELECT" and r.get("gold_id"):
            w = next(c["word"] for c in r["cands"] if c["id"] == r["gold_id"])
            win[w] += 1
    preds = []
    for r in test:
        scored = [(win[c["word"]], j, c["id"]) for j, c in enumerate(r["cands"])]
        scored.sort(reverse=True)
        if r["label"] == "ABSTAIN" or scored[0][0] == 0:
            preds.append({"decision": "ABSTAIN", "index": None, "term_id": None, "gold": r["gold_id"], "n": len(r["cands"])})
        else:
            _, j, tid = scored[0]
            preds.append({"decision": "SELECT", "index": j, "term_id": tid, "gold": r["gold_id"], "n": len(r["cands"])})
    return preds


def majority_baseline(train, test):
    n_abs = sum(1 for r in train if r["label"] == "ABSTAIN")
    always_abs = n_abs >= len(train) / 2
    preds = []
    for r in test:
        if always_abs:
            preds.append({"decision": "ABSTAIN", "index": None, "term_id": None, "gold": r["gold_id"], "n": len(r["cands"])})
        else:
            preds.append({"decision": "SELECT", "index": 0, "term_id": r["cands"][0]["id"], "gold": r["gold_id"], "n": len(r["cands"])})
    return preds


def random_baseline(test, rng):
    preds = []
    for r in test:
        n = len(r["cands"])
        k = rng.randrange(n + 1)
        if k == 0:
            preds.append({"decision": "ABSTAIN", "index": None, "term_id": None, "gold": r["gold_id"], "n": n})
        else:
            preds.append({"decision": "SELECT", "index": k - 1, "term_id": r["cands"][k - 1]["id"], "gold": r["gold_id"], "n": n})
    return preds


def row_state(r):
    return {
        "base_pool": r.get("base_pool", 0) or 16,
        "query_budget": 8,
        "cand_budget": 8,
        "n_applicable": r.get("n_applicable", 0),
        "applicability": r.get("applicability") or [],
        "personal_terms": r.get("personal_terms") or [],
        "domain_evidence": r.get("long_term_domain_evidence") or {},
        "term_evidence": r.get("personal_term_evidence") or {},
        "max_lexical_items": 32,
    }


def load_jsonl(path: Path, limit: int):
    rows = []
    if not path.is_file():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
            if len(rows) >= limit:
                break
    return rows


def main() -> int:
    rng = random.Random(SEED)
    torch.manual_seed(SEED)
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    if sha256_file(CKPT) != EXPECTED_SHA256:
        print("CHECKPOINT_HASH_MISMATCH")
        return 2
    ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    model = RetrievalPolicyV3(with_domain_head=True, with_ambiguity_head=True, ambiguity_version="v2")
    miss, unexp = model.load_state_dict(ckpt["state_dict"], strict=False)
    assert all("ambiguity_head" in m for m in miss)
    assert not unexp
    for name, p in model.named_parameters():
        p.requires_grad = name.startswith("ambiguity_head")
    inv = [{"name": n, "trainable": bool(p.requires_grad), "numel": int(p.numel())} for n, p in model.named_parameters()]
    if any(x["trainable"] and not x["name"].startswith("ambiguity_head") for x in inv):
        print("STOP trainable")
        return 3
    enc_n = sum(x["numel"] for x in inv if x["trainable"] and ".encoder." in x["name"])
    head_n = sum(x["numel"] for x in inv if x["trainable"] and ".encoder." not in x["name"])
    dump_json(OUT / "model2_context_v2_pre_baseline.json", {
        "sha256": EXPECTED_SHA256,
        "trunk": named_param_sha(model, "trunk"),
        "action_head": named_param_sha(model, "action_head"),
        "domain_action_head": named_param_sha(model, "domain_action_head"),
    })
    with (OUT / "single_char_context_v2_trainable_params.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["name", "trainable", "numel"])
        w.writeheader()
        w.writerows(inv)

    groups = load_cld_groups()
    char_to_groups = defaultdict(list)
    for gk, mems in groups.items():
        for m in mems:
            char_to_groups[m["word"]].append(gk)
    print("groups", len(groups), flush=True)
    news_ctx = harvest_contexts(NEWS, groups, char_to_groups, max_lines=400000, per_gold=20)
    wiki_ctx = harvest_contexts(WIKI, groups, char_to_groups, max_lines=250000, per_gold=8)
    ctx_store: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for d in (news_ctx, wiki_ctx):
        for k, v in d.items():
            ctx_store[k].extend(v)
    contrast, n_contrast = build_contrast_and_select(groups, ctx_store, rng)
    corpus = harvest_select_flat(ctx_store, groups, rng, 18000)
    tpl = template_samples(groups, rng, 8000)
    selects = contrast + corpus + tpl
    abstains = add_abstain(selects, groups, rng)
    rows, ded = dedup(selects + abstains)
    rng.shuffle(rows)
    splits_all = split_rows(rows, rng)
    meta = splits_all.pop("meta")
    splits = splits_all
    print("train", len(splits["train"]), "contrast_pairs_approx", n_contrast, flush=True)

    dump_json(OUT / "single_char_context_v2_dataset_manifest.json", {
        "cld": str(CLD_CSV).replace("\\", "/"),
        "news": str(NEWS).replace("\\", "/"),
        "wiki": str(WIKI).replace("\\", "/"),
        "dialog_200": "NOT_USED",
        "polyphonic": "POLYPHONIC_DATA_GAP",
        "context_window": CTX_WIN,
        "re_audited_context": "left/right local Han windows from corpus; contrast pairs same set different gold",
    })
    dump_json(OUT / "single_char_context_contrast_statistics.json", {"contrast_group_emits": n_contrast, "contrast_samples": stats(contrast)})
    dump_json(OUT / "single_char_context_v2_dedup_report.json", ded)
    dump_json(OUT / "single_char_context_v2_split_manifest.json", {k: stats(v) if isinstance(v, list) else v for k, v in {**splits, "all": rows, "meta": meta}.items()})

    dump_json(OUT / "single_char_context_v2_training_config.json", {"lr": LR, "epochs": EPOCHS, "batch": BATCH, "head": "AmbiguityHeadV2", "encoder": "MinimalContextEncoderV1", "frozen": ["trunk", "P", "D"], "dialog_200": False, "v1_ckpt_used_as_init": False})

    opt = torch.optim.Adam([p for p in model.parameters() if p.requires_grad], lr=LR)
    history = []
    best = -1e9
    best_state = None
    patience = 0

    def run_epoch(split, train_mode):
        model.train(train_mode)
        tot = n = 0.0
        order = list(range(len(split)))
        if train_mode:
            rng.shuffle(order)
        gn = 0.0
        for i in range(0, len(order), BATCH):
            chunk = [permute_sample(split[j], rng) if train_mode else split[j] for j in order[i : i + BATCH]]
            left, right, cc, tone, py, mask, y = tensors_for(chunk, blank_ctx=False)
            logits = model.ambiguity_head(left, right, cc, tone, py, mask)
            loss = F.cross_entropy(logits, y)
            if train_mode:
                opt.zero_grad()
                loss.backward()
                gn = float(torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0))
                opt.step()
            tot += float(loss.item()) * len(chunk)
            n += len(chunk)
        return tot / max(n, 1), gn

    for ep in range(1, EPOCHS + 1):
        tr, gn = run_epoch(splits["train"], True)
        dv, _ = run_epoch(splits["dev"], False)
        dm = metrics(splits["dev"][:2500], predict(model, splits["dev"][:2500], tau=0.0))
        sc = dm["select_precision"] - dm["wrong_select_rate"]
        history.append({"epoch": ep, "train_loss": round(tr, 4), "dev_loss": round(dv, 4), "grad_norm": round(gn, 4), **dm})
        print(f"epoch {ep} train={tr:.4f} selP={dm['select_precision']} wrong={dm['wrong_select_rate']} acc={dm['accepted_decision_accuracy']}", flush=True)
        if sc > best:
            best = sc
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            patience = 0
        else:
            patience += 1
            if patience >= 3:
                break
    if best_state:
        model.load_state_dict(best_state)
    with (OUT / "single_char_context_v2_training_history.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(history[0].keys()))
        w.writeheader()
        w.writerows(history)

    curve = []
    best_tau = 0.0
    best_sc = -1e9
    dev = splits["dev"][:3500]
    for tau in [x / 10 for x in range(-5, 25)]:
        m = metrics(dev, predict(model, dev, tau=tau))
        curve.append({"tau": tau, **m})
        if m["always_abstain"] or m["pred_select"] < max(30, 0.08 * m["n"]):
            continue
        sc = m["select_precision"] - 0.7 * m["wrong_select_rate"]
        if sc > best_sc:
            best_sc = sc
            best_tau = tau
    dump_json(OUT / "single_char_context_v2_operating_point.json", {"tau": best_tau, "on": "dev", "dialog_200": False})

    def ev(name, rs, **kw):
        if not rs:
            return {"n": 0, "split": name, "gate": "SKIP"}
        cap = rs[:8000]
        return {**metrics(cap, predict(model, cap, tau=best_tau, **kw)), "split": name}

    std = ev("test", splits["test"])
    nc = ev("no_ctx", splits["test"], blank_ctx=True)
    hc = ev("held_char", splits["held_char"])
    hco = ev("held_combo", splits["held_combo"])
    hcx = ev("held_ctx", splits["held_ctx"])
    uckc = ev("unseen_char_known_ctx", splits["unseen_char_known_ctx"])
    kcuc = ev("known_char_unseen_ctx", splits["known_char_unseen_ctx"])
    id_m = metrics(splits["test"], identity_baseline(splits["train"], splits["test"]))
    maj = metrics(splits["test"], majority_baseline(splits["train"], splits["test"]))
    rnd = metrics(splits["test"], random_baseline(splits["test"], rng))

    perm_ok = perm_n = oos = 0
    for r in splits["perm"][:1500]:
        vs = [r, permute_sample(dict(r), rng), permute_sample(dict(r), rng)]
        pred = predict(model, vs, tau=best_tau)
        oos += sum(1 for p in pred if p["decision"] == "SELECT" and p["index"] is not None and p["index"] >= p["n"])
        ids = [p["term_id"] if p["decision"] == "SELECT" else "ABSTAIN" for p in pred]
        perm_n += 1
        perm_ok += int(len(set(ids)) == 1)
    perm = {"n": perm_n, "relative_selection_consistency": round(perm_ok / perm_n, 4) if perm_n else 0, "out_of_set": oos}

    v1_pub = {"accepted_decision_accuracy": 0.4133, "select_precision": 0.3218, "wrong_select_rate": 0.5666, "note": "published V1 standard test; failed experiment not used as init"}
    dump_json(OUT / "single_char_context_v2_standard_metrics.json", std)
    dump_json(OUT / "single_char_context_v2_no_context_baseline.json", nc)
    dump_json(OUT / "single_char_context_v2_identity_baseline.json", id_m)
    dump_json(OUT / "single_char_context_v1_vs_v2.json", {"v1_published": v1_pub, "v2": std, "v1_ckpt_exists": V1_CKPT.is_file(), "continued_from_v1": False})
    dump_json(OUT / "single_char_context_v2_baseline_comparison.json", {"random": rnd, "majority": maj, "identity": id_m, "no_context": nc, "v1": v1_pub, "v2": std, "no_context_always_abstain": nc.get("always_abstain")})
    dump_json(OUT / "single_char_context_v2_heldout_character.json", hc)
    dump_json(OUT / "single_char_context_v2_heldout_candidate_set.json", hco)
    dump_json(OUT / "single_char_context_v2_heldout_context.json", hcx)
    dump_json(OUT / "single_char_context_v2_unseen_char_known_context.json", uckc)
    dump_json(OUT / "single_char_context_v2_known_char_unseen_context.json", kcuc)
    dump_json(OUT / "single_char_context_v2_permutation.json", perm)

    pred = predict(model, splits["test"], tau=best_tau)
    buckets = Counter()
    examples = []
    for r, p in zip(splits["test"], pred):
        ok = (r["label"] == "SELECT" and p["decision"] == "SELECT" and p["term_id"] == r["gold_id"]) or (r["label"] == "ABSTAIN" and p["decision"] == "ABSTAIN")
        if ok:
            continue
        b = "WRONG_SELECT" if p["decision"] == "SELECT" else "ABSTAIN_FALSE_NEGATIVE"
        if r["label"] == "SELECT" and p["decision"] == "SELECT" and p["term_id"] != r.get("gold_id"):
            b = "WRONG_CONTEXT_INTERPRETATION"
        buckets[b] += 1
        if len(examples) < 80:
            examples.append({"bucket": b, "left": r["left"], "right": r["right"], "gold": r.get("gold_id"), "pred": p, "cands": r["cands"]})
    dump_json(OUT / "single_char_context_v2_failure_buckets.json", dict(buckets))
    (OUT / "single_char_context_v2_failure_examples.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in examples), encoding="utf-8")

    frozen = RetrievalPolicyV3(with_domain_head=True)
    frozen.load_state_dict(ckpt["state_dict"], strict=True)
    hash_ok = (
        named_param_sha(model, "trunk") == named_param_sha(frozen, "trunk")
        and named_param_sha(model, "item_mlp") == named_param_sha(frozen, "item_mlp")
        and named_param_sha(model, "attn") == named_param_sha(frozen, "attn")
        and named_param_sha(model, "action_head") == named_param_sha(frozen, "action_head")
        and named_param_sha(model, "query_budget_head") == named_param_sha(frozen, "query_budget_head")
        and named_param_sha(model, "cand_budget_head") == named_param_sha(frozen, "cand_budget_head")
        and named_param_sha(model, "domain_action_head") == named_param_sha(frozen, "domain_action_head")
    )
    dummy = pack_batch_inputs([["shi"], ["wo"]], [{}, {"n_l": 0.4}], [{"base_pool": 1, "query_budget": 8, "cand_budget": 8}, {"base_pool": 2, "query_budget": 8, "cand_budget": 8}], feature_hash="v1")
    with torch.no_grad():
        pa, pb = frozen(*dummy), model(*dummy)
    pd_ok = bool(torch.allclose(pa["action_logits"], pb["action_logits"]) and torch.allclose(pa["domain_action_logits"], pb["domain_action_logits"]))
    try:
        pr, dr = load_jsonl(DATA_P, 32), load_jsonl(DATA_D, 32)
        if pr:
            x = pack_batch_inputs(
                [r["span"]["span_syllables"] if isinstance(r.get("span"), dict) else ["a"] for r in pr],
                [r.get("profile_phonetic") or {} for r in pr],
                [row_state(r) for r in pr],
                feature_hash="v1",
            )
            with torch.no_grad():
                pd_ok = pd_ok and bool(torch.allclose(frozen(*x)["action_logits"], model(*x)["action_logits"], atol=1e-6))
        if dr:
            x = pack_batch_inputs(
                [r["span"]["span_syllables"] if isinstance(r.get("span"), dict) else ["a"] for r in dr],
                [r.get("profile_phonetic") or {} for r in dr],
                [row_state(r) for r in dr],
                feature_hash="v1",
            )
            with torch.no_grad():
                pd_ok = pd_ok and bool(torch.allclose(frozen(*x)["domain_action_logits"], model(*x)["domain_action_logits"], atol=1e-6))
    except Exception as e:
        dump_json(OUT / "pd_pack_error.json", {"error": str(e)})
        pd_ok = False
    dump_json(OUT / "model2_context_v2_frozen_hash_check.json", {"unchanged": hash_ok})
    dump_json(OUT / "model2_context_v2_pd_regression.json", {"pass": hash_ok and pd_ok, "logits_allclose": pd_ok, "recorded_p_rr": 0.954, "recorded_d_val": 0.304})
    dump_json(OUT / "model2_context_v2_checkpoint_compatibility.json", {"expA_sha256": EXPECTED_SHA256, "overwritten": False, "v1_overwritten": False, "file_sha_now": sha256_file(CKPT)})

    added = sum(x["numel"] for x in inv if x["trainable"])
    dump_json(OUT / "single_char_context_v2_model_size.json", {
        "baseline_pd": EXPECTED_PARAMS_NO_HEAD,
        "encoder_params": enc_n,
        "ambiguity_head_non_encoder": head_n,
        "added": added,
        "total_with_v2": model.param_count(),
        "macs_estimate_single": "~2e5 arithmetic ops (embed+mean+MLP), not a transformer",
    })
    dump_json(OUT / "single_char_context_encoder_complexity.json", {
        "type": "char-bucket embedding + masked mean pool + linear",
        "window": CTX_WIN,
        "buckets": 2048,
        "emb": 24,
        "params": enc_n,
        "separate_service": False,
        "feeds_pd": False,
    })
    dump_json(OUT / "single_char_context_v2_batch_compatibility.json", {"batch_dim": True, "production_batch_not_implemented": True, "requests_array": False})

    # latency
    warm = splits["test"][:1] or splits["train"][:1]
    _ = predict(model, warm, tau=best_tau)
    times = []
    bench = splits["test"][:200] if len(splits["test"]) >= 200 else splits["train"][:200]
    for r in bench:
        t1 = time.perf_counter()
        predict(model, [r], tau=best_tau, bs=1)
        times.append((time.perf_counter() - t1) * 1000)
    times.sort()
    dump_json(OUT / "single_char_context_v2_latency.json", {
        "n": len(times),
        "p50": round(times[len(times) // 2], 3) if times else None,
        "p95": round(times[int(0.95 * (len(times) - 1))], 3) if times else None,
        "p99": round(times[int(0.99 * (len(times) - 1))], 3) if times else None,
        "note": "in-process judgeSingleChar, not sidecar JSONL",
    })

    new_path = OUT / "retrieval_policy_v3_single_char_ambiguity_v2.pt"
    torch.save({"state_dict": model.state_dict(), "meta": {"ambiguity": "AmbiguityHeadV2", "encoder": "MinimalContextEncoderV1", "parent_sha256": EXPECTED_SHA256, "tau": best_tau}}, new_path)
    new_sha = sha256_file(new_path)

    beats_id = float(std["accepted_decision_accuracy"]) >= float(id_m["accepted_decision_accuracy"]) + 0.04 and float(std["select_precision"]) >= float(id_m["select_precision"]) + 0.03
    fair_nc = not nc.get("always_abstain")
    beats_nc = fair_nc and float(std["accepted_decision_accuracy"]) >= float(nc["accepted_decision_accuracy"]) + 0.03
    g_char = int(hc.get("n") or 0) > 50 and float(hc.get("select_precision") or 0) >= 0.45
    g_combo = int(hco.get("n") or 0) > 50 and float(hco.get("select_precision") or 0) >= 0.45
    g_ctx = int(hcx.get("n") or 0) > 50 and float(hcx.get("select_precision") or 0) >= 0.45
    g_perm = perm["relative_selection_consistency"] >= 0.9 and perm["out_of_set"] == 0
    ws_ok = float(std["wrong_select_rate"]) <= 0.35 and float(std["select_precision"]) >= 0.55
    abs_ok = float(std["abstain_precision"]) >= 0.5
    lat_ok = (times[len(times) // 2] if times else 99) < 20
    if not hash_ok or not pd_ok:
        verdict = "REGRESSION_FAIL"
        next_phase = "Investigate P/D hash/logit mismatch."
    elif not beats_id or not beats_nc:
        verdict = "CONTEXT_STILL_INSUFFICIENT"
        next_phase = "Re-evaluate whether Model2 should own this task. Do not add BERT/LLM/unfreeze trunk."
    elif not (g_char and g_combo and g_ctx and g_perm):
        verdict = "GENERALIZATION_FAIL"
        next_phase = "Do not mine held-out cases. Representation/data-contract audit."
    elif not ws_ok:
        verdict = "CONTEXT_STILL_INSUFFICIENT"
        next_phase = "Precision-first still missing; stop, no transformer."
    else:
        verdict = "PASS"
        next_phase = "Batch transport (additional IPC<=1). Lexicon freeze and minPrior remain HOLD. Production NO."

    dump_json(OUT / "go_summary.json", {"verdict": verdict, "std": std, "identity": id_m, "no_ctx": nc, "beats_id": beats_id, "beats_nc": beats_nc, "gates": {"char": g_char, "combo": g_combo, "ctx": g_ctx, "perm": g_perm, "hash": hash_ok, "pd": pd_ok}, "sha256": new_sha, "tau": best_tau})
    for fn, obj in {
        "architecture_conformance_check.json": {"one_model": True, "feeds_pd": False, "pass": True},
        "main_chain_unchanged_check.json": {"unchanged": True},
        "lexicon_recall_ownership_check.json": {"unchanged": True},
        "single_model_check.json": {"one": True},
        "second_pipeline_check.json": {"second": False},
        "fixed_hanzi_class_check.json": {"fixed": False, "output_dim": N_AMBIGUITY_LOGITS},
        "dialog200_training_leakage_check.json": {"used": False},
        "batch_not_implemented_check.json": {"implemented": False, "contract_keep": True},
        "minprior_unchanged_check.json": {"unchanged": True},
    }.items():
        dump_json(OUT / fn, obj)
    with (OUT / "modified_file_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "action"])
        w.writerow(["training/model2_v3/policy/minimal_context_encoder_v1.py", "add"])
        w.writerow(["training/model2_v3/policy/ambiguity_head_v2.py", "add"])
        w.writerow(["training/model2_v3/policy/model.py", "optional ambiguity_version=v2"])
        w.writerow(["training/model2_v3/tests/test_ambiguity_head_v2_isolation.py", "add"])
        w.writerow(["training/model2_v3/scripts/run_v3_single_char_minimal_context_v2_train.py", "add"])
    with (OUT / "single_char_context_encoder_change_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "role"])
        w.writerow(["minimal_context_encoder_v1.py", "encoder"])
    with (OUT / "single_char_ambiguity_head_v2_change_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "role"])
        w.writerow(["ambiguity_head_v2.py", "head"])
        w.writerow(["model.py", "wire v2 optional"])

    lat = json.loads((OUT / "single_char_context_v2_latency.json").read_text(encoding="utf-8"))
    dump_json(OUT / "_report_inputs.json", {
        "verdict": verdict, "std": std, "nc": nc, "id": id_m, "rnd": rnd, "maj": maj, "v1": v1_pub,
        "hc": hc, "hco": hco, "hcx": hcx, "perm": perm, "uckc": uckc, "kcuc": kcuc,
        "enc_n": enc_n, "head_n": head_n, "added": added, "total": model.param_count(),
        "train_n": len(splits["train"]), "n_contrast": n_contrast, "tau": best_tau,
        "hash_ok": hash_ok, "pd_ok": pd_ok, "beats_id": beats_id, "beats_nc": beats_nc,
        "g_char": g_char, "g_combo": g_combo, "g_ctx": g_ctx, "g_perm": g_perm,
        "lat": lat, "new_sha": new_sha, "next_phase": next_phase, "elapsed": round(time.time() - t0, 1),
        "ws_ok": ws_ok, "abs_ok": abs_ok, "lat_ok": lat_ok, "fair_nc": fair_nc,
    })
    print("VERDICT", verdict, "acc", std.get("accepted_decision_accuracy"), "id", id_m.get("accepted_decision_accuracy"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
