"""Phase 6-E AISHELL-3 dataset adapter regression gates."""
from __future__ import annotations

import hashlib
import inspect
import json
import os
import tempfile
import unittest
import wave
from collections import Counter
from pathlib import Path

from tone_module import contract
from tone_module import train_tone_cnn
from tone_module.dataset import (
    DEFAULT_DATASET_REPO,
    OPENSRL_AISHELL3_DATASET_ID,
    OpenSlrAishell3DatasetAdapter,
    TextGridPinyinAlignmentProvider,
    aishell3_pipeline,
    default_data_mini_pipeline,
)
from tone_module.dataset.adapter_openslr_aishell3 import DEFAULT_DATASET_VERSION
from tone_module.dataset.cache_layout import CacheLayout
from tone_module.dataset.probe_aishell3 import ProbeFilters, audit_join, cmd_stats, main as probe_main
from tone_module.mel import extract_mel_features

_TONE_ROOT = Path(__file__).resolve().parent
_RUNTIME_FROZEN = (
    _TONE_ROOT / "contract.py",
    _TONE_ROOT / "loader.py",
    _TONE_ROOT / "mel.py",
    _TONE_ROOT / "inference.py",
    _TONE_ROOT / "classifier.py",
    _TONE_ROOT / "backends" / "numpy_p0.py",
    _TONE_ROOT / "validate_artifact.py",
)

