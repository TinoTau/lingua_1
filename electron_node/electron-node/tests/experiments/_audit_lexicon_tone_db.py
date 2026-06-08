import json
import sqlite3
from pathlib import Path

ROOT = Path(r"D:\Programs\github\lingua_1")
DB = ROOT / "node_runtime/lexicon/v3/lexicon.sqlite"
MANIFEST = ROOT / "node_runtime/lexicon/v3/manifest.json"

def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    conn = sqlite3.connect(DB)
    out = {
        "manifest": {
            "buildTime": manifest.get("buildTime"),
            "checksum": manifest.get("checksum"),
            "tables": manifest.get("tables"),
        },
        "tables": {},
        "spotChecks": [],
    }
    for table in ["base_lexicon", "idiom_lexicon", "domain_lexicon"]:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        has_tone = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE tone_pinyin_key IS NOT NULL AND tone_pinyin_key != ''"
        ).fetchone()[0]
        with_digits = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE tone_pinyin_key GLOB '*[0-9]*' AND tone_pinyin_key != pinyin_key"
        ).fetchone()[0]
        eq_plain = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE tone_pinyin_key = pinyin_key"
        ).fetchone()[0]
        out["tables"][table] = {
            "total": total,
            "has_tone_key": has_tone,
            "with_digit_tone": with_digits,
            "eq_plain_only": eq_plain,
            "digit_tone_rate": round(with_digits / total, 4) if total else 0,
            "pass_all_digit_tone": with_digits == total and total > 0,
        }
    for word in ["中杯", "大杯", "美式", "拿铁", "我们", "精神文明"]:
        row = conn.execute(
            "SELECT word,pinyin_key,tone_pinyin_key,source FROM domain_lexicon WHERE word=?",
            (word,),
        ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT word,pinyin_key,tone_pinyin_key,source FROM base_lexicon WHERE word=?",
                (word,),
            ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT word,pinyin_key,tone_pinyin_key,source FROM idiom_lexicon WHERE word=?",
                (word,),
            ).fetchone()
        out["spotChecks"].append({"word": word, "row": row})
    out["all_tables_pass"] = all(v["pass_all_digit_tone"] for v in out["tables"].values())
    out_path = ROOT / "electron_node/electron-node/tests/experiments/lexicon-tone-db-audit.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out["all_tables_pass"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
