"""
文本去重功能单元测试
测试各种重复模式和边界情况
"""

import unittest
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from text_deduplicator import deduplicate_text


class TestTextDeduplicator(unittest.TestCase):
    """文本去重功能测试类"""
    
    def test_complete_duplication_simple(self):
        """测试完全重复（简单情况）"""
        # 测试用例：完全重复的短语
        test_cases = [
            ("这边能不能用这边能不能用", "这边能不能用"),
            ("这个地方我觉得还行这个地方我觉得还行", "这个地方我觉得还行"),
            ("你好你好", "你好"),
            ("测试测试", "测试"),
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected, 
                               f"输入: '{original}', 期望: '{expected}', 实际: '{result}'")
    
    def test_complete_duplication_complex(self):
        """测试完全重复（复杂情况）"""
        test_cases = [
            ("让我们来看看这个东西火锅继续爆错让我们来看看这个东西火锅继续爆错", 
             "让我们来看看这个东西火锅继续爆错"),
            ("欢迎不准确的地方,这个地方我觉得还行欢迎不准确的地方,这个地方我觉得还行",
             "欢迎不准确的地方,这个地方我觉得还行"),
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"输入: '{original}', 期望: '{expected}', 实际: '{result}'")
    
    def test_partial_duplication(self):
        """测试部分重复"""
        test_cases = [
            ("这个地方我觉得还行这个地方我觉得还行", "这个地方我觉得还行"),
            ("而且我发现其实我们可以装说话有很多而且我发现其实我们可以装说话有很多",
             "而且我发现其实我们可以装说话有很多"),
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"输入: '{original}', 期望: '{expected}', 实际: '{result}'")
    
    def test_no_duplication(self):
        """测试无重复的文本"""
        test_cases = [
            "这边能不能用",
            "这个地方我觉得还行",
            "让我们来看看这个东西",
            "而且我发现其实我们可以装说话有很多",
            "表达错误或者说",
            "欢迎不准确的地方,这个地方我觉得还行",
        ]
        
        for text in test_cases:
            with self.subTest(text=text):
                result = deduplicate_text(text)
                self.assertEqual(result, text,
                               f"无重复文本不应被修改: '{text}' -> '{result}'")
    
    def test_triple_duplication(self):
        """测试三重重复"""
        test_cases = [
            ("测试测试测试", "测试"),  # 三重重复应该被处理为完全重复
            ("你好你好你好", "你好"),
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"输入: '{original}', 期望: '{expected}', 实际: '{result}'")
    
    def test_edge_cases(self):
        """测试边界情况"""
        test_cases = [
            ("", ""),  # 空字符串
            ("   ", ""),  # 只有空格
            ("a", "a"),  # 单个字符
            ("ab", "ab"),  # 两个字符
            ("abc", "abc"),  # 三个字符
            ("abcd", "abcd"),  # 四个字符
            ("abcde", "abcde"),  # 五个字符
            ("abcdef", "abcdef"),  # 六个字符（刚好达到最小长度）
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"边界情况: '{original}' -> '{result}'")
    
    def test_whitespace_handling(self):
        """测试空格处理"""
        test_cases = [
            (" 这边能不能用这边能不能用  ", "这边能不能用"),  # 前后空格
            ("这边能不能用 这边能不能用", "这边能不能用"),  # 中间空格
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"空格处理: '{original}' -> '{result}'")
    
    def test_nested_duplication(self):
        """测试嵌套重复（重复的短语内部还有重复）"""
        # 这种情况应该先处理外层重复
        test_cases = [
            ("测试测试测试测试", "测试"),  # 四重重复
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"嵌套重复: '{original}' -> '{result}'")
    
    def test_mixed_duplication(self):
        """测试混合重复（完全重复和部分重复混合）"""
        # 这种情况应该优先处理完全重复
        test_cases = [
            ("这边能不能用这边能不能用这边能不能用", "这边能不能用"),  # 三重完全重复
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"混合重复: '{original}' -> '{result}'")
    
    def test_real_world_examples(self):
        """测试真实世界的例子"""
        test_cases = [
            # 用户报告的实际问题
            ("这边能不能用这边能不能用", "这边能不能用"),
            ("这个地方我觉得还行这个地方我觉得还行", "这个地方我觉得还行"),
            ("让我们来看看这个东西火锅继续爆错让我们来看看这个东西火锅继续爆错",
             "让我们来看看这个东西火锅继续爆错"),
            ("而且我发现其实我们可以装说话有很多而且我发现其实我们可以装说话有很多",
             "而且我发现其实我们可以装说话有很多"),
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"真实案例: '{original}' -> '{result}'")
    
    def test_unicode_handling(self):
        """测试Unicode字符处理"""
        test_cases = [
            ("你好你好", "你好"),
            ("こんにちはこんにちは", "こんにちは"),  # 日文
            ("안녕하세요안녕하세요", "안녕하세요"),  # 韩文
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"Unicode处理: '{original}' -> '{result}'")
    
    def test_punctuation_handling(self):
        """测试标点符号处理"""
        test_cases = [
            ("欢迎不准确的地方,这个地方我觉得还行欢迎不准确的地方,这个地方我觉得还行",
             "欢迎不准确的地方,这个地方我觉得还行"),
            ("测试。测试。", "测试。"),  # 有重复，应该去重
            ("测试，测试", "测试，测试"),  # 无重复，不应修改（逗号分隔）
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"标点符号处理: '{original}' -> '{result}'")
    
    def test_start_end_duplication(self):
        """测试开头和结尾的重复（新增功能）"""
        test_cases = [
            ("导致没有办法播 那些问题 导致没有办法播", "导致没有办法播 那些问题"),
            ("测试A 中间文本 测试A", "测试A 中间文本"),
            ("你好 世界 你好", "你好 世界"),
            ("上下温功能有没有生效? 上下温功能有没有生效?", "上下温功能有没有生效?"),
        ]
        
        for original, expected in test_cases:
            with self.subTest(original=original):
                result = deduplicate_text(original)
                self.assertEqual(result, expected,
                               f"开头结尾重复处理: '{original}' -> '{result}', 期望: '{expected}'")
        print("✅ 开头结尾重复测试通过")


class TestTextDeduplicatorPerformance(unittest.TestCase):
    """性能测试"""
    
    def test_long_text(self):
        """测试长文本"""
        # 创建一个长文本，包含重复
        base_text = "这是一个很长的文本，用来测试去重功能的性能。"
        long_text = base_text * 2  # 重复一次
        
        result = deduplicate_text(long_text)
        self.assertEqual(result, base_text,
                        f"长文本去重失败: '{long_text[:50]}...' -> '{result[:50]}...'")
    
    def test_very_long_text(self):
        """测试超长文本"""
        # 创建一个超长文本（使用不重复的短语，避免内部重复）
        base_text = "这是一个很长的文本，用来测试去重功能的性能。包含多个不同的句子，确保没有内部重复。"
        # 重复整个文本2次
        very_long_text = base_text * 2
        
        result = deduplicate_text(very_long_text)
        self.assertEqual(result, base_text,
                        f"超长文本去重失败: 期望长度={len(base_text)}, 实际长度={len(result)}")


def run_tests():
    """运行所有测试"""
    # 创建测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # 添加所有测试类
    suite.addTests(loader.loadTestsFromTestCase(TestTextDeduplicator))
    suite.addTests(loader.loadTestsFromTestCase(TestTextDeduplicatorPerformance))
    
    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # 返回测试结果
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)

