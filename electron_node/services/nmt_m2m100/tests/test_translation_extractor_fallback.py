# -*- coding: utf-8 -*-
"""
NMT 兜底逻辑单元测试：try_extract_last_segment_from_full、_fallback_full_or_last_segment
运行方式（在 electron_node/services/nmt_m2m100 目录下）：
  python -m unittest tests.test_translation_extractor_fallback
  Windows 若遇 Unicode 打印错误可设：$env:PYTHONIOENCODING='utf-8'; python -m unittest ...
"""
import sys
import os
import unittest

# 确保可导入 translation_extractor（使用服务目录为 cwd）
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from translation_extractor import try_extract_last_segment_from_full, _fallback_full_or_last_segment


class TestFallbackFullOrLastSegment(unittest.TestCase):
    """测试统一兜底函数 _fallback_full_or_last_segment。"""

    def test_with_separator_returns_last_segment_and_mode(self):
        sep = " ⟪⟪SEP_MARKER⟫⟫ "
        out = "ctx" + sep + "current"
        text, mode = _fallback_full_or_last_segment(out)
        self.assertEqual(mode, "FULL_ONLY_LAST_SEGMENT")
        self.assertEqual(text.strip(), "current")

    def test_without_separator_returns_full_and_mode(self):
        out = "no separator"
        text, mode = _fallback_full_or_last_segment(out)
        self.assertEqual(mode, "FULL_ONLY")
        self.assertEqual(text, out)


class TestTryExtractLastSegmentFromFull(unittest.TestCase):
    """仅测试 try_extract_last_segment_from_full，不依赖模型/分词器。"""

    def test_empty_out_returns_none(self):
        self.assertIsNone(try_extract_last_segment_from_full(""))
        self.assertIsNone(try_extract_last_segment_from_full("   "))

    def test_no_separator_returns_none(self):
        self.assertIsNone(try_extract_last_segment_from_full("no separator here"))
        self.assertIsNone(try_extract_last_segment_from_full("只有中文也没有分隔符"))

    def test_with_default_separator_returns_after_segment(self):
        sep = " ⟪⟪SEP_MARKER⟫⟫ "
        out = "上下文译文" + sep + "当前句译文"
        got = try_extract_last_segment_from_full(out)
        self.assertIsNotNone(got)
        self.assertEqual(got.strip(), "当前句译文")

    def test_with_plain_sep_marker_returns_after_segment(self):
        # SEP_MARKER_VARIANTS 含 ' SEP_MARKER ' 等，取最后一段
        out = "prefix SEP_MARKER tail segment"
        got = try_extract_last_segment_from_full(out)
        self.assertIsNotNone(got)
        self.assertIn("tail", got)

    def test_last_occurrence_used_when_multiple_separators(self):
        sep = " ⟪⟪SEP_MARKER⟫⟫ "
        out = "a" + sep + "b" + sep + "last"
        got = try_extract_last_segment_from_full(out)
        self.assertIsNotNone(got)
        self.assertEqual(got.strip(), "last")

    def test_single_char_after_sep_returns_none(self):
        """长度 < 2 的段会被拒绝"""
        sep = " ⟪⟪SEP_MARKER⟫⟫ "
        out = "x" + sep + "y"
        got = try_extract_last_segment_from_full(out)
        self.assertIsNone(got)

    def test_two_chars_after_sep_returns_segment(self):
        sep = " ⟪⟪SEP_MARKER⟫⟫ "
        out = "pre" + sep + "ab"
        got = try_extract_last_segment_from_full(out)
        self.assertIsNotNone(got)
        self.assertEqual(got.strip(), "ab")


if __name__ == "__main__":
    unittest.main()
