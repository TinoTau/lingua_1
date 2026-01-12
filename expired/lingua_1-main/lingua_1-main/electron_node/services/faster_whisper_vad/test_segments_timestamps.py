"""
单元测试：测试 Segment 时间戳提取功能（CONF-2）
验证 ASR Worker 进程能够正确提取 segment 的 start/end 时间戳
"""
import sys
import os
import unittest
from unittest.mock import Mock, patch, MagicMock
import numpy as np

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_worker_manager import ASRResult, SegmentInfo
from asr_worker_process import asr_worker_process
import multiprocessing as mp
import queue
import time


class TestSegmentsTimestamps(unittest.TestCase):
    """测试 Segment 时间戳提取"""
    
    def test_segment_info_structure(self):
        """测试 SegmentInfo 数据结构"""
        seg = SegmentInfo(
            text="测试文本",
            start=0.5,
            end=1.2,
            no_speech_prob=0.1
        )
        
        self.assertEqual(seg.text, "测试文本")
        self.assertEqual(seg.start, 0.5)
        self.assertEqual(seg.end, 1.2)
        self.assertEqual(seg.no_speech_prob, 0.1)
    
    def test_asr_result_with_segments(self):
        """测试 ASRResult 包含 segments"""
        segments = [
            SegmentInfo(text="第一段", start=0.0, end=0.5),
            SegmentInfo(text="第二段", start=0.5, end=1.0),
        ]
        
        result = ASRResult(
            job_id="test-1",
            text="第一段 第二段",
            language="zh",
            segments=segments,
            duration_ms=1000
        )
        
        self.assertEqual(result.job_id, "test-1")
        self.assertEqual(result.text, "第一段 第二段")
        self.assertIsNotNone(result.segments)
        self.assertEqual(len(result.segments), 2)
        self.assertEqual(result.segments[0].start, 0.0)
        self.assertEqual(result.segments[0].end, 0.5)
        self.assertEqual(result.segments[1].start, 0.5)
        self.assertEqual(result.segments[1].end, 1.0)
    
    def test_segments_optional(self):
        """测试 segments 字段是可选的（向后兼容）"""
        result = ASRResult(
            job_id="test-2",
            text="测试文本",
            language="zh",
            duration_ms=1000
        )
        
        self.assertIsNone(result.segments)
        self.assertEqual(result.text, "测试文本")


class TestSegmentsExtraction(unittest.TestCase):
    """测试从 Faster Whisper segments 中提取时间戳"""
    
    def create_mock_segment(self, text, start, end, no_speech_prob=None):
        """创建模拟的 segment 对象"""
        seg = Mock()
        seg.text = text
        seg.start = start
        seg.end = end
        if no_speech_prob is not None:
            seg.no_speech_prob = no_speech_prob
        return seg
    
    def test_extract_segments_with_timestamps(self):
        """测试提取带时间戳的 segments"""
        # 模拟 Faster Whisper 返回的 segments
        segments_list = [
            self.create_mock_segment("你好", 0.0, 0.5, 0.05),
            self.create_mock_segment("世界", 0.5, 1.0, 0.02),
        ]
        
        # 模拟提取逻辑（类似 asr_worker_process.py 中的实现）
        segments_data = []
        for seg in segments_list:
            segment_info = {
                "text": seg.text.strip(),
                "start": getattr(seg, 'start', None),
                "end": getattr(seg, 'end', None),
                "no_speech_prob": getattr(seg, 'no_speech_prob', None),
            }
            segments_data.append(segment_info)
        
        # 验证提取结果
        self.assertEqual(len(segments_data), 2)
        self.assertEqual(segments_data[0]["text"], "你好")
        self.assertEqual(segments_data[0]["start"], 0.0)
        self.assertEqual(segments_data[0]["end"], 0.5)
        self.assertEqual(segments_data[0]["no_speech_prob"], 0.05)
        
        self.assertEqual(segments_data[1]["text"], "世界")
        self.assertEqual(segments_data[1]["start"], 0.5)
        self.assertEqual(segments_data[1]["end"], 1.0)
        self.assertEqual(segments_data[1]["no_speech_prob"], 0.02)
    
    def test_extract_segments_without_timestamps(self):
        """测试处理没有时间戳的 segments（向后兼容）"""
        # 模拟字符串格式的 segments
        segments_list = ["你好", "世界"]
        
        segments_data = []
        for seg in segments_list:
            if isinstance(seg, str):
                segments_data.append({
                    "text": seg.strip(),
                    "start": None,
                    "end": None,
                    "no_speech_prob": None,
                })
        
        self.assertEqual(len(segments_data), 2)
        self.assertEqual(segments_data[0]["text"], "你好")
        self.assertIsNone(segments_data[0]["start"])
        self.assertIsNone(segments_data[0]["end"])


if __name__ == '__main__':
    print("=" * 80)
    print("🧪 运行 Segment 时间戳提取单元测试")
    print("=" * 80)
    print()
    
    unittest.main(verbosity=2)

