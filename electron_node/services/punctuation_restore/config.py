# -*- coding: utf-8 -*-
"""断句服务配置"""

import os

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))


def get_host():
    return os.environ.get("HOST", "127.0.0.1")


def get_port():
    return int(os.environ.get("PORT", "5017"))
