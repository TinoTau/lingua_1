"""Phase 5A unit tests: contracts, fuzzy pool, trainrow shapes, parity fixtures."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.candidates.index import (  # noqa: E402
    CandidateRecord,
    CandidateIndexMetaV1,
)
from training.model2.contract import (  # noqa: E402
    DOMAIN_DIM,
    DOMAIN_PRIOR_DTYPE,
    PHONETIC_DIM,
    TONE_DIM,
)
from training.model2.encoding.char_hash import (  # noqa: E402
    encode_span_chars,
    fnv1a64,
    hash_ngram,
)
from training.model2.encoding.syllable_vocab import SyllableVocabV1  # noqa: E402
from training.model2.export.train_row import (  # noqa: E402
    Model2TrainRowV1,
    empty_condition_vectors,
    make_trainrow_id,
)
from training.model2.export.training_sample import (  # noqa: E402
    TrainingSampleV1,
    TrainingSourceType,
    stage_a_masks,
)
from training.model2.features.personal import benchmark_personal_sim  # noqa: E402
from training.model2.fuzzy.pool import (  # noqa: E402
    FuzzyPoolRequestV1,
    build_fuzzy_pool,
)


def _toy_index() -> CandidateIndexMetaV1:
    records = [
        CandidateRecord(
            term_id="domain:tourism_route:南宁:nan|ning",
            surface="南宁",
            pinyin_key="nan|ning",
            syllables=["nan", "ning"],
            syllable_count=2,
            domain_ids=["tourism_route"],
            term_type="domain",
            prior_score=0.9,
        ),
        CandidateRecord(
            term_id="base:_:兰宁:lan|ning",
            surface="兰宁",
            pinyin_key="lan|ning",
            syllables=["lan", "ning"],
            syllable_count=2,
            domain_ids=[],
            term_type="base",
            prior_score=0.1,
        ),
        CandidateRecord(
            term_id="domain:coffee:拿铁:na|tie",
            surface="拿铁",
            pinyin_key="na|tie",
            syllables=["na", "tie"],
            syllable_count=2,
            domain_ids=["coffee"],
            term_type="domain",
            prior_score=0.8,
        ),
    ]
    idx = CandidateIndexMetaV1(
        candidate_index_version="cand-index-v1",
        lexicon_snapshot_id="test",
        candidate_count=len(records),
        records=records,
    )
    idx.rebuild_indexes()
    return idx


class TestDomainPriorDtype(unittest.TestCase):
    def test_domain_prior_is_float32_not_uint8(self):
        self.assertEqual(DOMAIN_PRIOR_DTYPE, "float32")
        v = empty_condition_vectors()
        self.assertEqual(len(v["domain_prior"]), DOMAIN_DIM)
        self.assertIsInstance(v["domain_prior"][0], float)
        self.assertIsInstance(v["domain_mask"][0], int)


class TestCharHash(unittest.TestCase):
    def test_stable_not_python_hash(self):
        a = hash_ngram("南宁")
        b = hash_ngram("南宁")
        self.assertEqual(a, b)
        self.assertEqual(fnv1a64(b"abc"), fnv1a64(b"abc"))
        ids = encode_span_chars("我想去南宁")
        self.assertEqual(len(ids), 16)
        self.assertEqual(encode_span_chars("我想去南宁"), ids)


class TestSyllableVocab(unittest.TestCase):
    def test_pad_unk_stable(self):
        v = SyllableVocabV1.build_from_syllables(["nan", "ning", "lan"])
        self.assertEqual(v.encode(["nan", "ning"])[0], v.syllable_to_id["nan"])
        self.assertEqual(v.encode(["zzz"])[0], 1)  # UNK


class TestFuzzyPool(unittest.TestCase):
    def test_independent_of_exact_and_deterministic(self):
        idx = _toy_index()
        req = FuzzyPoolRequestV1(
            span_text="兰宁",
            span_syllables=["lan", "ning"],
            span_syllable_count=2,
            max_pool_size=32,
            distance_threshold=2,
        )
        a = build_fuzzy_pool(idx, req)
        b = build_fuzzy_pool(idx, req)
        self.assertEqual(a.term_ids(), b.term_ids())
        # Target 南宁 should be in pool (distance 1: lan→nan)
        self.assertTrue(a.contains_surface("南宁"))
        # Pool does not require Exact Recall of 兰宁 as domain term
        self.assertGreater(a.pool_size, 0)


class TestTrainingSampleV11(unittest.TestCase):
    def test_roundtrip_and_stage_a_masks(self):
        fixture = {
            "schema_version": 1,
            "sample_id": "ts-test",
            "input": {
                "source_span": "兰宁",
                "local_context": "我想去兰宁",
                "source_pinyin": "lan|ning",
                "available_tone_info": None,
                "span_operation": "REPLACE",
                "context_left": "我想去",
                "context_right": "",
            },
            "condition": {
                "source_profile_version": None,
                "profile_version_ref": None,
                "phonetic_profile_not_acoustically_realized": True,
                "user_condition_ref": "pseudo-g00",
                "condition_masks": {
                    "phonetic_mask": [0] * 16,
                    "tone_mask": [0] * 12,
                    "domain_mask": [0] * 12,
                    "profile_available": 0,
                    "phonetic_profile_acoustically_realized": 0,
                },
            },
            "target": {"target_span": "南宁"},
            "metadata": {
                "source_type": "TTS_ASR_SYNTHETIC",
                "sample_kind": "POSITIVE",
                "correction_event_id": "e1",
                "user_group_key": "ug-1",
                "target_term": "南宁",
                "normalizer_version": "corr-normalizer-v1",
                "extractor_version": "model2-synth-extractor-v1",
                "created_at": "2026-08-12T00:00:00+00:00",
                "superseded_for_profile": False,
                "exclude_from_default_positive_export": False,
                "synthetic": {"generator_version": "model2-synth-generator-v1"},
                "training": {
                    "fuzzy_pool_term_ids": ["domain:tourism_route:南宁:nan|ning"],
                    "target_term_id": "domain:tourism_route:南宁:nan|ning",
                },
            },
        }
        s = TrainingSampleV1.from_dict(fixture)
        back = s.to_dict()
        s2 = TrainingSampleV1.from_dict(back)
        self.assertEqual(s.sample_id, s2.sample_id)
        self.assertEqual(s.metadata.source_type, TrainingSourceType.TTS_ASR_SYNTHETIC)
        m = stage_a_masks()
        self.assertEqual(len(m.phonetic_mask), PHONETIC_DIM)
        self.assertEqual(len(m.tone_mask), TONE_DIM)
        self.assertTrue(all(x == 0 for x in m.phonetic_mask))


class TestTrainRowId(unittest.TestCase):
    def test_deterministic(self):
        a = make_trainrow_id("ts-1")
        b = make_trainrow_id("ts-1")
        self.assertEqual(a, b)
        self.assertNotEqual(a, make_trainrow_id("ts-2"))


class TestPersonalBenchmark(unittest.TestCase):
    def test_top100_runs(self):
        idx = _toy_index()
        r = benchmark_personal_sim(idx.records, ["南宁", "拿铁"] * 50, top_ns=(20, 100))
        self.assertIn(20, r)
        self.assertIn(100, r)
        self.assertLess(r[100]["wall_ms"], 50.0)


class TestTrainRowShapes(unittest.TestCase):
    def test_validate(self):
        cond = empty_condition_vectors()
        row = Model2TrainRowV1(
            sample_id="s",
            trainrow_id="tr-x",
            sample_kind="POSITIVE",
            source_type="TTS_ASR_SYNTHETIC",
            split="train",
            span_text="兰宁",
            span_char_ids=encode_span_chars("兰宁"),
            span_len=2,
            syllable_ids=[0] * 8,
            syllable_count=2,
            span_syllables=["lan", "ning"],
            left_context="",
            right_context="",
            left_char_ids=[0] * 24,
            right_char_ids=[0] * 24,
            relative_position=0.0,
            **cond,
            profile_available=0,
            personal_term_count=0,
            phonetic_profile_acoustically_realized=0,
            fuzzy_pool_term_ids=["a"],
            target_term_id="a",
            target_in_pool=True,
            target_oov=False,
            candidate_personal_features=[[0.0, 0.0, 0.0]],
            candidate_domain_features=[[0.0, 0.0]],
        )
        self.assertEqual(row.validate_shapes(), [])


if __name__ == "__main__":
    unittest.main()
