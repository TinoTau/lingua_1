# -*- coding: utf-8 -*-
"""
Config 单元测试
"""

import os
import pytest
from config import Config


def test_config_defaults():
    """测试默认配置"""
    config = Config()
    
    assert config.host == "127.0.0.1"
    assert config.port == 5015
    assert config.timeout == 30
    assert config.enable_zh_repair is True
    assert config.enable_en_repair is True
    assert config.enable_en_normalize is True


def test_config_from_env(monkeypatch):
    """测试从环境变量加载配置"""
    monkeypatch.setenv("HOST", "0.0.0.0")
    monkeypatch.setenv("PORT", "8080")
    monkeypatch.setenv("TIMEOUT", "60")
    monkeypatch.setenv("ENABLE_ZH_REPAIR", "false")
    
    config = Config()
    
    assert config.host == "0.0.0.0"
    assert config.port == 8080
    assert config.timeout == 60
    assert config.enable_zh_repair is False
    assert config.enable_en_repair is True


def test_get_enabled_processors():
    """测试获取启用的处理器"""
    config = Config()
    
    enabled = config.get_enabled_processors()
    
    # 应该包含配置了模型路径的处理器
    # （实际结果取决于模型是否存在）
    assert isinstance(enabled, dict)
    
    # en_normalize 应该总是包含（不需要模型）
    if config.enable_en_normalize:
        assert 'en_normalize' in enabled


def test_zh_config_structure():
    """测试中文配置结构"""
    config = Config()
    
    assert 'model_path' in config.zh_config
    assert 'n_ctx' in config.zh_config
    assert 'n_gpu_layers' in config.zh_config
    assert 'quality_threshold' in config.zh_config
    
    assert config.zh_config['n_ctx'] == 2048
    assert config.zh_config['n_gpu_layers'] == -1
    assert config.zh_config['quality_threshold'] == 0.85


def test_en_config_structure():
    """测试英文配置结构"""
    config = Config()
    
    assert 'model_path' in config.en_config
    assert 'n_ctx' in config.en_config
    assert 'n_gpu_layers' in config.en_config
    assert 'quality_threshold' in config.en_config


def test_norm_config_structure():
    """测试标准化配置结构"""
    config = Config()
    
    assert 'rules' in config.norm_config
    assert isinstance(config.norm_config['rules'], list)
