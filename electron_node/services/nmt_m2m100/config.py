# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 配置管理
"""
import os
import json


def load_config():
    """从配置文件加载配置"""
    config_path = os.path.join(os.path.dirname(__file__), "nmt_config.json")
    default_config = {
        "separator": {
            "default": " ⟪⟪SEP_MARKER⟫⟫ ",
            "translations": [" ⟪⟪SEP_MARKER⟫⟫ ", "⟪⟪SEP_MARKER⟫⟫", " ⟪⟪SEP_MARKER⟫⟫", "⟪⟪SEP_MARKER⟫⟫ "]
        }
    }
    
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                print(f"[NMT Service] Configuration loaded from {config_path}", flush=True)
                return config
        else:
            print(f"[NMT Service] Configuration file not found at {config_path}, using default config", flush=True)
            return default_config
    except Exception as e:
        print(f"[NMT Service] Failed to load configuration: {e}, using default config", flush=True)
        return default_config


# 加载配置
NMT_CONFIG = load_config()
SEPARATOR = NMT_CONFIG["separator"]["default"]
SEPARATOR_TRANSLATIONS = NMT_CONFIG["separator"]["translations"]
print(f"[NMT Service] Sentinel sequence configuration loaded: default='{SEPARATOR}', variants={len(SEPARATOR_TRANSLATIONS)}", flush=True)

# 加载文本过滤配置
PUNCTUATION_FILTER_ENABLED = NMT_CONFIG.get("text_filter", {}).get("punctuation_only_filter", {}).get("enabled", True)
PUNCTUATION_FILTER_PATTERN = NMT_CONFIG.get("text_filter", {}).get("punctuation_only_filter", {}).get("regex_pattern", r"[^\w\u4e00-\u9fff]")
PUNCTUATION_FILTER_MIN_LENGTH = NMT_CONFIG.get("text_filter", {}).get("punctuation_only_filter", {}).get("min_text_length_after_filter", 1)
print(f"[NMT Service] Punctuation filter configuration loaded: enabled={PUNCTUATION_FILTER_ENABLED}, pattern='{PUNCTUATION_FILTER_PATTERN}', min_length={PUNCTUATION_FILTER_MIN_LENGTH}", flush=True)

# SEP_MARKER 变体（用于清理残留的标记）
SEP_MARKER_VARIANTS = [' SEP_MARKER ', 'SEP_MARKER', ' SEP_MARKER', 'SEP_MARKER ']
