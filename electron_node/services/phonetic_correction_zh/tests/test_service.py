#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""同音纠错服务功能测试：/health、/correct。"""

import sys
import requests

BASE_URL = "http://127.0.0.1:5016"
TIMEOUT = 10


def main():
    print("=" * 50)
    print("Phonetic Correction ZH - 功能测试")
    print("=" * 50)

    # 1. 健康检查
    print("\n[1] GET /health")
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        print(f"  status: {data.get('status')}")
        print(f"  model_loaded: {data.get('model_loaded')}")
        if data.get("status") == "healthy":
            print("  OK: 服务就绪（已加载模型）")
        else:
            print("  OK: 服务就绪（无模型时返回原文）")
    except requests.exceptions.ConnectionError as e:
        print(f"  失败: 无法连接 {BASE_URL}，请先启动服务 (python service.py)")
        sys.exit(1)
    except Exception as e:
        print(f"  失败: {e}")
        sys.exit(1)

    # 2. 纠错接口
    print("\n[2] POST /correct")
    try:
        payload = {"text_in": "你号，这是一个测试。"}
        r = requests.post(f"{BASE_URL}/correct", json=payload, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        print(f"  输入: {payload['text_in']}")
        print(f"  输出: {data.get('text_out')}")
        print(f"  耗时: {data.get('process_time_ms')} ms")
        assert "text_out" in data and "process_time_ms" in data
        print("  OK: /correct 返回格式正确")
    except requests.exceptions.ConnectionError:
        print(f"  失败: 无法连接")
        sys.exit(1)
    except Exception as e:
        print(f"  失败: {e}")
        sys.exit(1)

    print("\n全部通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
