# -*- coding: utf-8 -*-
"""Curated multi-char Anchor-contrast seeds + light lexicon expand.

Avoids slow per-word annotate loops; uses known ASR-like confusions and
optionally a small lexicon sample.
"""
from __future__ import annotations

import json
import random
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable
from training.model3_error_text.generator.corrupt import annotate_sentence
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import (
    LexiconSurfaceResolver,
    default_sqlite_path,
)

OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot/_seed_pairs_multichar.json"

# (error_surface, reference_surface, family) — same surface KEEP vs RETRY by Anchor
CURATED = [
    ("鸡场", "机场", "n_l"),
    ("鸡场", "机厂", "n_l"),
    ("裹上", "过上", "unknown"),
    ("油票", "邮票", "unknown"),
    ("油票", "有票", "unknown"),
    ("正餐", "蒸笼", "unknown"),
    ("回话", "绘画", "h_f"),
    ("试衣", "事宜", "sh_s"),
    ("试衣", "诗意", "sh_s"),
    ("升职", "生殖", "eng_en"),
    ("升职", "声质", "eng_en"),
    ("复职", "复制", "unknown"),
    ("复职", "负值", "unknown"),
    ("工地", "公敌", "unknown"),
    ("工地", "恭喜", "unknown"),
    ("单车", "蛋扯", "unknown"),
    ("单车", "淡出", "unknown"),
    ("电费", "垫付", "unknown"),
    ("电费", "典范", "unknown"),
    ("船票", "传票", "ch_c"),
    ("船票", "串票", "ch_c"),
    ("终审", "中心", "eng_en"),
    ("终审", "钟声", "eng_en"),
    ("处方", "出访", "ch_c"),
    ("处方", "厨房", "ch_c"),
    ("税率", "睡绿", "sh_s"),
    ("税率", "水陆", "sh_s"),
    ("旅费", "屡犯", "n_l"),
    ("旅费", "铝肥", "n_l"),
    ("路费", "录播", "n_l"),
    ("路费", "卤味", "n_l"),
    ("名片", "明片", "in_ing"),
    ("名片", "民变", "in_ing"),
    ("名额", "铭刻", "in_ing"),
    ("名额", "命格", "in_ing"),
    ("蓝本", "南奔", "n_l"),
    ("蓝本", "烂本", "n_l"),
    ("男装", "蓝装", "n_l"),
    ("男装", "难装", "n_l"),
    ("南方", "蓝方", "n_l"),
    ("南方", "难访", "n_l"),
    ("内测", "累测", "n_l"),
    ("内测", "泪测", "n_l"),
    ("年龄", "联龄", "n_l"),
    ("年龄", "连零", "n_l"),
    ("牛奶", "流奶", "n_l"),
    ("牛奶", "留奶", "n_l"),
    ("能力", "棱力", "n_l"),
    ("能力", "棱利", "n_l"),
    ("资料", "滋料", "z_zh"),
    ("资料", "自疗", "z_zh"),
    ("知识", "姿识", "z_zh"),
    ("知识", "滋事", "z_zh"),
    ("主张", "主脏", "z_zh"),
    ("主张", "柱状", "z_zh"),
    ("住宅", "主宅", "z_zh"),
    ("住宅", "助债", "z_zh"),
    ("展开", "斩开", "z_zh"),
    ("展开", "占开", "z_zh"),
    ("战争", "暂争", "z_zh"),
    ("战争", "赞争", "z_zh"),
    ("产品", "残品", "ch_c"),
    ("产品", "灿品", "ch_c"),
    ("成绩", "成积", "ch_c"),
    ("成绩", "承继", "ch_c"),
    ("程度", "成度", "ch_c"),
    ("程度", "承渡", "ch_c"),
    ("厨房", "出房", "ch_c"),
    ("厨房", "初访", "ch_c"),
    ("市场", "事场", "sh_s"),
    ("市场", "试场", "sh_s"),
    ("时间", "石间", "sh_s"),
    ("时间", "试题", "sh_s"),
    ("数量", "树量", "sh_s"),
    ("数量", "术量", "sh_s"),
    ("说明", "朔明", "sh_s"),
    ("说明", "烁明", "sh_s"),
    ("声音", "升音", "eng_en"),
    ("声音", "圣音", "eng_en"),
    ("生命", "声名", "eng_en"),
    ("生命", "盛名", "eng_en"),
    ("成功", "成工", "eng_en"),
    ("成功", "承公", "eng_en"),
    ("风景", "风井", "in_ing"),
    ("风景", "风警", "in_ing"),
    ("心情", "心晴", "in_ing"),
    ("心情", "心青", "in_ing"),
    ("行李", "行礼", "in_ing"),
    ("行李", "形理", "in_ing"),
    ("发票", "发飘", "unknown"),
    ("发票", "法票", "unknown"),
    ("房间", "防间", "h_f"),
    ("房间", "访间", "h_f"),
    ("护照", "护罩", "h_f"),
    ("护照", "互照", "h_f"),
    ("会议", "汇意", "h_f"),
    ("会议", "秽意", "h_f"),
    ("黄金", "皇金", "h_f"),
    ("黄金", "凰金", "h_f"),
]


