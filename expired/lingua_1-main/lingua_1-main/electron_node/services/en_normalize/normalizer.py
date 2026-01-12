# -*- coding: utf-8 -*-
"""
EN Normalize Service - Normalizer
英文文本标准化器
"""

import re
from typing import Dict, List


class EnNormalizer:
    """英文文本标准化器"""
    
    # 常见技术缩写列表
    TECHNICAL_ABBREVIATIONS = [
        'API', 'URL', 'HTTP', 'HTTPS', 'GPU', 'CPU', 'SQL', 'JSON', 'XML',
        'HTML', 'CSS', 'JS', 'TS', 'IDE', 'OS', 'UI', 'UX', 'AI', 'ML',
        'NLP', 'ASR', 'NMT', 'TTS', 'VAD', 'WAV', 'MP3', 'OPUS',
        'PDF', 'CSV', 'ZIP', 'RAR', 'TXT', 'DOC', 'XLS', 'PPT',
        'JPG', 'PNG', 'GIF', 'SVG', 'BMP', 'ICO',
    ]
    
    def __init__(self):
        """初始化标准化器"""
        # 预编译正则表达式以提高性能
        self._url_pattern = re.compile(r'https?://[^\s]+|www\.[^\s]+', re.IGNORECASE)
        self._email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
        self._number_pattern = re.compile(r'\d')
        self._whitespace_pattern = re.compile(r'\s+')
        self._punctuation_before_space = re.compile(r'\s+([,.!?;:])')
        self._punctuation_after_no_space = re.compile(r'([,.!?;:])([^\s])')
    
    def normalize(
        self,
        text: str,
        quality_score: float = 1.0
    ) -> Dict:
        """
        标准化英文文本
        
        Args:
            text: 输入文本
            quality_score: 质量分数（0.0-1.0）
        
        Returns:
            {
                'normalized_text': str,
                'normalized': bool,
                'flags': {
                    'has_numbers': bool,
                    'has_abbreviations': bool,
                    'has_urls': bool,
                    'has_emails': bool,
                },
                'reason_codes': List[str]
            }
        """
        if not text or not text.strip():
            return {
                'normalized_text': text,
                'normalized': False,
                'flags': {},
                'reason_codes': [],
            }
        
        original_text = text
        reason_codes: List[str] = []
        flags: Dict[str, bool] = {}
        
        # 1. 检测特殊内容
        flags['has_numbers'] = self._has_numbers(text)
        flags['has_abbreviations'] = self._has_abbreviations(text)
        flags['has_urls'] = self._has_urls(text)
        flags['has_emails'] = self._has_emails(text)
        
        # 2. 基础文本规范化
        normalized_text = self._normalize_text(text)
        
        # 3. 数字/单位规范化（可选，仅在必要时）
        if flags['has_numbers']:
            normalized_text = self._normalize_numbers(normalized_text)
            reason_codes.append('NUMBER_NORMALIZED')
        
        # 4. 缩写保护
        if flags['has_abbreviations']:
            normalized_text = self._protect_abbreviations(normalized_text)
            reason_codes.append('ABBREVIATION_PROTECTED')
        
        # 5. URL/邮箱保护（确保它们不被修改）
        if flags['has_urls'] or flags['has_emails']:
            normalized_text = self._protect_urls_and_emails(normalized_text)
            reason_codes.append('URL_EMAIL_PROTECTED')
        
        normalized = normalized_text != original_text
        
        return {
            'normalized_text': normalized_text,
            'normalized': normalized,
            'flags': flags,
            'reason_codes': reason_codes,
        }
    
    def _normalize_text(self, text: str) -> str:
        """基础文本规范化"""
        normalized = text
        
        # 1. 统一大小写（句首大写）
        normalized = self._capitalize_sentence_start(normalized)
        
        # 2. 去除重复空格
        normalized = self._whitespace_pattern.sub(' ', normalized).strip()
        
        # 3. 规范化标点
        normalized = self._normalize_punctuation(normalized)
        
        return normalized
    
    def _capitalize_sentence_start(self, text: str) -> str:
        """句首大写"""
        if not text:
            return text
        return text[0].upper() + text[1:] if len(text) > 1 else text.upper()
    
    def _normalize_punctuation(self, text: str) -> str:
        """规范化标点符号"""
        # 移除标点前的空格
        normalized = self._punctuation_before_space.sub(r'\1', text)
        # 标点后添加空格（如果缺失）
        normalized = self._punctuation_after_no_space.sub(r'\1 \2', normalized)
        return normalized
    
    def _normalize_numbers(self, text: str) -> str:
        """
        规范化数字
        注意：暂时跳过复杂转换，避免误处理
        """
        # 保守处理：只处理明显的口语数字
        # 例如：one hundred and five -> 105
        # 暂时跳过，避免误处理
        return text
    
    def _protect_abbreviations(self, text: str) -> str:
        """保护缩写（转换为全大写）"""
        protected_text = text
        for abbr in self.TECHNICAL_ABBREVIATIONS:
            # 匹配小写或混合大小写的缩写，转换为全大写
            pattern = re.compile(r'\b' + re.escape(abbr) + r'\b', re.IGNORECASE)
            protected_text = pattern.sub(abbr, protected_text)
        return protected_text
    
    def _protect_urls_and_emails(self, text: str) -> str:
        """
        保护URL和邮箱
        注意：URL和邮箱已经在检测时识别，这里只需要确保它们不被修改
        实际保护在后续的LLM修复阶段通过Prompt实现
        """
        # 暂时不做处理，保持原样
        return text
    
    def _has_numbers(self, text: str) -> bool:
        """检测是否包含数字"""
        return bool(self._number_pattern.search(text))
    
    def _has_abbreviations(self, text: str) -> bool:
        """检测是否包含缩写"""
        lower_text = text.lower()
        common_abbrs = [
            'api', 'url', 'http', 'gpu', 'cpu', 'sql', 'json', 'xml',
            'html', 'css', 'js', 'ts', 'ide', 'os', 'ui', 'ux', 'ai', 'ml',
        ]
        return any(abbr in lower_text for abbr in common_abbrs)
    
    def _has_urls(self, text: str) -> bool:
        """检测是否包含URL"""
        return bool(self._url_pattern.search(text))
    
    def _has_emails(self, text: str) -> bool:
        """检测是否包含邮箱"""
        return bool(self._email_pattern.search(text))
