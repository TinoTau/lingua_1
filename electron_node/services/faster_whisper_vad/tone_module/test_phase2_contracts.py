"""Phase 2 contract regression gates (Addendum §7)."""
from __future__ import annotations

import ast
import inspect
import unittest
from pathlib import Path

from tone_module import contract
from tone_module import mel
from tone_module.backends import numpy_p1
from tone_module.loader_v1 import get_tone_loader_v1

_FW_ROOT = Path(__file__).resolve().parents[1]
_TONE_ROOT = Path(__file__).resolve().parent

_PRODUCTION_RUNTIME_FILES = (
    _FW_ROOT / "api_routes.py",
    _TONE_ROOT / "inference.py",
    _TONE_ROOT / "__init__.py",
)

_FORBIDDEN_DEPLOYMENT_TOKENS = (
    "get_backend",
    "backend_registry",
    "model_registry",
    "hot_reload",
    "model_switch",
    "active_model",
    "TONE_MODEL_ID",
)

_FORBIDDEN_BACKEND_IMPORTS = (
    "recall",
    "ranking",
    "assembly",
    "kenlm",
    "apply",
)


class FeatureBaselineTest(unittest.TestCase):
    def test_mel_references_contract_ssot(self) -> None:
        self.assertEqual(mel.SAMPLE_RATE, contract.P0_SAMPLE_RATE)
        self.assertEqual(mel.N_FFT, contract.P0_N_FFT)
        self.assertEqual(mel.HOP_LENGTH, contract.P0_HOP_LENGTH)
        self.assertEqual(mel.N_MELS, contract.P0_N_MELS)
        self.assertEqual(mel.FMIN, contract.P0_FMIN)
        self.assertEqual(mel.FMAX, contract.P0_FMAX)

    def test_inference_min_slice_from_contract(self) -> None:
        from tone_module.inference import MIN_SLICE_SEC

        self.assertEqual(MIN_SLICE_SEC, contract.P1_MIN_SLICE_SEC)

    def test_legacy_feature_versions_kept(self) -> None:
        self.assertIn("p0-v1", contract.P0_COMPATIBLE_FEATURE_VERSIONS)
        self.assertIn("mel_mean_80_v1", contract.P0_COMPATIBLE_FEATURE_VERSIONS)


class LoaderContractTest(unittest.TestCase):
    def test_production_get_tone_loader_v1_uses_load_none(self) -> None:
        source = inspect.getsource(get_tone_loader_v1)
        self.assertIn("load(None)", source)
        self.assertNotIn("load(path", source)
        self.assertNotIn("load(model_path", source)


class BackendBoundaryTest(unittest.TestCase):
    def test_numpy_p1_source_has_no_forbidden_imports(self) -> None:
        source = inspect.getsource(numpy_p1).lower()
        for token in _FORBIDDEN_BACKEND_IMPORTS:
            self.assertNotIn(token, source)

    def test_numpy_p1_infer_batch_signature(self) -> None:
        sig = inspect.signature(numpy_p1.infer_batch)
        params = list(sig.parameters)
        self.assertEqual(params, ["feature_batch", "weights"])


class DeploymentBoundaryTest(unittest.TestCase):
    def test_tone_module_has_no_registry_or_switching(self) -> None:
        for py_file in _TONE_ROOT.rglob("*.py"):
            if py_file.name.startswith("test_"):
                continue
            if py_file.name.startswith("audit_"):
                continue
            text = py_file.read_text(encoding="utf-8").lower()
            for token in _FORBIDDEN_DEPLOYMENT_TOKENS:
                self.assertNotIn(token, text, msg=f"{py_file.name} contains {token}")


class ProductionRuntimeScanTest(unittest.TestCase):
    def test_production_runtime_has_no_p0_mel_path(self) -> None:
        inf = (_TONE_ROOT / "inference.py").read_text(encoding="utf-8")
        self.assertNotIn("extract_mel_features", inf)
        self.assertNotIn("numpy_p0", inf)
        self.assertNotIn("from tone_module.mel import", inf)

    def test_production_runtime_has_no_reset_singleton_calls(self) -> None:
        for path in _PRODUCTION_RUNTIME_FILES:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = None
                if isinstance(func, ast.Name):
                    name = func.id
                elif isinstance(func, ast.Attribute):
                    name = func.attr
                if name and name.startswith("reset_") and name.endswith("_singleton"):
                    self.fail(f"{path.name} invokes {name}")

    def test_production_runtime_has_no_explicit_loader_path(self) -> None:
        for path in _PRODUCTION_RUNTIME_FILES:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("load(model_path", text, msg=path.name)
            self.assertNotIn(".load(str(", text, msg=path.name)


if __name__ == "__main__":
    unittest.main()
