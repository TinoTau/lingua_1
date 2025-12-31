"""
数据模型定义
"""

import sys
from typing import Optional
from pydantic import BaseModel

try:
    from pydantic import ConfigDict
    PYDANTIC_V2 = True
except ImportError:
    PYDANTIC_V2 = False


class TtsRequest(BaseModel):
    text: str
    voice: str
    language: Optional[str] = None
    
    # Pydantic V2 configuration (backward compatible)
    if PYDANTIC_V2:
        model_config = ConfigDict()
        # Note: json_encoders is removed in Pydantic V2
        # String encoding is handled automatically
    else:
        class Config:
            # Pydantic V1 configuration
            json_encoders = {
                str: lambda v: v.encode('utf-8').decode('utf-8') if isinstance(v, str) else v
            }
