import sqlite3, json, sys

db = sqlite3.connect(
    r"file:d:/Programs/github/lingua_1/node_runtime/lexicon/v3/lexicon.sqlite?mode=ro",
    uri=True,
)
c = db.cursor()

def q_exact(pk, tk, n):
    return c.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, prior_score FROM base_lexicon "
        "WHERE pinyin_key=? AND tone_pinyin_key=? AND enabled=1 AND length(word)=? "
        "ORDER BY prior_score DESC LIMIT 15",
        (pk, tk, n),
    ).fetchall()

def q_pinyin(pk, n):
    return c.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, prior_score FROM base_lexicon "
        "WHERE pinyin_key=? AND enabled=1 AND length(word)=? "
        "ORDER BY prior_score DESC LIMIT 15",
        (pk, n),
    ).fetchall()

def q_word(w):
    return c.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, enabled, prior_score FROM base_lexicon WHERE word=? LIMIT 10",
        (w,),
    ).fetchall()

# Load TRACE
rows = []
with open(
    r"d:/Programs/github/lingua_1/docs/user_correction/model3/LINGUA_MODEL2_P_RETRIEVAL_EMPTY_HIT_CONTRAST_TRACE.jsonl",
    encoding="utf-8",
) as f:
    for line in f:
        rows.append(json.loads(line))

out = []
for r in rows:
    case = {
        "caseId": r["caseId"],
        "target": r["evaluationTargetSurface"],
        "targetRows": q_word(r["evaluationTargetSurface"]),
        "relationFamily": r["relationFamily"],
        "raw": r["frozenRawText"],
        "summary": {
            "p_status": (r.get("model2_summary_best") or {}).get("p_retrieval_status"),
            "p_hits": (r.get("model2_summary_best") or {}).get("p_retrieval_hit_count"),
            "p_added": (r.get("model2_summary_best") or {}).get("p_added"),
            "toneReady": (r.get("model2_summary_best") or {}).get("toneRecallReadiness"),
            "actions": (r.get("model2_summary_best") or {}).get("selected_action_ids"),
        },
        "spanQueries": [],
    }
    for t in r.get("p_span_traces") or []:
        fs = t.get("finespan") or {}
        pr = t.get("p_retrieval") or {}
        # reconstruct window text if possible
        span_entry = {
            "finespan": fs,
            "p_status": pr.get("status"),
            "hit_count": pr.get("hit_count"),
            "tonePresent": pr.get("acousticTonePattern_present"),
            "toneReady": pr.get("toneRecallReadiness"),
            "queries": [],
        }
        for q in pr.get("queries") or []:
            pk = q.get("pinyin_key")
            syls = q.get("query") or []
            n = len(syls)
            pinyin_rows = q_pinyin(pk, n) if pk else []
            # Without exact tone key in TRACE, report all tones for this pinyin+len
            span_entry["queries"].append(
                {
                    "action": q.get("action_id"),
                    "query": syls,
                    "pinyin_key": pk,
                    "ready": q.get("toneRecallReadinessState"),
                    "hits_runtime": [h.get("surface") for h in (q.get("hits") or [])],
                    "GENERATED_KEY_PINYIN_ONLY_ROW_COUNT": len(pinyin_rows),
                    "pinyinOnlyRows": pinyin_rows,
                }
            )
        if span_entry["queries"] or pr:
            case["spanQueries"].append(span_entry)
    out.append(case)

# Extra: check multi-syllable hypothesized keys for targets
extra = {
    "li|bin|bu": q_pinyin("li|bin|bu", 3),
    "nai|jing": q_pinyin("nai|jing", 2),
    "ka|fei|shi": q_pinyin("ka|fei|shi", 3),
    "ying|yun|zheng": q_pinyin("ying|yun|zheng", 3),
    "sheng|cheng": q_pinyin("sheng|cheng", 2),
    "huan|cheng": q_pinyin("huan|cheng", 2),
    "nei|chu|li": q_pinyin("nei|chu|li", 3),
    "ni": q_pinyin("ni", 1),
    "nai": q_pinyin("nai", 1),
    "jin": q_pinyin("jin", 1),
    "shi": q_pinyin("shi", 1),
    "zheng": q_pinyin("zheng", 1),
    "cheng": q_pinyin("cheng", 1),
    "han": q_pinyin("han", 1),
    "nei": q_pinyin("nei", 1),
    "min": q_pinyin("min", 1),
}

print(json.dumps({"cases": out, "extraPinyinCoverage": extra}, ensure_ascii=False, indent=2))
db.close()
