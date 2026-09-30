# -*- coding: utf-8 -*-
"""Unit tests for Model3 error-text pilot generator."""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from training.model3_error_text.generator.corrupt import apply_corruptions, try_phonetic_corruption, annotate_sentence
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import LexiconSurfaceResolver, default_sqlite_path
from training.model3_error_text.generator.split import assign_split, leakage_report
from training.model3_error_text.generator.validate import validate_sample

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def resolver():
    r = LexiconSurfaceResolver(default_sqlite_path(REPO))
    yield r
    r.close()


def test_active_families_frozen():
    assert ACTIVE_FAMILIES_V1[0] == "n_l"
    assert len(ACTIVE_FAMILIES_V1) == 7


def test_deterministic_split():
    assert assign_split("abc|cg", 20260823) == assign_split("abc|cg", 20260823)


def test_offset_apply():
    ref = "你好世界"
    corrs = [
        {
            "spanStart": 0,
            "spanEnd": 1,
            "referenceSurface": "你",
            "errorSurface": "尼",
        }
    ]
    assert apply_corruptions(ref, corrs) == "尼好世界"


def test_unknown_family_rejected(resolver):
    sample = {
        "sampleId": "x",
        "generatorVersion": "t",
        "generationSeed": 1,
        "sourceCorpus": "baseline_v1",
        "sourceSentenceId": "s",
        "referenceText": "南",
        "errorText": "兰",
        "corruptionCount": 1,
        "corruptions": [
            {
                "spanStart": 0,
                "spanEnd": 1,
                "referenceSurface": "南",
                "errorSurface": "兰",
                "corruptionFamily": "FAKE_FAMILY",
                "sourcePinyin": "nan",
                "sourceTone": "nan2",
                "targetPinyin": "lan",
                "targetTone": "lan2",
                "replacementSource": "BASE_LEXICON",
                "isPhonetic": True,
                "isPolyphonic": False,
                "generationReason": "x",
            }
        ],
        "evidenceLevel": "SYNTHETIC_TEXT",
        "splitGroupKey": "s|solo",
    }
    errs = validate_sample(sample, resolver)
    assert any("unknown_family" in e or "phonetic_family" in e for e in errs)


def test_dialog200_rejected(resolver):
    sample = {
        "sampleId": "x",
        "generatorVersion": "t",
        "generationSeed": 1,
        "sourceCorpus": "dialog_200",
        "sourceSentenceId": "s",
        "referenceText": "你好",
        "errorText": "你好",
        "corruptionCount": 0,
        "corruptions": [],
        "evidenceLevel": "SYNTHETIC_TEXT",
        "splitGroupKey": "s|solo",
    }
    assert "dialog_200_forbidden" in validate_sample(sample, resolver)


def test_gt2_rejected(resolver):
    sample = {
        "sampleId": "x",
        "generatorVersion": "t",
        "generationSeed": 1,
        "sourceCorpus": "baseline_v1",
        "sourceSentenceId": "s",
        "referenceText": "abc",
        "errorText": "xyz",
        "corruptionCount": 3,
        "corruptions": [{}, {}, {}],
        "evidenceLevel": "SYNTHETIC_TEXT",
        "splitGroupKey": "s|solo",
    }
    assert "corruptionCount_gt_2" in validate_sample(sample, resolver)


def test_leakage_zero_when_grouped():
    rows = [
        {"split": "train", "sourceSentenceId": "a", "contrastGroupId": "cg1", "corruptions": []},
        {"split": "train", "sourceSentenceId": "a", "contrastGroupId": "cg1", "corruptions": [{"referenceSurface": "南", "errorSurface": "兰"}]},
        {"split": "test", "sourceSentenceId": "b", "contrastGroupId": "cg2", "corruptions": []},
    ]
    rep = leakage_report(rows)
    assert rep["source_sentence_leakage_total"] == 0
    assert rep["contrast_group_leakage_total"] == 0


def test_annotate_uses_node():
    annos, impl, meta = annotate_sentence("你好")
    assert meta.get("ok") or meta.get("skip")
    # If node available, should annotate
    if impl.endswith("node") or "node" in impl:
        assert annos or meta.get("skip")


def test_phonetic_corruption_changes_surface(resolver):
    text = "你好"
    annos, impl, meta = annotate_sentence(text)
    if not annos:
        pytest.skip("annotation unavailable")
    found = None
    for a in annos:
        for fam in ACTIVE_FAMILIES_V1:
            c = try_phonetic_corruption(text, a, fam, resolver)
            if c:
                found = c
                break
        if found:
            break
    if not found:
        pytest.skip("no applicable corruption in short text")
    assert found["referenceSurface"] != found["errorSurface"]
