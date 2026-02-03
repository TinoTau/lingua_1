# -*- coding: utf-8 -*-
"""
单元测试：语义修复服务能被正确识别并处理文本。
- TestZhRepairProcessorInitialization：mock 测试 lifespan 中 ensure_initialized 后 _initialized 与 warmed 正确设置。
- /health 与 /zh/repair 的完整流程见 integration/test_traditional_to_simplified.py、test_service.py 等（需启动服务或有模型）。
"""

import os
import sys

_svc_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _svc_root not in sys.path:
    sys.path.insert(0, _svc_root)

import pytest


class TestZhRepairProcessorInitialization:
    """测试 ZhRepairProcessor 初始化后 _initialized 与 warmed 被正确设置。"""

    @pytest.mark.asyncio
    async def test_ensure_initialized_sets_initialized_and_warmed_with_mock_engine(self):
        """ensure_initialized 成功后应设置 _initialized=True，且 warmup 成功时 warmed=True。"""
        from unittest.mock import MagicMock, patch
        from processors.zh_repair_processor import ZhRepairProcessor

        mock_engine = MagicMock()
        mock_engine.repair = MagicMock(
            return_value={"text_out": "你好，这是一个测试句子。", "confidence": 0.9, "diff": []}
        )

        with patch("processors.zh_repair_processor.LlamaCppEngine", return_value=mock_engine):
            with patch("os.path.exists", return_value=True):
                config = {"model_path": "/fake/path/model.gguf", "n_ctx": 2048, "n_gpu_layers": -1}
                processor = ZhRepairProcessor(config)
                await processor.ensure_initialized()

        assert processor._initialized is True
        assert processor.warmed is True
        assert processor.engine is mock_engine