def light_lex_expand(resolver: LexiconSurfaceResolver, limit: int = 80) -> list[dict]:
    rows = resolver._con.execute(
        "SELECT word FROM base_lexicon WHERE enabled=1 AND length(word)=2 "
        "ORDER BY prior_score DESC LIMIT 250"
    ).fetchall()
    out = []
    for (w,) in rows:
        if not w or len(w) != 2:
            continue
        annos, _impl, meta = annotate_sentence(w)
        if len(annos) != 2 or not meta.get("ok"):
            continue
        for pos in (0, 1):
            anno = annos[pos]
            if anno.skip_reason:
                continue
            for fam in ACTIVE_FAMILIES_V1:
                corrupted = apply_family_to_syllable(anno.source_tone, fam)
                if not corrupted or corrupted == anno.source_tone:
                    continue
                cands = resolver.lookup_len1_by_tone_key(corrupted, limit=3)
                if not cands:
                    continue
                err_ch = cands[0][0]
                if err_ch == anno.surface:
                    continue
                chars = list(w)
                chars[pos] = err_ch
                err = "".join(chars)
                if err == w:
                    continue
                out.append(
                    {
                        "keep_surface": err,
                        "retry_reference": w,
                        "error_surface": err,
                        "family": fam if fam else "unknown",
                        "source": "multichar_light_lex",
                    }
                )
                if len(out) >= limit:
                    return out
                break
            if len(out) >= limit:
                return out
        if len(out) >= limit:
            break
    return out


def main() -> None:
    pairs = {}
    for err, ref, fam in CURATED:
        if err == ref:
            continue
        # family unknown → map to a real ACTIVE family for holdout logic
        fam_use = fam if fam in ACTIVE_FAMILIES_V1 else "n_l"
        key = f"{err}|{ref}"
        pairs[key] = {
            "keep_surface": err,
            "retry_reference": ref,
            "error_surface": err,
            "family": fam_use,
            "source": "curated_multichar",
        }

    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    for r in light_lex_expand(resolver, limit=100):
        key = f"{r['error_surface']}|{r['retry_reference']}"
        if key not in pairs:
            pairs[key] = r
    resolver.close()

    # Keep some validated single-char for density, but minority
    reach = OUT.parent / "_seed_pairs_reachable.json"
    if reach.exists():
        singles = [
            r
            for r in json.loads(reach.read_text(encoding="utf-8"))
            if len(r.get("error_surface") or "") == 1
        ]
        random.Random(2026082415).shuffle(singles)
        for r in singles[:30]:
            key = f"{r['error_surface']}|{r['retry_reference']}"
            if key not in pairs:
                rr = dict(r)
                rr["source"] = (rr.get("source") or "") + "+single_minority"
                pairs[key] = rr

    rows = list(pairs.values())
    random.Random(2026082415).shuffle(rows)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "n_selected": len(rows),
                "n_multi": sum(1 for r in rows if len(r["error_surface"]) >= 2),
                "n_single": sum(1 for r in rows if len(r["error_surface"]) == 1),
                "families": dict(Counter(r["family"] for r in rows)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
