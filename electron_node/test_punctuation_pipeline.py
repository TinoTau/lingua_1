# -*- coding: utf-8 -*-
"""断句服务及上下游流水线功能测试"""

import json
import sys
import urllib.request
import urllib.error

PUNC_URL = "http://127.0.0.1:5017"
PHONETIC_URL = "http://127.0.0.1:5016"
SEMANTIC_URL = "http://127.0.0.1:5015"


def req(url, method="GET", body=None):
    req_obj = urllib.request.Request(url, data=body, method=method)
    req_obj.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req_obj, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    failed = False

    print("\n=== 1. 断句服务 /health ===")
    try:
        h = req(f"{PUNC_URL}/health")
        if h.get("status") != "healthy":
            print("  FAIL: status != healthy")
            failed = True
        else:
            print("  OK")
    except urllib.error.URLError as e:
        print(f"  FAIL: 断句服务未运行 ({e})")
        sys.exit(1)

    print("\n=== 2. 断句服务 /punc（与 pipeline 契约一致）===")
    for lang, text in [("zh", "你好世界今天天气不错"), ("en", "hello world how are you")]:
        try:
            body = json.dumps({"text": text, "lang": lang}).encode("utf-8")
            r = req(f"{PUNC_URL}/punc", method="POST", body=body)
            if "text" not in r or "process_time_ms" not in r:
                print(f"  FAIL: 缺少 text 或 process_time_ms, lang={lang}")
                failed = True
            else:
                print(f"  [{lang}] in={text} -> out={r['text'][:50]}... OK")
        except Exception as e:
            print(f"  FAIL lang={lang}: {e}")
            failed = True

    print("\n=== 3. 上下游链路：Phonetic -> Punctuation -> Semantic ===")
    raw = "你号世界今天天气真不错"
    step1 = raw
    try:
        body = json.dumps({"text_in": raw, "lang": "zh"}).encode("utf-8")
        r1 = req(f"{PHONETIC_URL}/correct", method="POST", body=body)
        step1 = r1.get("text_out", raw)
        print(f"  [Phonetic] in={raw} -> out={step1}")
    except urllib.error.URLError:
        print("  [Phonetic] 跳过（服务未启动）")

    try:
        body = json.dumps({"text": step1, "lang": "zh"}).encode("utf-8")
        r2 = req(f"{PUNC_URL}/punc", method="POST", body=body)
        step2 = r2["text"]
        print(f"  [Punctuation] in={step1} -> out={step2}")
    except Exception as e:
        print(f"  [Punctuation] FAIL: {e}")
        failed = True
        sys.exit(1)

    try:
        body = json.dumps({"text_in": step2, "job_id": "test-punc-001", "lang": "zh"}).encode("utf-8")
        r3 = req(f"{SEMANTIC_URL}/zh/repair", method="POST", body=body)
        step3 = r3.get("text_out", step2)
        print(f"  [Semantic] in={step2} -> out={step3}")
    except urllib.error.URLError:
        print("  [Semantic] 跳过（服务未启动）")

    print("\n=== 4. 数据格式校验 ===")
    body = json.dumps({"text": "测试", "lang": "zh"}).encode("utf-8")
    r = req(f"{PUNC_URL}/punc", method="POST", body=body)
    if not isinstance(r.get("text"), str):
        print("  FAIL: /punc text 必须是 string")
        failed = True
    else:
        print("  /punc 返回 text 类型: string OK")

    print("\n=== 测试完成 ===")
    if failed:
        sys.exit(1)
    print("断句服务与上下游数据流正常。")


if __name__ == "__main__":
    main()
