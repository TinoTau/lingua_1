# -*- coding: utf-8 -*-
"""
集成测试：使用与之前相同的 ASR 原文，测试 同音纠错 -> 断句 -> 语义修复 -> NMT 全流程
对比加入断句后的翻译效果
"""

import json
import sys
import urllib.request
import urllib.error

PHONETIC_URL = "http://127.0.0.1:5016"
PUNC_URL = "http://127.0.0.1:5017"
SEMANTIC_URL = "http://127.0.0.1:5015"
NMT_URL = "http://127.0.0.1:5008"

# 与之前集成测试相同的 ASR 原文（含同音词错误）
SEGMENTS = [
    ("[0]", "我们开始进行一次运营识别稳定性测试"),
    ("[2]", "我和线度一两句比较短的话用来确认 系统不会在句子之间随意的把语音切断或者在没有 要不要的时候提前结束本次识别"),
    ("[5]", "接下来就一 继续我会尽量的连续地说的长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后 继续到会不会因为超时或者精英判定而长行把这句话解断从而导致 继续短拆贩产不同的任务 出现于医生 上不完整 毒起来前后不灭怪的情况"),
    ("[8]", "这次的长距能够被完整的识别出来而且不会出现半句话被提前发送或者直接丢去的现象那就说明 我们当前的结婚策略和超市规则是基本可用的"),
    ("[11]", "还需要继续分析日质,找出到底是在哪一个环节把我的原因给吃掉了?"),
]


def req(url, method="GET", body=None, timeout=120):
    req_obj = urllib.request.Request(url, data=body, method=method)
    req_obj.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req_obj, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def pipeline(segment_id, raw_text):
    """Phonetic -> Punctuation -> Semantic -> NMT"""
    steps = {"raw": raw_text}
    text = raw_text

    # 1. Phonetic
    try:
        body = json.dumps({"text_in": text, "lang": "zh"}).encode("utf-8")
        r = req(f"{PHONETIC_URL}/correct", "POST", body, timeout=30)
        text = r.get("text_out", text)
        steps["phonetic"] = text
    except urllib.error.URLError as e:
        steps["phonetic"] = f"[SKIP: {e}]"

    # 2. Punctuation
    try:
        body = json.dumps({"text": text, "lang": "zh"}).encode("utf-8")
        r = req(f"{PUNC_URL}/punc", "POST", body, timeout=90)
        text = r.get("text", text)
        steps["punctuation"] = text
    except urllib.error.URLError as e:
        steps["punctuation"] = f"[SKIP: {e}]"

    # 3. Semantic
    try:
        body = json.dumps({
            "text_in": text,
            "job_id": f"test-{segment_id}",
            "session_id": "test-session-001",
            "lang": "zh",
        }).encode("utf-8")
        r = req(f"{SEMANTIC_URL}/zh/repair", "POST", body, timeout=60)
        text = r.get("text_out", text)
        steps["semantic"] = text
    except urllib.error.URLError as e:
        steps["semantic"] = f"[SKIP: {e}]"

    # 4. NMT
    try:
        body = json.dumps({"text": text, "src_lang": "zh", "tgt_lang": "en", "context_text": ""}).encode("utf-8")
        r = req(f"{NMT_URL}/v1/translate", "POST", body, timeout=120)
        if r.get("ok") and r.get("text"):
            steps["nmt"] = r["text"]
        else:
            steps["nmt"] = f"[ERROR: {r.get('error', 'unknown')}]"
    except urllib.error.URLError as e:
        steps["nmt"] = f"[SKIP: {e}]"

    return steps


def main():
    sys.stdout.reconfigure(encoding="utf-8") if hasattr(sys.stdout, "reconfigure") else None

    print("=" * 80)
    print("集成测试：同音纠错 -> 断句 -> 语义修复 -> NMT 全流程")
    print("使用与之前相同的 ASR 原文，对比加入断句后的效果")
    print("=" * 80)

    results = []
    for seg_id, raw in SEGMENTS:
        print(f"\n--- {seg_id} ---")
        steps = pipeline(seg_id, raw)
        results.append((seg_id, steps))

        print(f"原文 (ASR):     {steps['raw'][:80]}{'...' if len(steps['raw'])>80 else ''}")
        print(f"同音纠错后:     {steps['phonetic'][:80]}{'...' if len(str(steps['phonetic']))>80 else ''}")
        print(f"断句后:         {steps['punctuation'][:80]}{'...' if len(str(steps['punctuation']))>80 else ''}")
        print(f"语义修复后:     {steps['semantic'][:80]}{'...' if len(str(steps['semantic']))>80 else ''}")
        print(f"译文 (NMT):     {steps['nmt'][:80]}{'...' if len(str(steps['nmt']))>80 else ''}")

    print("\n" + "=" * 80)
    print("汇总：译文 (NMT)")
    print("=" * 80)
    for seg_id, steps in results:
        print(f"{seg_id} {steps['nmt']}")

    print("\n" + "=" * 80)
    print("对比参考（之前集成测试，无断句）：")
    print("=" * 80)
    print("""[0] We are starting to perform an operating identification stability test.
[2] I and linear one or two words are shorter to confirm that the system will not arbitrarily cut down the voice between the sentences or terminate this identification in advance when no.
[5] Next on one I will try to say as long as possible continuously, only retain the natural breathing rhythm not do intentional stops look after more than 10 seconds continue until it is not due to overtime or elite judgment and long line to dissolve this phrase that leads to the continuation of short-destruction production different tasks appear in doctors uncomplete before poisoning unextinctive situation.
[8] This long distance can be fully identified and there is no half-word being sent in advance or lost directly that shows our current marriage strategy and supermarket rules are basically available.
[11] I need to continue analyzing the daytime, and find out exactly in which line did my reason be eaten?""")


if __name__ == "__main__":
    main()
