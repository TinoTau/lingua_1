# -*- coding: utf-8 -*-
"""
EN Normalize Service - Normalizer Unit Tests
英文文本标准化器单元测试
"""

import pytest
from normalizer import EnNormalizer


class TestEnNormalizer:
    """EnNormalizer测试类"""
    
    def setup_method(self):
        """每个测试方法前初始化"""
        self.normalizer = EnNormalizer()
    
    def test_normalize_empty_text(self):
        """测试空文本"""
        result = self.normalizer.normalize("")
        assert result['normalized_text'] == ""
        assert result['normalized'] is False
        assert result['reason_codes'] == []
    
    def test_normalize_whitespace_only(self):
        """测试只有空格的文本"""
        result = self.normalizer.normalize("   ")
        assert result['normalized_text'] == ""
        assert result['normalized'] is False
    
    def test_capitalize_sentence_start(self):
        """测试句首大写"""
        result = self.normalizer.normalize("hello world")
        assert result['normalized_text'] == "Hello world"
        assert result['normalized'] is True
    
    def test_already_capitalized(self):
        """测试已经大写的文本"""
        result = self.normalizer.normalize("Hello world")
        assert result['normalized_text'] == "Hello world"
        assert result['normalized'] is False
    
    def test_remove_duplicate_spaces(self):
        """测试去除重复空格"""
        result = self.normalizer.normalize("hello    world")
        assert result['normalized_text'] == "Hello world"
        assert result['normalized'] is True
    
    def test_normalize_punctuation(self):
        """测试标点规范化"""
        result = self.normalizer.normalize("hello ,world")
        assert result['normalized_text'] == "Hello, world"
        assert result['normalized'] is True
    
    def test_protect_abbreviations(self):
        """测试缩写保护"""
        result = self.normalizer.normalize("I use api and url")
        assert result['normalized_text'] == "I use API and URL"
        assert result['normalized'] is True
        assert 'ABBREVIATION_PROTECTED' in result['reason_codes']
    
    def test_protect_abbreviations_case_insensitive(self):
        """测试缩写保护（大小写不敏感）"""
        result = self.normalizer.normalize("I use Api and Url")
        assert result['normalized_text'] == "I use API and URL"
        assert result['normalized'] is True
    
    def test_detect_urls(self):
        """测试URL检测"""
        result = self.normalizer.normalize("Visit https://example.com")
        assert result['flags']['has_urls'] is True
        assert 'URL_EMAIL_PROTECTED' in result['reason_codes']
    
    def test_detect_emails(self):
        """测试邮箱检测"""
        result = self.normalizer.normalize("Contact me@example.com")
        assert result['flags']['has_emails'] is True
        assert 'URL_EMAIL_PROTECTED' in result['reason_codes']
    
    def test_detect_numbers(self):
        """测试数字检测"""
        result = self.normalizer.normalize("Price is $100")
        assert result['flags']['has_numbers'] is True
        assert 'NUMBER_NORMALIZED' in result['reason_codes']
    
    def test_detect_abbreviations(self):
        """测试缩写检测"""
        result = self.normalizer.normalize("I use api")
        assert result['flags']['has_abbreviations'] is True
    
    def test_complex_text(self):
        """测试复杂文本"""
        text = "hello   ,world  visit https://example.com or email me@test.com"
        result = self.normalizer.normalize(text)
        assert result['normalized'] is True
        assert result['flags']['has_urls'] is True
        assert result['flags']['has_emails'] is True
    
    def test_single_character(self):
        """测试单字符"""
        result = self.normalizer.normalize("a")
        assert result['normalized_text'] == "A"
        assert result['normalized'] is True
    
    def test_has_numbers_method(self):
        """测试has_numbers方法"""
        assert self.normalizer._has_numbers("Price is $100") is True
        assert self.normalizer._has_numbers("No numbers here") is False
    
    def test_has_abbreviations_method(self):
        """测试has_abbreviations方法"""
        assert self.normalizer._has_abbreviations("I use api") is True
        assert self.normalizer._has_abbreviations("No abbreviations") is False
    
    def test_has_urls_method(self):
        """测试has_urls方法"""
        assert self.normalizer._has_urls("Visit https://example.com") is True
        assert self.normalizer._has_urls("No URL here") is False
    
    def test_has_emails_method(self):
        """测试has_emails方法"""
        assert self.normalizer._has_emails("Contact me@example.com") is True
        assert self.normalizer._has_emails("No email here") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
