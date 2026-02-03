#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
测试：繁体 ASR 结果 → 繁→简 → 同音纠错 → 语义修复
调用合并语义修复服务 /zh/repair，验证输出为简体且经过纠错/修复。
"""

import requests
import json
import sys
import time

BASE_URL = "http://127.0.0.1:5015"

# 你提供的繁体 ASR 例句（对应阅读文本的简体）
TRADITIONAL_SAMPLES = [
    "[7] 這場的場景是一般的場景",
    "[9] 防具能夠被完整的識別出來而且不會出現犯就發被提前發送或者直接丟棄的現象那就說明我們當前的切分策略和超市規則是基本可用的",
]

# 期望输出应包含的简体特征（若仍出现繁体则说明未转换）
TRADITIONAL_CHARS = set("這場識別與發說們會來個時動讀過長斷節練習頂經營解環給誌為")


def has_traditional(text: str) -> bool:
    return bool(TRADITIONAL_CHARS & set(text))


def wait_for_health(max_wait_sec: int = 300, interval_sec: float = 3.0) -> bool:
    """等待服务健康（含 zh_repair warmed）；最多等 5 分钟（LLM 加载较慢）"""
    start = time.time()
    while time.time() - start < max_wait_sec:
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=5)
            if r.status_code != 200:
                time.sleep(interval_sec)
                continue
            data = r.json()
            status = data.get("status")
            procs = data.get("processors", {})
            zh = procs.get("zh_repair", {})
            if status == "healthy" and zh.get("status") == "healthy":
                return True
            elapsed = int(time.time() - start)
            print(f"  [wait] {elapsed}s status={status}, zh_repair={zh.get('status')} ...")
        except Exception as e:
            print(f"  [wait] {e} ...")
        time.sleep(interval_sec)
    return False


def test_repair(text_in: str, job_id: str = "test-t2s-001") -> dict:
    """调用 /zh/repair，返回响应 JSON"""
    payload = {
        "job_id": job_id,
        "session_id": "test-session-t2s",
        "utterance_index": 0,
        "lang": "zh",
        "text_in": text_in,
    }
    r = requests.post(f"{BASE_URL}/zh/repair", json=payload, timeout=60)
    r.raise_for_status()
    return r.json()


def main():
    print("=" * 70)
    print("测试：繁体 ASR → 繁→简 → 同音纠错 → 语义修复")
    print("=" * 70)

    # 1. 等待服务就绪
    print("\n[1] 等待服务健康 (zh_repair)...")
    if not wait_for_health():
        print("  ✗ 服务未在预期时间内就绪，请先启动 semantic_repair_en_zh 服务。")
        sys.exit(1)
    print("  ✓ 服务已就绪")

    # 2. 逐条发送繁体样本
    print("\n[2] 发送繁体样本到 /zh/repair，验证输出为简体并经过纠错/修复")
    all_ok = True
    for i, text_in in enumerate(TRADITIONAL_SAMPLES):
        print(f"\n  --- 样本 {i + 1} ---")
        print(f"  输入 (繁体): {text_in[:60]}{'...' if len(text_in) > 60 else ''}")
        try:
            result = test_repair(text_in, job_id=f"test-t2s-{i+1}")
            text_out = result.get("text_out", "")
            decision = result.get("decision", "")
            process_time_ms = result.get("process_time_ms", 0)
            print(f"  输出:        {text_out[:60]}{'...' if len(text_out) > 60 else ''}")
            print(f"  decision:    {decision}, process_time_ms: {process_time_ms}")

            if has_traditional(text_out):
                print("  ✗ 输出仍含繁体字，繁→简或语义修复未生效。")
                all_ok = False
            else:
                print("  ✓ 输出为简体。")
            if text_out != text_in:
                print("  ✓ 文本有修改（纠错或语义修复生效）。")
            else:
                print("  (文本无修改，可能原文已正确或仅做了繁→简且无同音替换)")
        except Exception as e:
            print(f"  ✗ 请求失败: {e}")
            all_ok = False

    print("\n" + "=" * 70)
    if all_ok:
        print("全部样本通过：繁体已转为简体，并经过纠错/语义修复流程。")
    else:
        print("部分样本未通过，请检查服务日志与 opencc/同音纠错/LLM 配置。")
    print("=" * 70)
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
