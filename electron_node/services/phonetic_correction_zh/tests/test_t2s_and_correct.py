#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
单元测试：ASR 繁体结果经简体化后进入同音纠错。
使用集成测试文本作为用例，确保 /correct 入口先繁→简再纠错。
"""

import sys
import os

# 保证可导入上级 service 模块
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

# 集成测试文本（ASR 返回的繁体片段，与之前集成测试一致）
INTEGRATION_TEST_TRADITIONAL = [
    "我開始進行一次語音識別穩定性測試",
    "我會先讀音 這兩句比較短的話用來確認系統不會在句子之間隨意地把語音切斷或者再沒有 不要的時候提前結束本次識別",
    "我會盡量連續地說的長一些中間只保留自然的呼吸節奏不做可以的停頓看看在超過 10秒鐘之後系統會不會應用? 因為操實或者經營判定而挑釁把這句話解斷從二島之前 判據和後判據在景點端被拆分成不同的任務甚至出現",
    "這次的場具能夠被完整的視頻出來而且也不會出現半句話被提前發送或者直接丟失的現象那就說沒有我們掏錢的簽分策略和超市規則是基本可用的",
    "我們還需要繼續分析日誌找出到底是在哪一個環節把我的語音給吃掉了",
]

# 典型繁体字 -> 简体字（用于断言输出已简体化）
TRADITIONAL_TO_SIMPLIFIED = [
    ("開始", "开始"),
    ("進行", "进行"),
    ("識別", "识别"),
    ("穩定", "稳定"),
    ("測試", "测试"),
    ("讀", "读"),
    ("這兩", "这两"),
    ("隨意", "随意"),
    ("斷", "断"),
    ("說", "说"),
    ("們", "们"),
    ("會", "会"),
    ("長", "长"),
    ("鐘", "钟"),
    ("經營", "经营"),
    ("這", "这"),
    ("場", "场"),
    ("視頻", "视频"),
    ("發", "发"),
    ("丟", "丢"),
    ("簽", "签"),
    ("們", "们"),
    ("還", "还"),
    ("環", "环"),
    ("節", "节"),
]


def _opencc_available() -> bool:
    try:
        from opencc import OpenCC
        OpenCC("t2s").convert("測試")
        return True
    except Exception:
        return False


def _get_to_simplified():
    import service as svc
    return svc._to_simplified


class TestToSimplified:
    """测试 _to_simplified：繁体输入应转为简体（当 OpenCC 可用时）。"""

    def test_empty_or_whitespace_unchanged(self):
        to_simplified = _get_to_simplified()
        assert to_simplified("") == ""
        assert to_simplified("  ") == "  "

    def test_traditional_converted_to_simplified_when_opencc_available(self):
        if not _opencc_available():
            pytest.skip("OpenCC not available")
        to_simplified = _get_to_simplified()
        trad = "我開始進行一次語音識別穩定性測試"
        out = to_simplified(trad)
        assert "开始" in out or "进行" in out or "识别" in out or "稳定" in out or "测试" in out
        assert "開始" not in out

    def test_integration_sentences_simplified_when_opencc_available(self):
        if not _opencc_available():
            pytest.skip("OpenCC not available")
        to_simplified = _get_to_simplified()
        for trad in INTEGRATION_TEST_TRADITIONAL[:2]:
            out = to_simplified(trad)
            for t, s in TRADITIONAL_TO_SIMPLIFIED:
                if t in trad:
                    assert s in out, f"expected simplified '{s}' (from '{t}') in output"


class TestCorrectEndpointT2s:
    """测试 /correct：繁体 ASR 文本经简体化后进入同音纠错，输出为简体。"""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        import service as svc
        return TestClient(svc.app)

    def test_correct_accepts_traditional_and_returns_simplified(self, client):
        """POST /correct 传入繁体，返回应为简体（入口已做繁→简）。"""
        if not _opencc_available():
            pytest.skip("OpenCC not available")
        trad = INTEGRATION_TEST_TRADITIONAL[0]  # 我開始進行一次語音識別穩定性測試
        r = client.post("/correct", json={"text_in": trad, "lang": "zh"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "text_out" in data
        out = data["text_out"]
        # 输出中应含简体、不应含典型繁体
        assert "开始" in out or "进行" in out or "识别" in out or "稳定" in out or "测试" in out
        assert "開始" not in out
        assert "識別" not in out

    def test_correct_integration_sentence_structure(self, client):
        """用集成测试短句调用 /correct，校验返回结构及简体化。"""
        if not _opencc_available():
            pytest.skip("OpenCC not available")
        trad = "我們還需要繼續分析日誌找出到底是在哪一個環節把我的語音給吃掉了"
        r = client.post("/correct", json={"text_in": trad, "lang": "zh"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "text_out" in data
        assert "process_time_ms" in data
        out = data["text_out"]
        assert "还" in out or "们" in out or "环" in out or "节" in out
        assert "還" not in out and "們" not in out and "環" not in out and "節" not in out

    def test_correct_english_passthrough(self, client):
        """英文直通，不经过繁→简。"""
        r = client.post("/correct", json={"text_in": "Hello, this is a test.", "lang": "en"})
        assert r.status_code == 200
        assert r.json()["text_out"] == "Hello, this is a test."


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
