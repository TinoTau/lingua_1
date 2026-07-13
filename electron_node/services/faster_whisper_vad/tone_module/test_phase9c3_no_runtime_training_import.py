"""P9-C3 Runtime must not import training domain."""
from __future__ import annotations

import inspect
import unittest
from pathlib import Path

from tone_module import inference


class NoRuntimeTrainingImportTest(unittest.TestCase):
    def test_inference_has_no_training_import(self) -> None:
        source = inspect.getsource(inference)
        self.assertNotIn("tone_module.training", source)
        self.assertNotIn("import torch", source.lower())

    def test_runtime_py_files_no_training_import(self) -> None:
        tone_root = Path(__file__).resolve().parent
        runtime_files = [
            tone_root / "inference.py",
            tone_root / "loader.py",
            tone_root / "feature_v2.py",
        ]
        for path in runtime_files:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("tone_module.training", text, msg=str(path))
            self.assertNotIn("import torch", text.lower(), msg=str(path))


if __name__ == "__main__":
    unittest.main()
