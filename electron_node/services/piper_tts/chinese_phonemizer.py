"""
中文拼音音素化器
使用 lexicon.txt 将中文文本转换为拼音音素
"""

import re
from pathlib import Path
from typing import List, Optional, Dict


class ChinesePhonemizer:
    """使用 lexicon.txt 进行中文音素化"""
    
    def __init__(self, lexicon_path: str):
        """
        初始化音素化器
        
        Args:
            lexicon_path: lexicon.txt 文件路径
        """
        self.lexicon_path = Path(lexicon_path)
        self.lexicon: Dict[str, List[str]] = {}
        self._load_lexicon()
    
    def _load_lexicon(self):
        """加载 lexicon.txt 文件"""
        if not self.lexicon_path.exists():
            raise FileNotFoundError(f"Lexicon file not found: {self.lexicon_path}")
        
        with open(self.lexicon_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                # 格式: 汉字 音素1 音素2 ... #0
                parts = line.split()
                if len(parts) < 2:
                    continue
                
                char = parts[0]
                # 保留所有音素，包括 #0（这是模型需要的分隔符）
                phonemes = parts[1:]
                if phonemes:
                    self.lexicon[char] = phonemes
    
    def phonemize(self, text: str) -> List[List[str]]:
        """
        将中文文本转换为拼音音素
        
        根据原项目的文档，正确的音素序列格式应该是：
        sil + 声母 + 韵母 + sp + ... + eos
        
        lexicon 中的格式是：声母 + 韵母 + #0
        需要转换为：sil + 声母 + 韵母 + sp + ... + eos
        
        Args:
            text: 中文文本
            
        Returns:
            音素列表，按句子分组
        """
        # 按句子分割（简单处理，使用标点符号）
        sentences = re.split(r'([。！？\n])', text)
        result = []
        
        for sentence in sentences:
            if not sentence.strip():
                continue
            
            phonemes = []
            i = 0
            while i < len(sentence):
                char = sentence[i]
                
                # 尝试匹配最长的词（最多4个字符）
                matched = False
                for length in range(4, 0, -1):
                    if i + length <= len(sentence):
                        word = sentence[i:i+length]
                        if word in self.lexicon:
                            # 获取词的所有音素
                            word_phonemes = self.lexicon[word].copy()
                            # 将 #0 替换为 sp（根据原项目文档）
                            word_phonemes = ['sp' if p == '#0' else p for p in word_phonemes]
                            phonemes.extend(word_phonemes)
                            i += length
                            matched = True
                            break
                
                if not matched:
                    # 单字匹配
                    if char in self.lexicon:
                        char_phonemes = self.lexicon[char].copy()
                        # 将 #0 替换为 sp
                        char_phonemes = ['sp' if p == '#0' else p for p in char_phonemes]
                        phonemes.extend(char_phonemes)
                    else:
                        # 未知字符，跳过或使用空格
                        if char.strip():
                            # 对于未知字符，可以添加一个占位符或跳过
                            pass
                    i += 1
            
            if phonemes:
                # 根据原项目文档，格式应该是：sil + 声母 + 韵母 + sp + ... + eos
                # 在开头添加 sil（如果还没有）
                if not phonemes or phonemes[0] != 'sil' and phonemes[0] != '_':
                    phonemes.insert(0, 'sil')
                # 在结尾添加 eos（如果还没有）
                if not phonemes or phonemes[-1] != 'eos' and phonemes[-1] != '$':
                    phonemes.append('eos')
                result.append(phonemes)
        
        # 如果没有匹配到任何音素，返回空列表
        if not result:
            result.append([])
        
        return result

