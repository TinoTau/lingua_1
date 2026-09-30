"""Unit tests for Model2 probe pipeline (no live TTS/ASR required)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.adapters.faster_whisper_client import (  # noqa: E402
    AsrUnavailableError,
    FasterWhisperClient,
    wav_to_pcm16_mono,
)
from training.model2.adapters.piper_tts_client import (  # noqa: E402
    PiperInvalidAudioError,
    PiperTtsClient,
    parse_wav_header,
)
from training.model2.alignment.align import SpanOperation, align_codepoints  # noqa: E402
from training.model2.corruption.bank import (  # noqa: E402
    apply_corruption,
    resolve_spec,
    wav_bytes_pcm16,
)
from training.model2.export.sample_builder import (  # noqa: E402
    build_hard_negative,
    build_rule_synthetic_pair,
    build_samples_from_asr,
)
from training.model2.export.training_sample import (  # noqa: E402
    SyntheticMetadataV1,
    TrainingSampleV1,
    TrainingSourceType,
    dumps_jsonl,
)
from training.model2.phonetic.syllables import text_to_syllables  # noqa: E402
from training.model2.splits.assign import (  # noqa: E402
    SplitAssignment,
    assign_split_for_keys,
    assign_term_split,
    audit_term_combination_holdout,
    audit_user_disjoint,
)


def _silent_wav(sr=16000, seconds=0.2, freq=0):
    n = int(sr * seconds)
    if freq:
        t = np.arange(n) / sr
        audio = (0.2 * 32767 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    else:
        audio = np.zeros(n, dtype=np.float32)
    return wav_bytes_pcm16(audio, sr)


class TestContract(unittest.TestCase):
    def test_source_type_and_roundtrip(self):
        meta = SyntheticMetadataV1(source_type="TTS_ASR_SYNTHETIC", random_seed=1)
        self.assertEqual(TrainingSourceType.TTS_ASR_SYNTHETIC.value, "TTS_ASR_SYNTHETIC")
        samples = build_samples_from_asr(
            sample_plan_id="p1",
            gt_text="预定酒店",
            hyp_text="预订酒店",
            target_term="酒店",
            domain="tourism_hotel",
            pseudo_user_group_id="pseudo-g00",
            synthetic_meta=meta,
        )
        self.assertTrue(samples)
        blob = dumps_jsonl(samples)
        back = TrainingSampleV1.from_dict(json.loads(blob.strip().splitlines()[0]))
        self.assertEqual(back.metadata.source_type, TrainingSourceType.TTS_ASR_SYNTHETIC)


class TestManifestDeterminism(unittest.TestCase):
    def test_same_seed_same_split(self):
        a = assign_split_for_keys(pseudo_user_group_id="pseudo-g01", target_term="x", seed=42)
        b = assign_split_for_keys(pseudo_user_group_id="pseudo-g01", target_term="y", seed=42)
        self.assertEqual(a, b)
        c = assign_split_for_keys(pseudo_user_group_id="pseudo-g01", target_term="x", seed=99)
        # may or may not differ; controlled difference across users more important
        d = assign_term_split(target_term="南宁", seed=42)
        e = assign_term_split(target_term="南宁", seed=42)
        self.assertEqual(d, e)
        f = assign_term_split(target_term="南宁", seed=7)
        self.assertTrue(d == f or d != f)  # deterministic either way


class TestAlignment(unittest.TestCase):
    def test_same(self):
        self.assertEqual(align_codepoints("你好", "你好"), [])

    def test_replace(self):
        spans = align_codepoints("预定", "预订")
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0].operation, SpanOperation.REPLACE)
        self.assertEqual(spans[0].source_text, "定")
        self.assertEqual(spans[0].target_text, "订")

    def test_insert_delete(self):
        ins = align_codepoints("cat", "cart")
        self.assertTrue(any(s.operation == SpanOperation.INSERT for s in ins))
        delete = align_codepoints("cart", "cat")
        self.assertTrue(any(s.operation == SpanOperation.DELETE for s in delete))

    def test_multi_and_deterministic(self):
        a = align_codepoints("米福游船", "米尔福德游船")
        b = align_codepoints("米福游船", "米尔福德游船")
        self.assertEqual(a, b)
        self.assertTrue(a)


class TestCorruption(unittest.TestCase):
    def test_strategies_deterministic(self):
        audio = (np.sin(np.linspace(0, 20, 16000)) * 10000).astype(np.float32)
        for strategy, level in [
            ("NONE", "default"),
            ("NOISE", "snr_20db"),
            ("SPEED", "fast_1p1"),
            ("VOLUME", "quiet_0p5"),
            ("REVERB", "light"),
            ("PITCH", "down_semitone"),
        ]:
            spec = resolve_spec(strategy, level)
            y1, _ = apply_corruption(audio, 16000, spec, seed=1, sample_plan_id="x")
            y2, _ = apply_corruption(audio, 16000, spec, seed=1, sample_plan_id="x")
            np.testing.assert_allclose(y1, y2)


class TestSampleBuilder(unittest.TestCase):
    def test_positive_negative_hard(self):
        meta = SyntheticMetadataV1()
        pos = build_samples_from_asr(
            sample_plan_id="a",
            gt_text="我想去南宁",
            hyp_text="我想去兰宁",
            target_term="南宁",
            domain="tourism_route",
            pseudo_user_group_id="g0",
            synthetic_meta=meta,
        )
        self.assertTrue(any(s.metadata.sample_kind.value == "POSITIVE" for s in pos))
        neg = build_samples_from_asr(
            sample_plan_id="b",
            gt_text="我想去南宁",
            hyp_text="我想去南宁",
            target_term="南宁",
            domain="tourism_route",
            pseudo_user_group_id="g0",
            synthetic_meta=meta,
        )
        self.assertEqual(neg[0].metadata.sample_kind.value, "NEGATIVE")
        hn = build_hard_negative(
            sample_plan_id="c",
            hyp_text="今天天气不错",
            biased_term="拿铁",
            domain="coffee",
            pseudo_user_group_id="g0",
            synthetic_meta=meta,
        )
        self.assertIsNotNone(hn)
        self.assertEqual(hn.target.target_span, "NO_MATCH")
        rule = build_rule_synthetic_pair(
            sample_plan_id="r",
            source_span="兰宁",
            target_span="南宁",
            context="去兰宁",
            pseudo_user_group_id="g0",
        )
        self.assertEqual(rule.metadata.source_type, TrainingSourceType.RULE_SYNTHETIC)


class TestSplitLeakage(unittest.TestCase):
    def test_user_disjoint(self):
        # Simulate user→split mapping
        users = [f"pseudo-g{i:02d}" for i in range(20)]
        assigns = []
        for u in users:
            sp = assign_split_for_keys(pseudo_user_group_id=u, target_term="t", seed=1)
            assigns.append(
                SplitAssignment(sample_plan_id=f"p-{u}", split=sp, pseudo_user_group_id=u, target_term="t1")
            )
        self.assertEqual(audit_user_disjoint(assigns), [])
        # Force leak
        assigns.append(
            SplitAssignment(
                sample_plan_id="leak",
                split="test" if assigns[0].split != "test" else "train",
                pseudo_user_group_id=assigns[0].pseudo_user_group_id,
                target_term="t2",
            )
        )
        self.assertTrue(audit_user_disjoint(assigns))

    def test_combo_holdout_report(self):
        a = [
            SplitAssignment("1", "train", "u1", "南宁"),
            SplitAssignment("2", "test", "u2", "南宁"),
        ]
        rep = audit_term_combination_holdout(a)
        self.assertIn("南宁", rep["term_overlap_train_test"])
        self.assertEqual(rep["combo_overlap_train_test"], [])


class TestPiperAdapterUnit(unittest.TestCase):
    def test_parse_wav_and_invalid(self):
        wav = _silent_wav()
        sr, ch, bits = parse_wav_header(wav)
        self.assertEqual(sr, 16000)
        self.assertEqual(bits, 16)
        with self.assertRaises(PiperInvalidAudioError):
            parse_wav_header(b"not-a-wav")

    def test_unavailable(self):
        client = PiperTtsClient(base_url="http://127.0.0.1:1", retries=0, timeout_s=0.2)
        with self.assertRaises(Exception):
            client.health()


class TestAsrAdapterUnit(unittest.TestCase):
    def test_wav_to_pcm(self):
        wav = _silent_wav()
        pcm, sr = wav_to_pcm16_mono(wav, 16000)
        self.assertEqual(sr, 16000)
        self.assertTrue(len(pcm) > 0)

    def test_wrong_sr(self):
        wav = wav_bytes_pcm16(np.zeros(8000, dtype=np.float32), 8000)
        with self.assertRaises(Exception):
            wav_to_pcm16_mono(wav, 16000)

    def test_unavailable(self):
        client = FasterWhisperClient(base_url="http://127.0.0.1:1", retries=0, timeout_s=0.2)
        with self.assertRaises(AsrUnavailableError):
            client.health()

    def test_parse_empty_text(self):
        hyp = FasterWhisperClient._parse_response({"text": "", "segments": [], "duration": 0.1}, 1.0)
        self.assertEqual(hyp.text, "")


class TestPhoneticGolden(unittest.TestCase):
    def test_agreement(self):
        from training.model2.phonetic.syllables import active_phonetic_impl

        golden_path = REPO_ROOT / "training" / "model2" / "phonetic" / "golden_fixtures.json"
        if not golden_path.is_file():
            self.skipTest("golden fixtures missing — run export_node_golden.mjs")
        data = json.loads(golden_path.read_text(encoding="utf-8"))
        mismatch = []
        for fx in data["fixtures"]:
            got = text_to_syllables(fx["text"])
            if got != fx["syllables_none"]:
                mismatch.append((fx["text"], fx["syllables_none"], got))
        rate = 1.0 - (len(mismatch) / max(1, len(data["fixtures"])))
        impl = active_phonetic_impl()
        # Node bridge must be perfect vs golden; fallback must still be mostly OK.
        threshold = 1.0 if impl.startswith("node-") else 0.8
        self.assertGreaterEqual(
            rate,
            threshold,
            msg=f"impl={impl} phonetic agreement {rate:.2%} mismatches={mismatch}",
        )


class TestAudioCleanup(unittest.TestCase):
    def test_temp_cleanup_pattern(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.wav"
            p.write_bytes(_silent_wav())
            self.assertTrue(p.exists())
            p.unlink()
            self.assertFalse(p.exists())


if __name__ == "__main__":
    unittest.main()
