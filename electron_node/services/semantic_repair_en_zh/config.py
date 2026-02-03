# -*- coding: utf-8 -*-
"""
统一配置管理
"""

import os
from typing import Dict, Any, Optional


class Config:
    """统一配置管理"""
    
    def __init__(self):
        # 全局配置
        self.host = os.environ.get("HOST", "127.0.0.1")
        self.port = int(os.environ.get("PORT", 5015))
        self.timeout = int(os.environ.get("TIMEOUT", 30))  # 处理超时（秒）
        
        # 启用/禁用处理器（可通过环境变量控制）
        self.enable_zh_repair = os.environ.get("ENABLE_ZH_REPAIR", "true").lower() == "true"
        self.enable_en_repair = os.environ.get("ENABLE_EN_REPAIR", "true").lower() == "true"
        self.enable_en_normalize = os.environ.get("ENABLE_EN_NORMALIZE", "true").lower() == "true"
        
        # 服务基础目录
        self.service_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 中文语义修复配置（同音纠错已拆至 phonetic_correction_zh，本服务不调用）
        self.zh_config = {
            'model_path': self._find_model('zh'),
            'n_ctx': 2048,
            'n_gpu_layers': -1,
            'quality_threshold': 0.85
        }
        
        # 英文语义修复配置
        self.en_config = {
            'model_path': self._find_model('en'),
            'n_ctx': 2048,
            'n_gpu_layers': -1,
            'quality_threshold': 0.85
        }
        
        # 英文标准化配置
        self.norm_config = {
            'rules': ['lowercase', 'punctuation', 'whitespace']
        }
    
    def _find_model(self, lang: str) -> Optional[str]:
        """
        查找模型路径（仅在本服务目录下查找）
        
        Args:
            lang: 语言代码（zh 或 en）
        
        Returns:
            str: 模型路径，如果未找到返回 None
        """
        # 模型目录名称
        model_dir_name = {
            'zh': 'qwen2.5-3b-instruct-zh-gguf',
            'en': 'qwen2.5-3b-instruct-en-gguf'
        }.get(lang)
        
        if not model_dir_name:
            return None
        
        # 只在统一服务目录下查找模型
        model_dir = os.path.join(self.service_dir, 'models', model_dir_name)
        
        if os.path.exists(model_dir):
            # 查找 .gguf 文件
            for file in os.listdir(model_dir):
                if file.endswith('.gguf'):
                    model_path = os.path.join(model_dir, file)
                    print(f"[Config] Found {lang} model: {model_path}")
                    return model_path
        
        # 未找到模型
        print(f"[Config] WARNING: {lang} model not found at: {model_dir}")
        print(f"[Config] Please copy model to: {model_dir}")
        return None
    
    def get_enabled_processors(self) -> Dict[str, Dict[str, Any]]:
        """
        获取启用的处理器配置
        
        Returns:
            Dict[str, Dict[str, Any]]: 处理器名称 -> 配置
        """
        processors = {}
        
        if self.enable_zh_repair and self.zh_config.get('model_path'):
            processors['zh_repair'] = self.zh_config
        
        if self.enable_en_repair and self.en_config.get('model_path'):
            processors['en_repair'] = self.en_config
        
        if self.enable_en_normalize:
            processors['en_normalize'] = self.norm_config
        
        return processors
