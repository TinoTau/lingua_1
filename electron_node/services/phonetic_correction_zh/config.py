# -*- coding: utf-8 -*-
"""中文同音纠错服务配置"""

import os

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL_NAME = "zh_char_3gram.trie.bin"


def get_host():
    return os.environ.get("HOST", "127.0.0.1")


def get_port():
    return int(os.environ.get("PORT", "5016"))


def get_model_path():
    env_path = os.environ.get("CHAR_LM_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path
    p = os.path.join(SERVICE_DIR, "models", DEFAULT_MODEL_NAME)
    return p if os.path.isfile(p) else None
