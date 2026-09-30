"""Generate Seed Cases V1 (machine-readable generation seeds, not train rows)."""

from __future__ import annotations

import json
from pathlib import Path

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.transform_engine import PronunciationTransformEngineV1

# Curated seed templates covering 16 directions + non-lexical PoCs.
# Seed Case = generation seed, not a fixed training row.

_SEED_SPECS = [
    # n/l — includes non-lexical lai3 PoC
    {"seed_id": "seed-nl-001", "target_text": "奶", "target_pinyin": "nai3", "confusion_family": "n_l"},
    {"seed_id": "seed-nl-002", "target_text": "奶奶", "target_pinyin": "nai3 nai3", "confusion_family": "n_l"},
    {"seed_id": "seed-nl-003", "target_text": "南宁", "target_pinyin": "nan2 ning2", "confusion_family": "n_l"},
    {"seed_id": "seed-nl-004", "target_text": "牛奶", "target_pinyin": "niu2 nai3", "confusion_family": "n_l"},
    {"seed_id": "seed-ln-001", "target_text": "兰", "target_pinyin": "lan2", "confusion_family": "l_n"},
    {"seed_id": "seed-ln-002", "target_text": "老师", "target_pinyin": "lao3 shi1", "confusion_family": "l_n"},
    {"seed_id": "seed-ln-003", "target_text": "来了", "target_pinyin": "lai2 le0", "confusion_family": "l_n"},
    {"seed_id": "seed-ln-004", "target_text": "路南", "target_pinyin": "lu4 nan2", "confusion_family": "l_n"},
    # zh/z
    {"seed_id": "seed-zhz-001", "target_text": "中", "target_pinyin": "zhong1", "confusion_family": "zh_z"},
    {"seed_id": "seed-zhz-002", "target_text": "中国", "target_pinyin": "zhong1 guo2", "confusion_family": "zh_z"},
    {"seed_id": "seed-zhz-003", "target_text": "知道", "target_pinyin": "zhi1 dao4", "confusion_family": "zh_z"},
    {"seed_id": "seed-zhz-004", "target_text": "张三", "target_pinyin": "zhang1 san1", "confusion_family": "zh_z"},
    {"seed_id": "seed-zzh-001", "target_text": "宗", "target_pinyin": "zong1", "confusion_family": "z_zh"},
    {"seed_id": "seed-zzh-002", "target_text": "自己", "target_pinyin": "zi4 ji3", "confusion_family": "z_zh"},
    {"seed_id": "seed-zzh-003", "target_text": "资源", "target_pinyin": "zi1 yuan2", "confusion_family": "z_zh"},
    {"seed_id": "seed-zzh-004", "target_text": "早茶", "target_pinyin": "zao3 cha2", "confusion_family": "z_zh"},
    # ch/c
    {"seed_id": "seed-chc-001", "target_text": "茶", "target_pinyin": "cha2", "confusion_family": "ch_c"},
    {"seed_id": "seed-chc-002", "target_text": "出来", "target_pinyin": "chu1 lai2", "confusion_family": "ch_c"},
    {"seed_id": "seed-chc-003", "target_text": "车站", "target_pinyin": "che1 zhan4", "confusion_family": "ch_c"},
    {"seed_id": "seed-chc-004", "target_text": "吃饭", "target_pinyin": "chi1 fan4", "confusion_family": "ch_c"},
    {"seed_id": "seed-cch-001", "target_text": "菜", "target_pinyin": "cai4", "confusion_family": "c_ch"},
    {"seed_id": "seed-cch-002", "target_text": "层次", "target_pinyin": "ceng2 ci4", "confusion_family": "c_ch"},
    {"seed_id": "seed-cch-003", "target_text": "从那", "target_pinyin": "cong2 na4", "confusion_family": "c_ch"},
    {"seed_id": "seed-cch-004", "target_text": "测试", "target_pinyin": "ce4 shi4", "confusion_family": "c_ch"},
    # sh/s
    {"seed_id": "seed-shs-001", "target_text": "是", "target_pinyin": "shi4", "confusion_family": "sh_s"},
    {"seed_id": "seed-shs-002", "target_text": "上海", "target_pinyin": "shang4 hai3", "confusion_family": "sh_s"},
    {"seed_id": "seed-shs-003", "target_text": "老师", "target_pinyin": "lao3 shi1", "confusion_family": "sh_s"},
    {"seed_id": "seed-shs-004", "target_text": "上车", "target_pinyin": "shang4 che1", "confusion_family": "sh_s"},
    {"seed_id": "seed-ssh-001", "target_text": "四", "target_pinyin": "si4", "confusion_family": "s_sh"},
    {"seed_id": "seed-ssh-002", "target_text": "司机", "target_pinyin": "si1 ji1", "confusion_family": "s_sh"},
    {"seed_id": "seed-ssh-003", "target_text": "三楼", "target_pinyin": "san1 lou2", "confusion_family": "s_sh"},
    {"seed_id": "seed-ssh-004", "target_text": "发送", "target_pinyin": "fa1 song4", "confusion_family": "s_sh"},
    # an/ang
    {"seed_id": "seed-anang-001", "target_text": "班", "target_pinyin": "ban1", "confusion_family": "an_ang"},
    {"seed_id": "seed-anang-002", "target_text": "看板", "target_pinyin": "kan4 ban3", "confusion_family": "an_ang"},
    {"seed_id": "seed-anang-003", "target_text": "南山", "target_pinyin": "nan2 shan1", "confusion_family": "an_ang"},
    {"seed_id": "seed-anang-004", "target_text": "单号", "target_pinyin": "dan1 hao4", "confusion_family": "an_ang"},
    {"seed_id": "seed-angan-001", "target_text": "帮", "target_pinyin": "bang1", "confusion_family": "ang_an"},
    {"seed_id": "seed-angan-002", "target_text": "房间", "target_pinyin": "fang2 jian1", "confusion_family": "ang_an"},
    {"seed_id": "seed-angan-003", "target_text": "上班", "target_pinyin": "shang4 ban1", "confusion_family": "ang_an"},
    {"seed_id": "seed-angan-004", "target_text": "帮忙", "target_pinyin": "bang1 mang2", "confusion_family": "ang_an"},
    # en/eng
    {"seed_id": "seed-eneng-001", "target_text": "根", "target_pinyin": "gen1", "confusion_family": "en_eng"},
    {"seed_id": "seed-eneng-002", "target_text": "认真", "target_pinyin": "ren4 zhen1", "confusion_family": "en_eng"},
    {"seed_id": "seed-eneng-003", "target_text": "分店", "target_pinyin": "fen1 dian4", "confusion_family": "en_eng"},
    {"seed_id": "seed-eneng-004", "target_text": "门诊", "target_pinyin": "men2 zhen3", "confusion_family": "en_eng"},
    {"seed_id": "seed-engen-001", "target_text": "庚", "target_pinyin": "geng1", "confusion_family": "eng_en"},
    {"seed_id": "seed-engen-002", "target_text": "成功", "target_pinyin": "cheng2 gong1", "confusion_family": "eng_en"},
    {"seed_id": "seed-engen-003", "target_text": "工程师", "target_pinyin": "gong1 cheng2 shi1", "confusion_family": "eng_en"},
    {"seed_id": "seed-engen-004", "target_text": "冷风", "target_pinyin": "leng3 feng1", "confusion_family": "eng_en"},
    # in/ing
    {"seed_id": "seed-ining-001", "target_text": "金", "target_pinyin": "jin1", "confusion_family": "in_ing"},
    {"seed_id": "seed-ining-002", "target_text": "拼音", "target_pinyin": "pin1 yin1", "confusion_family": "in_ing"},
    {"seed_id": "seed-ining-003", "target_text": "信心", "target_pinyin": "xin4 xin1", "confusion_family": "in_ing"},
    {"seed_id": "seed-ining-004", "target_text": "嘉宾", "target_pinyin": "jia1 bin1", "confusion_family": "in_ing"},
    {"seed_id": "seed-ingin-001", "target_text": "京", "target_pinyin": "jing1", "confusion_family": "ing_in"},
    {"seed_id": "seed-ingin-002", "target_text": "北京", "target_pinyin": "bei3 jing1", "confusion_family": "ing_in"},
    {"seed_id": "seed-ingin-003", "target_text": "明天", "target_pinyin": "ming2 tian1", "confusion_family": "ing_in"},
    {"seed_id": "seed-ingin-004", "target_text": "行李", "target_pinyin": "xing2 li3", "confusion_family": "ing_in"},
    # f/h
    {"seed_id": "seed-fh-001", "target_text": "分", "target_pinyin": "fen1", "confusion_family": "f_h"},
    {"seed_id": "seed-fh-002", "target_text": "房间", "target_pinyin": "fang2 jian1", "confusion_family": "f_h"},
    {"seed_id": "seed-fh-003", "target_text": "咖啡", "target_pinyin": "ka1 fei1", "confusion_family": "f_h"},
    {"seed_id": "seed-fh-004", "target_text": "服务", "target_pinyin": "fu2 wu4", "confusion_family": "f_h"},
    {"seed_id": "seed-hf-001", "target_text": "好", "target_pinyin": "hao3", "confusion_family": "h_f"},
    {"seed_id": "seed-hf-002", "target_text": "航班", "target_pinyin": "hang2 ban1", "confusion_family": "h_f"},
    {"seed_id": "seed-hf-003", "target_text": "会合", "target_pinyin": "hui4 he2", "confusion_family": "h_f"},
    {"seed_id": "seed-hf-004", "target_text": "黄河", "target_pinyin": "huang2 he2", "confusion_family": "h_f"},
]

