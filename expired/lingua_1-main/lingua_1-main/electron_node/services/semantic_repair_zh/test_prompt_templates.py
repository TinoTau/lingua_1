# -*- coding: utf-8 -*-
"""
Semantic Repair Service - Chinese - Prompt Templates Unit Tests
中文语义修复服务 - Prompt模板单元测试
"""

import pytest
from prompt_templates import PromptTemplate


class TestPromptTemplate:
    """PromptTemplate测试类"""
    
    def setup_method(self):
        """每个测试方法前初始化"""
        self.template = PromptTemplate()
    
    def test_build_repair_prompt_basic(self):
        """测试基础Prompt构建"""
        text_in = "今天天气很好"
        prompt = self.template.build_repair_prompt(text_in)
        
        assert "你是语音识别后处理器" in prompt
        assert text_in in prompt
        assert "原文：" in prompt
    
    def test_build_repair_prompt_with_context(self):
        """测试带微上下文的Prompt构建"""
        text_in = "今天天气很好"
        micro_context = "昨天下了雨"
        prompt = self.template.build_repair_prompt(text_in, micro_context=micro_context)
        
        assert text_in in prompt
        assert micro_context in prompt
        assert "上一句片段：" in prompt
    
    def test_build_repair_prompt_with_quality_score(self):
        """测试带质量分数的Prompt构建"""
        text_in = "今天天气很好"
        quality_score = 0.6
        prompt = self.template.build_repair_prompt(text_in, quality_score=quality_score)
        
        assert text_in in prompt
        assert "质量分数较低" in prompt
        assert "0.60" in prompt
    
    def test_build_repair_prompt_high_quality_score(self):
        """测试高质量分数（不应添加提示）"""
        text_in = "今天天气很好"
        quality_score = 0.8
        prompt = self.template.build_repair_prompt(text_in, quality_score=quality_score)
        
        assert text_in in prompt
        assert "质量分数较低" not in prompt
    
    def test_build_repair_prompt_all_params(self):
        """测试所有参数"""
        text_in = "今天天气很好"
        micro_context = "昨天下了雨"
        quality_score = 0.65
        prompt = self.template.build_repair_prompt(
            text_in,
            micro_context=micro_context,
            quality_score=quality_score
        )
        
        assert text_in in prompt
        assert micro_context in prompt
        assert "质量分数较低" in prompt
    
    def test_build_system_message(self):
        """测试系统消息构建"""
        system_msg = self.template.build_system_message()
        
        assert "语音识别后处理器" in system_msg
        assert "同音字错误" in system_msg
        assert "最小编辑" in system_msg
    
    def test_prompt_contains_rules(self):
        """测试Prompt包含规则"""
        prompt = self.template.build_repair_prompt("测试文本")
        
        assert "尽量少改动原文" in prompt
        assert "不要扩写" in prompt
        assert "禁止新增实体" in prompt
        assert "如果原文合理，原样输出" in prompt


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
