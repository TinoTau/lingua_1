# -*- coding: utf-8 -*-
"""检查其他服务依赖包"""

import importlib

packages = [
    ('faster_whisper', 'faster_whisper'),
    ('TTS', 'TTS'),
    ('speechbrain', 'speechbrain'),
]

for name, import_name in packages:
    try:
        mod = importlib.import_module(import_name)
        version = getattr(mod, '__version__', 'installed')
        print(f"✅ {name}: {version}")
    except ImportError:
        print(f"❌ {name}: 未安装")
    except Exception as e:
        print(f"⚠️  {name}: 检查失败 - {str(e)[:50]}")