_CARRIERS = [
    "请确认{TERM}",
    "我想买{TERM}",
    "帮我查一下{TERM}",
    "把{TERM}发给我",
]


def build_seed_cases() -> list[dict]:
    engine = PronunciationTransformEngineV1()
    rows = []
    for spec in _SEED_SPECS:
        py = [p for p in spec["target_pinyin"].split() if p]
        cans = []
        for p in py:
            s = PronunciationSyllable.from_compact(p)
            if s:
                cans.append(s)
        fam = spec["confusion_family"]
        corrupted = []
        for s in cans:
            tr = engine.transform(s, fam, mark_non_lexical=True)
            corrupted.append(tr.corrupted.compact if tr.applied else s.compact)
        rows.append(
            {
                **spec,
                "direction": fam,
                "corrupted_pinyin": " ".join(corrupted),
                "tone_policy": "PRESERVE",
                "carrier_templates": list(_CARRIERS),
                "schema_family_in_v1": fam in PHONETIC_FEATURE_KEYS,
            }
        )
    # Ensure all 16 families present
    present = {r["confusion_family"] for r in rows}
    assert present == set(PHONETIC_FEATURE_KEYS), present.symmetric_difference(PHONETIC_FEATURE_KEYS)
    return rows


def write_seed_cases(path: Path) -> int:
    rows = build_seed_cases()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return len(rows)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent / "seed_cases_v1.jsonl"
    n = write_seed_cases(out)
    print(f"wrote {n} seeds -> {out}")