_BASELINE_TOTAL_SYLLABLES = 11820
_BASELINE_TRAIN_SYLLABLES = 10012
_BASELINE_VAL_SYLLABLES = 1808
_BASELINE_CLASS_TOTAL = {0: 2570, 1: 2702, 2: 1716, 3: 4314, 4: 518}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_min_wav(path: str, *, duration_sec: float = 0.5, sample_rate: int = 44100) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frame_count = max(1, int(duration_sec * sample_rate))
    with wave.open(path, "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)


def _write_textgrid(path: str, intervals: list[tuple[float, float, str]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [
        'File type = "ooTextFile"',
        'Object class = "TextGrid"',
        "",
        "xmin = 0",
        "xmax = 1",
        "tiers? <size> = 1",
        'item []:',
        '    class = "IntervalTier"',
        '    name = "phones"',
        f"    intervals: size = {len(intervals)}",
    ]
    for index, (start, end, token) in enumerate(intervals, start=1):
        lines.extend(
            [
                f"    intervals [{index}]:",
                f"        xmin = {start}",
                f"        xmax = {end}",
                f'        text = "{token}"',
            ]
        )
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def _build_aishell_fixture(root: str) -> tuple[str, str]:
    audio_root = os.path.join(root, "audio_fixture")
    alignment_root = os.path.join(root, "alignment_fixture")
    wav_path = os.path.join(audio_root, "train", "wav", "SSB0001", "ID0001W0001.wav")
    tg_path = os.path.join(alignment_root, "SSB0001", "ID0001W0001.TextGrid")
    _write_min_wav(wav_path)
    _write_textgrid(
        tg_path,
        [
            (0.0, 0.08, "ni3"),
            (0.08, 0.20, "hao3"),
            (0.20, 0.35, "ma5"),
            (0.35, 0.50, "sp"),
        ],
    )
    return audio_root, alignment_root


class FrozenArchitectureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._frozen_hashes = {path: _sha256(path) for path in _RUNTIME_FROZEN}

    def test_frozen_files_unchanged(self) -> None:
        for path, expected in self._frozen_hashes.items():
            self.assertTrue(path.is_file(), msg=str(path))
            self.assertEqual(_sha256(path), expected, msg=f"frozen file modified: {path}")

    def test_dataset_modules_do_not_import_runtime_decision(self) -> None:
        forbidden = ("inference", "classifier", "get_tone_loader", "api_routes")
        for path in (_TONE_ROOT / "dataset").rglob("*.py"):
            text = path.read_text(encoding="utf-8").lower()
            for token in forbidden:
                self.assertNotIn(token, text, msg=f"{path.name} imports {token}")


class OpenSlrAishell3AdapterTest(unittest.TestCase):
    def test_fixture_materialize_and_manifest_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio_root, alignment_root = _build_aishell_fixture(tmp)
            cache_dir = os.path.join(tmp, "cache")
            adapter = OpenSlrAishell3DatasetAdapter(
                local_audio_root=audio_root,
                local_textgrid_root=alignment_root,
                skip_download=True,
            )
            manifest1 = adapter.materialize(cache_dir)
            manifest2 = adapter.materialize(cache_dir)

            self.assertEqual(manifest1.dataset_id, OPENSRL_AISHELL3_DATASET_ID)
            self.assertEqual(manifest1.version, DEFAULT_DATASET_VERSION)
            self.assertEqual(manifest1.materialized_root, manifest2.materialized_root)
            self.assertEqual(manifest1.alignment_source, "lars76_aishell3_textgrid")
            self.assertIn("Apache-2.0", manifest1.metadata.license)

            layout = CacheLayout(cache_dir)
            self.assertTrue(os.path.isfile(layout.manifest_path(OPENSRL_AISHELL3_DATASET_ID, "v1")))
            self.assertTrue(os.path.isdir(os.path.join(manifest1.materialized_root, "audio")))
            self.assertTrue(os.path.isdir(os.path.join(manifest1.materialized_root, "alignment")))
            self.assertTrue(layout.is_materialized_root_valid(manifest1.materialized_root))

    def test_aishell3_pipeline_join_and_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio_root, alignment_root = _build_aishell_fixture(tmp)
            cache_dir = os.path.join(tmp, "cache")
            samples, manifest = aishell3_pipeline(
                cache_dir,
                local_audio_root=audio_root,
                local_textgrid_root=alignment_root,
                skip_download=True,
            )
            self.assertEqual(manifest.metadata.utterance_count, 1)
            self.assertEqual(manifest.metadata.speaker_count, 1)
            self.assertEqual(len(samples), 3)
            labels = sorted(sample.label for sample in samples)
            self.assertEqual(labels, [2, 2, 4])
            for sample in samples:
                self.assertGreaterEqual(sample.label, 0)
                self.assertLess(sample.label, contract.P0_N_CLASSES)
                self.assertLess(sample.start, sample.end)

    def test_probe_stats_json_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio_root, alignment_root = _build_aishell_fixture(tmp)
            cache_dir = os.path.join(tmp, "cache")
            json_out = os.path.join(tmp, "probe_report.json")
            argv = [
                "stats",
                "--cache-dir",
                cache_dir,
                "--local-audio-root",
                audio_root,
                "--local-textgrid-root",
                alignment_root,
                "--skip-download",
                "--json-out",
                json_out,
            ]
            self.assertEqual(probe_main(argv), 0)
            with open(json_out, encoding="utf-8") as handle:
                report = json.load(handle)
            self.assertEqual(report["dataset_id"], OPENSRL_AISHELL3_DATASET_ID)
            self.assertEqual(report["syllable_count"], 3)
            self.assertEqual(report["utterance_count"], 1)
            self.assertEqual(report["wav_join_rate"], 1.0)
            self.assertEqual(report["class_distribution"]["t3"], 2)
            self.assertEqual(report["class_distribution"]["t5"], 1)
            self.assertGreaterEqual(report["invalid_token_count"], 1)

    def test_probe_accept_fixture_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio_root, alignment_root = _build_aishell_fixture(tmp)
            cache_dir = os.path.join(tmp, "cache")
            json_out = os.path.join(tmp, "accept_report.json")
            argv = [
                "accept",
                "--cache-dir",
                cache_dir,
                "--local-audio-root",
                audio_root,
                "--local-textgrid-root",
                alignment_root,
                "--skip-download",
                "--json-out",
                json_out,
            ]
            # Fixture is 1 utterance — gates expect full AISHELL scale; verdict is CONDITIONAL PASS.
            exit_code = probe_main(argv)
            self.assertEqual(exit_code, 0)
            with open(json_out, encoding="utf-8") as handle:
                report = json.load(handle)
            self.assertIn(report["final_verdict"], ("PASS", "CONDITIONAL PASS"))
            self.assertTrue(report["manifest_validation"]["pass"])
            self.assertTrue(report["license_validation"]["pass"])
            self.assertTrue(report["dataset_contract_validation"]["pass"])
            self.assertEqual(report["syllable_count"], 3)

    def test_probe_join_audit_reports_missing_pairs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio_root, alignment_root = _build_aishell_fixture(tmp)
            cache_dir = os.path.join(tmp, "cache")
            adapter = OpenSlrAishell3DatasetAdapter(
                local_audio_root=audio_root,
                local_textgrid_root=alignment_root,
                skip_download=True,
            )
            manifest = adapter.materialize(cache_dir)
            extra_wav = os.path.join(
                manifest.materialized_root,
                "audio",
                "train",
                "wav",
                "SSB0002",
                "ID0002W0002.wav",
            )
            _write_min_wav(extra_wav)
            join_info = audit_join(manifest.materialized_root, filters=ProbeFilters())
            self.assertEqual(join_info["wav_count"], 2)
            self.assertEqual(join_info["matched_utterance_count"], 1)
            self.assertIn("ID0002W0002", join_info["missing_textgrid_samples"][0])


class DataMiniRegressionTest(unittest.TestCase):
    def test_sample_count_matches_baseline(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        self.assertEqual(len(samples), _BASELINE_TOTAL_SYLLABLES)
        self.assertEqual(manifest.metadata.syllable_count, _BASELINE_TOTAL_SYLLABLES)
        self.assertEqual(manifest.metadata.utterance_count, 466)

    def test_class_distribution_matches_baseline(self) -> None:
        samples, _ = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        counts = Counter(sample.label for sample in samples)
        self.assertEqual(dict(counts), _BASELINE_CLASS_TOTAL)

    def test_train_val_split_matches_baseline(self) -> None:
        samples, _ = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        train, val = train_tone_cnn.split_val_holdout_samples(samples, val_ratio=0.15, seed=42)
        self.assertEqual(len(train), _BASELINE_TRAIN_SYLLABLES)
        self.assertEqual(len(val), _BASELINE_VAL_SYLLABLES)

    def test_fixture_mel_shape_matches_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio_root, alignment_root = _build_aishell_fixture(tmp)
            samples, _ = aishell3_pipeline(
                os.path.join(tmp, "cache"),
                local_audio_root=audio_root,
                local_textgrid_root=alignment_root,
                skip_download=True,
            )
            sample = samples[0]
            import soundfile as sf

            audio, sr = sf.read(sample.wav_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            start = max(0, int(sample.start * sr))
            end = max(start + 1, int(sample.end * sr))
            clip = audio[start:end]
            mel = extract_mel_features(clip, sr)
            self.assertEqual(mel.shape[0], contract.P0_N_MELS)

    def test_train_tone_cnn_still_default_data_mini(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertIn("default_data_mini_pipeline", source)
        self.assertNotIn("aishell3_pipeline", source)


class OptionalLocalAishellDatasetProbeTest(unittest.TestCase):
    def test_optional_local_limited_dataset_probe(self) -> None:
        local_audio = os.environ.get("AISHELL3_LOCAL_AUDIO_ROOT")
        local_textgrid = os.environ.get("AISHELL3_LOCAL_TEXTGRID_ROOT")
        if not local_audio or not local_textgrid:
            self.skipTest("AISHELL3_LOCAL_AUDIO_ROOT / AISHELL3_LOCAL_TEXTGRID_ROOT not set")
        if not os.path.isdir(local_audio) or not os.path.isdir(local_textgrid):
            self.skipTest("local AISHELL-3 roots not present")

        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = os.path.join(tmp, "cache")
            report = cmd_stats(
                argparse_namespace(
                    cache_dir=cache_dir,
                    openslr_tgz=None,
                    local_audio_root=local_audio,
                    textgrid_zip=None,
                    local_textgrid_root=local_textgrid,
                    max_utterances=100,
                    max_speakers=2,
                    speaker_ids=None,
                    json_out=None,
                    skip_download=True,
                )
            )
            self.assertGreaterEqual(report["utterance_count"], 1)
            self.assertGreaterEqual(report["syllable_count"], 1)
            self.assertGreaterEqual(report["wav_join_rate"], 0.95)


def argparse_namespace(**kwargs):
    class _Args:
        pass

    args = _Args()
    for key, value in kwargs.items():
        setattr(args, key, value)
    return args


if __name__ == "__main__":
    unittest.main()
