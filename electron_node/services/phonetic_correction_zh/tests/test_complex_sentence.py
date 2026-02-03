#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""复杂长句测试：繁→简后调用同音纠错，与目标句语义接近即可。"""

import os
import sys
import requests

BASE_URL = "http://127.0.0.1:5016"
TIMEOUT = 60

# 用户输入（ASR 风格，繁体）
INPUT_TRADITIONAL = "這場的場景是一般的場景防具能夠被完整的識別出來而且不會出現犯就發被提前發送或者直接丟棄的現象那就說明我們當前的切分策略和超市規則是基本可用的"

# 目标句（期望语义）
TARGET = "如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。"


def to_simplified(text: str) -> str:
    """繁→简：优先 OpenCC，否则简单映射。"""
    try:
        from opencc import OpenCC
        return OpenCC("t2s").convert(text)
    except Exception:
        pass
    # 无 OpenCC 时仅做本句常见字替换
    t2s = {
        "這": "这", "場": "场", "景": "景", "識": "识", "別": "别", "發": "发",
        "丟": "丢", "棄": "弃", "說": "说", "明": "明", "們": "们", "當": "当",
        "規": "规", "則": "则", "與": "与", "會": "会", "現": "现", "象": "象",
        "能": "能", "夠": "够", "來": "来", "現": "现", "象": "象",
    }
    out = []
    for c in text:
        out.append(t2s.get(c, c))
    return "".join(out)


def main():
    simplified = to_simplified(INPUT_TRADITIONAL)
    lines = [
        "=" * 60,
        "同音纠错 - 复杂长句测试",
        "=" * 60,
        "",
        "原始输入（ASR/繁体）:",
        f"  {INPUT_TRADITIONAL}",
        "",
        "繁→简后:",
        f"  {simplified}",
        "",
        "目标句（语义参考）:",
        f"  {TARGET}",
    ]
    for s in lines:
        print(s)

    try:
        r = requests.post(
            f"{BASE_URL}/correct",
            json={"text_in": simplified},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        out = data.get("text_out", "")
        ms = data.get("process_time_ms", 0)
        lines2 = [
            "",
            "纠错输出:",
            f"  {out}",
            f"  耗时: {ms:.2f} ms",
        ]
        # 逐字对比（仅标出不同处）
        diffs = []
        for i, (a, b) in enumerate(zip(simplified, out)):
            if a != b:
                diffs.append(f"    位置{i}: '{a}' -> '{b}'")
        if len(simplified) != len(out):
            diffs.append(f"    长度: {len(simplified)} -> {len(out)}")
        if diffs:
            lines2.append("  修改处:")
            lines2.extend(diffs)
        lines2.append("")
        lines2.append("说明: 本句中的主要差异（这场→这次、场景→长句、超市→超时、犯就发→半句话、丢弃→丢失）")
        lines2.append("多为不同拼音（如 市shì/时shí、场chǎng/次cì），同音纠错仅做同音字替换，无法修正。")
        lines2.append("要达到语义接近需依赖语义修复（LLM）环节。")
        for s in lines2:
            print(s)
        # 写入结果文件便于查看
        out_path = os.path.join(os.path.dirname(__file__), "test_complex_result.txt")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines + lines2))
        print(f"结果已写入: {out_path}")
        return 0
    except requests.exceptions.ConnectionError:
        print("\n错误: 无法连接 5016，请先启动纠错服务 (python service.py)")
        return 1
    except Exception as e:
        print(f"\n错误: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
