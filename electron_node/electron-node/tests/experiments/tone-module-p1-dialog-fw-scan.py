#!/usr/bin/env python3
"""Dialog200 FW tone scan for P1 benefit audit (read-only)."""
from __future__ import annotations

import base64
import json
import sqlite3
import struct
import urllib.request
import wave
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
DIALOG_DIR = PROJECT_ROOT / "test wav" / "dialog_200"
MANIFEST = DIALOG_DIR / "cases.manifest.json"
SQLITE = PROJECT_ROOT / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
OUT = Path(__file__).resolve().parent / "tone-module-p1-dialog-fw-scan.json"
FW_URL = "http://127.0.0.1:6007/utterance"


def read_wav(path: Path):
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        frames = wf.readframes(wf.getnframes())
    samples = struct.unpack(f"<{len(frames)//2}h", frames)
    if ch > 1:
        mono = []
        for i in range(0, len(samples), ch):
            mono.append(sum(samples[i : i + ch]) / ch)
        samples = mono
    pcm = [s / 32768.0 for s in samples]
    pcm16 = b"".join(struct.pack("<h", max(-32768, min(32767, int(x * 32767)))) for x in pcm)
    return pcm16, sr


def fw_post(pcm16: bytes, sr: int, trace_id: str) -> dict:
    body = json.dumps(
        {
            "job_id": trace_id,
            "src_lang": "zh",
            "audio": base64.b64encode(pcm16).decode("ascii"),
            "audio_format": "pcm16",
            "sample_rate": sr,
            "skip_text_dedup": True,
            "beam_size": 1,
            "temperature": 0,
            "trace_id": trace_id,
        }
    ).encode("utf-8")
    req = urllib.request.Request(FW_URL, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8"))


def argmax_tone(posterior: dict) -> int:
    best, val = 1, float(posterior.get("t1", 0))
    for i in range(2, 6):
        v = float(posterior.get(f"t{i}", 0))
        if v > val:
            val, best = v, i
    return best


def char_expected_tone(ch: str) -> int:
    try:
        from pypinyin import pinyin, Style

        py = pinyin(ch, style=Style.TONE3, errors="ignore")
        if not py or not py[0]:
            return 0
        s = py[0][0]
        for d in "12345":
            if s.endswith(d):
                return int(d)
    except Exception:
        pass
    return 0


def homophone_spans(raw: str, conn) -> list:
    spans = []
    chars = list(raw)
    for ln in range(2, 6):
        for start in range(0, len(chars) - ln + 1):
            text = "".join(chars[start : start + ln])
            if not all("\u4e00" <= c <= "\u9fff" for c in text):
                continue
            row = conn.execute(
                "SELECT pinyin_key FROM base_lexicon WHERE word=? AND enabled=1 LIMIT 1", (text,)
            ).fetchone()
            if not row:
                row = conn.execute(
                    "SELECT pinyin_key FROM domain_lexicon WHERE word=? AND enabled=1 LIMIT 1", (text,)
                ).fetchone()
            if not row:
                continue
            cnt = conn.execute(
                "SELECT COUNT(DISTINCT tone_pinyin_key) FROM ("
                "SELECT tone_pinyin_key FROM base_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1 "
                "UNION SELECT tone_pinyin_key FROM domain_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1"
                ")",
                (row[0], ln, row[0], ln),
            ).fetchone()[0]
            if cnt >= 2:
                spans.append({"text": text, "start": start, "end": start + ln, "pinyinKey": row[0]})
    return spans


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    golden = {m["id"]: m for m in manifest}
    conn = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)

    cnn = {str(i): {"ok": 0, "total": 0} for i in range(1, 6)}
    confusion: dict[str, int] = defaultdict(int)
    cases = []
    tone_enabled = 0

    for item in manifest:
        wav = DIALOG_DIR / item["file"]
        if not wav.is_file():
            continue
        row = {"id": item["id"], "utterance": item["utterance"], "raw": None, "toneEnabled": False}
        try:
            pcm16, sr = read_wav(wav)
            resp = fw_post(pcm16, sr, f"p1-{item['id']}")
            raw = (resp.get("text") or "").strip()
            tone = resp.get("tone") or {}
            row["raw"] = raw
            row["toneEnabled"] = tone.get("toneEnabled") is True
            row["alignmentText"] = tone.get("alignmentText")
            row["alignmentMatched"] = (tone.get("alignmentText") or "").strip() == raw
            if row["toneEnabled"]:
                tone_enabled += 1
            tokens = tone.get("toneTokens") or []
            # align tokens to chars
            char_idx = 0
            tok_i = 0
            sorted_toks = sorted(tokens, key=lambda t: t.get("start", 0))
            for ci, ch in enumerate(raw):
                if not ("\u4e00" <= ch <= "\u9fff"):
                    continue
                while tok_i < len(sorted_toks) and sorted_toks[tok_i].get("token", "") != ch:
                    char_idx += 1
                    if char_idx > ci:
                        break
                if tok_i < len(sorted_toks):
                    tok = sorted_toks[tok_i]
                    if ch in tok.get("token", ""):
                        exp = char_expected_tone(ch)
                        pred = argmax_tone(tok.get("tonePosterior") or {})
                        if exp:
                            cnn[str(exp)]["total"] += 1
                            if pred == exp:
                                cnn[str(exp)]["ok"] += 1
                            else:
                                confusion[f"{exp}→{pred}"] += 1
                char_idx += 1
            row["toneTokens"] = tokens
            row["homophoneSpans"] = homophone_spans(raw, conn) if raw else []
        except Exception as exc:
            row["error"] = str(exc)
        cases.append(row)
        print(f"[fw-scan {item['id']}] tone={row.get('toneEnabled')}")

    conn.close()
    out = {
        "toneEnabledCount": tone_enabled,
        "cases": cases,
        "cnnPerTone": {
            k: {"accuracy": (v["ok"] / v["total"] if v["total"] else None), **v} for k, v in cnn.items()
        },
        "confusion": sorted([{"pair": k, "count": v} for k, v in confusion.items()], key=lambda x: -x["count"]),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
