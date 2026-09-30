import json

rows = []
with open(
    r"d:/Programs/github/lingua_1/docs/user_correction/model3/LINGUA_MODEL2_P_RETRIEVAL_EMPTY_HIT_CONTRAST_TRACE.jsonl",
    encoding="utf-8",
) as f:
    for line in f:
        rows.append(json.loads(line))

compact = []
for r in rows:
    executed = []
    for t in r.get("p_span_traces") or []:
        pr = t.get("p_retrieval") or {}
        if pr.get("status") != "EXECUTED":
            continue
        fs = t.get("finespan") or {}
        executed.append(
            {
                "source_text": fs.get("source_text"),
                "start": fs.get("start"),
                "end": fs.get("end"),
                "syllable_start": fs.get("syllable_start"),
                "syllable_end": fs.get("syllable_end"),
                "phonetic_representation": fs.get("phonetic_representation"),
                "tone_representation": fs.get("tone_representation"),
                "hit_count": pr.get("hit_count"),
                "toneReady": pr.get("toneRecallReadiness"),
                "queries": [
                    {
                        "action": q.get("action_id"),
                        "query": q.get("query"),
                        "pinyin_key": q.get("pinyin_key"),
                        "ready": q.get("toneRecallReadinessState"),
                        "hits": [
                            {"surface": h.get("surface"), "termId": h.get("termId")}
                            for h in (q.get("hits") or [])
                        ],
                    }
                    for q in (pr.get("queries") or [])
                ],
            }
        )
    compact.append(
        {
            "caseId": r["caseId"],
            "role": "POSITIVE" if r["caseId"] == "p2_u001_016" else "EMPTY",
            "referenceText": r["referenceText"],
            "frozenRawText": r["frozenRawText"],
            "evaluationTargetSurface": r["evaluationTargetSurface"],
            "targetInLexicon": r["targetInLexicon"],
            "relationFamily": r["relationFamily"],
            "relationDirection": r["relationDirection"],
            "phonetic_bias": r.get("phonetic_bias"),
            "summary": r.get("model2_summary_best"),
            "executed_p_spans": executed,
        }
    )

# Also load db verify for pinyin-only counts on executed keys
import sqlite3

db = sqlite3.connect(
    r"file:d:/Programs/github/lingua_1/node_runtime/lexicon/v3/lexicon.sqlite?mode=ro",
    uri=True,
)
c = db.cursor()

def pinyin_only(pk, n):
    return c.execute(
        "SELECT id, word, tone_pinyin_key, prior_score FROM base_lexicon "
        "WHERE pinyin_key=? AND enabled=1 AND length(word)=? ORDER BY prior_score DESC LIMIT 20",
        (pk, n),
    ).fetchall()

def word_rows(w):
    return c.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, enabled FROM base_lexicon WHERE word=? LIMIT 10",
        (w,),
    ).fetchall()

for item in compact:
    item["EXPECTED_TERM_PRESENT"] = len(word_rows(item["evaluationTargetSurface"])) > 0
    item["expected_term_rows"] = word_rows(item["evaluationTargetSurface"])
    for sp in item["executed_p_spans"]:
        for q in sp["queries"]:
            pk = q["pinyin_key"]
            n = len(q["query"] or [])
            rows_po = pinyin_only(pk, n)
            q["GENERATED_KEY_PINYIN_ONLY_ROW_COUNT"] = len(rows_po)
            q["pinyin_only_rows"] = [
                {"id": a, "word": b, "tone_pinyin_key": c2, "prior": d} for a, b, c2, d in rows_po
            ]
            # Classify firstZeroStage
            if q.get("ready") != "ready":
                q["firstZeroStage"] = "TONE_NOT_READY"
            elif q.get("hits"):
                q["firstZeroStage"] = None  # hit
            elif len(rows_po) == 0:
                q["firstZeroStage"] = "LEXICON_NO_PINYIN_LEN_MATCH"
            else:
                q["firstZeroStage"] = "TONE_EXACT_NO_HIT_DESPITE_PINYIN_ROWS"

db.close()

out_path = r"d:/Programs/github/lingua_1/docs/user_correction/model3/_p_empty_contrast_compact.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(compact, f, ensure_ascii=False, indent=2)
print("WROTE", out_path)
for item in compact:
    print("====", item["caseId"], item["evaluationTargetSurface"], item["summary"]["p_retrieval_status"] if item.get("summary") else None)
    print(" RAW:", item["frozenRawText"])
    print(" target rows:", item["expected_term_rows"])
    for sp in item["executed_p_spans"]:
        print(
            " SPAN",
            sp["source_text"],
            sp["start"],
            sp["end"],
            "phon",
            sp["phonetic_representation"],
            "tone",
            sp["tone_representation"],
            "hits",
            sp["hit_count"],
        )
        for q in sp["queries"]:
            print(
                "  ",
                q["action"],
                "->",
                q["pinyin_key"],
                "ready",
                q["ready"],
                "hits",
                q["hits"],
                "pinyinOnly",
                q["GENERATED_KEY_PINYIN_ONLY_ROW_COUNT"],
                "zero@",
                q["firstZeroStage"],
            )
