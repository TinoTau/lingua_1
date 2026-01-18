# -*- coding: utf-8 -*-
"""
Semantic Repair Service - English - Prompt Templates Unit Tests
英文语义修复服务 - Prompt模板单元测试
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
        text_in = "The weather is nice today"
        prompt = self.template.build_repair_prompt(text_in)
        
        assert "post-processor for ASR output" in prompt
        assert text_in in prompt
        assert "Input:" in prompt
    
    def test_build_repair_prompt_with_context(self):
        """测试带微上下文的Prompt构建"""
        text_in = "The weather is nice today"
        micro_context = "Yesterday it rained"
        prompt = self.template.build_repair_prompt(text_in, micro_context=micro_context)
        
        assert text_in in prompt
        assert micro_context in prompt
        assert "Previous snippet:" in prompt
    
    def test_build_repair_prompt_with_quality_score(self):
        """测试带质量分数的Prompt构建"""
        text_in = "The weather is nice today"
        quality_score = 0.6
        prompt = self.template.build_repair_prompt(text_in, quality_score=quality_score)
        
        assert text_in in prompt
        assert "low quality score" in prompt
        assert "0.60" in prompt
    
    def test_build_repair_prompt_high_quality_score(self):
        """测试高质量分数（不应添加提示）"""
        text_in = "The weather is nice today"
        quality_score = 0.8
        prompt = self.template.build_repair_prompt(text_in, quality_score=quality_score)
        
        assert text_in in prompt
        assert "low quality score" not in prompt
    
    def test_build_repair_prompt_all_params(self):
        """测试所有参数"""
        text_in = "The weather is nice today"
        micro_context = "Yesterday it rained"
        quality_score = 0.65
        prompt = self.template.build_repair_prompt(
            text_in,
            micro_context=micro_context,
            quality_score=quality_score
        )
        
        assert text_in in prompt
        assert micro_context in prompt
        assert "low quality score" in prompt
    
    def test_build_system_message(self):
        """测试系统消息构建"""
        system_msg = self.template.build_system_message()
        
        assert "post-processor for ASR" in system_msg
        assert "misrecognized words" in system_msg
        assert "minimal edit" in system_msg
    
    def test_prompt_contains_rules(self):
        """测试Prompt包含规则"""
        prompt = self.template.build_repair_prompt("test text")
        
        assert "Make minimal edits" in prompt
        assert "Do not expand" in prompt
        assert "Preserve acronyms" in prompt
        assert "If the input is already fine" in prompt


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
