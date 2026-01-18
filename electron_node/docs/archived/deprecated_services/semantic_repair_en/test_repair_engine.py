# -*- coding: utf-8 -*-
"""
Semantic Repair Service - English - Repair Engine Unit Tests
英文语义修复服务 - 修复引擎单元测试
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
import torch
from repair_engine import RepairEngine


class TestRepairEngine:
    """RepairEngine测试类"""
    
    def setup_method(self):
        """每个测试方法前初始化"""
        # 创建mock模型和tokenizer
        self.mock_model = MagicMock()
        self.mock_tokenizer = MagicMock()
        self.device = torch.device("cpu")
        
        # 配置tokenizer
        self.mock_tokenizer.eos_token_id = 2
        
        # 创建修复引擎
        self.engine = RepairEngine(
            self.mock_model,
            self.mock_tokenizer,
            self.device
        )
    
    def test_extract_repaired_text_no_prefix(self):
        """测试提取修复文本（无前缀）"""
        generated = "The weather is nice today"
        original = "The weather is nice today"
        result = self.engine._extract_repaired_text(generated, original)
        assert result == "The weather is nice today"
    
    def test_extract_repaired_text_with_prefix(self):
        """测试提取修复文本（有前缀）"""
        generated = "Corrected text: The weather is nice today"
        original = "The weather is nice today"
        result = self.engine._extract_repaired_text(generated, original)
        assert result == "The weather is nice today"
    
    def test_extract_repaired_text_empty(self):
        """测试提取修复文本（空文本）"""
        generated = ""
        original = "The weather is nice today"
        result = self.engine._extract_repaired_text(generated, original)
        assert result == original
    
    def test_extract_repaired_text_too_long(self):
        """测试提取修复文本（过长）"""
        generated = "The weather is nice today" * 10
        original = "The weather is nice today"
        result = self.engine._extract_repaired_text(generated, original)
        assert result == original
    
    def test_calculate_diff_identical(self):
        """测试计算diff（相同文本）"""
        text_in = "The weather is nice today"
        text_out = "The weather is nice today"
        diff = self.engine._calculate_diff(text_in, text_out)
        assert diff == []
    
    def test_calculate_diff_single_change(self):
        """测试计算diff（单个修改）"""
        text_in = "The weather is nice today"
        text_out = "The weather is good today"
        diff = self.engine._calculate_diff(text_in, text_out)
        assert len(diff) > 0
        assert diff[0]['from'] == "nice"
        assert diff[0]['to'] == "good"
    
    def test_calculate_diff_length_difference(self):
        """测试计算diff（长度不同）"""
        text_in = "The weather is"
        text_out = "The weather is nice today"
        diff = self.engine._calculate_diff(text_in, text_out)
        assert len(diff) > 0
    
    def test_calculate_confidence_identical(self):
        """测试计算置信度（相同文本）"""
        text_in = "The weather is nice today"
        text_out = "The weather is nice today"
        diff = []
        confidence = self.engine._calculate_confidence(text_in, text_out, diff)
        assert confidence == 1.0
    
    def test_calculate_confidence_small_change(self):
        """测试计算置信度（小修改）"""
        text_in = "The weather is nice today"
        text_out = "The weather is good today"
        diff = [{'from': 'nice', 'to': 'good', 'position': 15}]
        confidence = self.engine._calculate_confidence(text_in, text_out, diff)
        assert 0.5 <= confidence <= 1.0
    
    def test_calculate_confidence_large_change(self):
        """测试计算置信度（大修改）"""
        text_in = "The weather is nice today"
        text_out = "The weather is good tomorrow"
        diff = [
            {'from': 'nice', 'to': 'good', 'position': 15},
            {'from': 'today', 'to': 'tomorrow', 'position': 20}
        ]
        confidence = self.engine._calculate_confidence(text_in, text_out, diff)
        assert 0.5 <= confidence < 1.0
    
    @patch('repair_engine.time.time')
    def test_repair_success(self, mock_time):
        """测试修复成功"""
        # 设置mock
        mock_time.side_effect = [0.0, 0.1]  # start_time, end_time
        
        # 配置tokenizer
        self.mock_tokenizer.return_value = {
            'input_ids': torch.tensor([[1, 2, 3]]),
        }
        self.mock_tokenizer.decode.return_value = "The weather is nice today"
        
        # 配置模型
        mock_outputs = torch.tensor([[1, 2, 3, 4, 5]])
        self.mock_model.generate.return_value = mock_outputs
        
        # 执行修复
        result = self.engine.repair("The weather is nice today")
        
        # 验证结果
        assert 'text_out' in result
        assert 'confidence' in result
        assert 'diff' in result
        assert 'repair_time_ms' in result
        assert result['repair_time_ms'] == 100
    
    @patch('repair_engine.time.time')
    def test_repair_error_handling(self, mock_time):
        """测试修复错误处理"""
        # 设置mock
        mock_time.side_effect = [0.0, 0.1]
        
        # 配置tokenizer抛出异常
        self.mock_tokenizer.side_effect = Exception("Tokenization error")
        
        # 执行修复
        result = self.engine.repair("The weather is nice today")
        
        # 验证错误处理
        assert result['text_out'] == "The weather is nice today"  # 返回原文
        assert result['confidence'] == 0.5
        assert result['diff'] == []
    
    def test_warm_up(self):
        """测试模型预热"""
        # 配置mock
        self.mock_tokenizer.return_value = {
            'input_ids': torch.tensor([[1, 2, 3]]),
        }
        self.mock_tokenizer.decode.return_value = "The weather is nice today"
        mock_outputs = torch.tensor([[1, 2, 3, 4, 5]])
        self.mock_model.generate.return_value = mock_outputs
        
        # 执行预热
        self.engine.warm_up()
        
        # 验证模型被调用
        assert self.mock_model.generate.called


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
