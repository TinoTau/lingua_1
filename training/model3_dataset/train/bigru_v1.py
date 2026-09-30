# -*- coding: utf-8 -*-
"""Small BiGRU V1 — MODEL-VISIBLE feature packing (no label-side leakage).

SSOT distinction:
  Schema fields may store QA / label evidence (referenceSurface, repairability, …).
  Loader/packer MUST only pack MODEL3_V1_MODEL_VISIBLE_FEATURE_ALLOWLIST fields.

Forbidden in model tensors (label/QA plane only):
  referenceSurface, referenceSurface!=surface, referenceReachable / repairability,
  phoneticCompatible (requires reference), label, labelClass, corruptionFamily,
  targetMask-as-predictive-feature, simulated anchor provenance.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn

# Allowlist feature names (order = tensor dim index)
FEAT_NAMES: tuple[str, ...] = (
    "isAnchor",
    "span_len_log1p",
    "span_rel_position",
    "first_pass_cand_log1p",
    "current_cjk_len_log1p",
    "pinyin_channel_avail",
)
FEAT_DIM = len(FEAT_NAMES)
_CJK = re.compile(r"[\u4e00-\u9fff]")


class Model3BiGRUV1(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        embed_dim: int = 64,
        hidden_dim: int = 128,
        feat_dim: int = FEAT_DIM,
        num_classes: int = 2,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.feat_proj = nn.Linear(feat_dim, embed_dim)
        self.bigru = nn.GRU(
            input_size=embed_dim,
            hidden_size=hidden_dim,
            num_layers=1,
            batch_first=True,
            bidirectional=True,
        )
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_dim * 2, num_classes)

    def forward(
        self,
        token_ids: torch.Tensor,
        span_feats: torch.Tensor,
        avail_mask: torch.Tensor,
    ) -> torch.Tensor:
        b, n, l = token_ids.shape
        emb = self.embed(token_ids.view(b * n, l)).mean(dim=1).view(b, n, -1)
        feats = self.feat_proj(span_feats * avail_mask)
        x = emb + feats
        out, _ = self.bigru(x)
        return self.head(self.drop(out))


def build_char_vocab(samples: list[dict]) -> dict[str, int]:
    chars = {"<pad>": 0, "<unk>": 1}
    for s in samples:
        for sp in s["spans"]:
            for ch in sp.get("surface") or "":
                if ch not in chars:
                    chars[ch] = len(chars)
    return chars


def encode_surface(surface: str, vocab: dict[str, int], max_len: int = 8) -> list[int]:
    ids = [vocab.get(ch, vocab["<unk>"]) for ch in surface[:max_len]]
    while len(ids) < max_len:
        ids.append(vocab["<pad>"])
    return ids


class CandidateFieldMissingError(ValueError):
    """Training-side fail-closed: missing candidate field ≠ legitimate zero."""

    def __init__(self, detail: str = ""):
        self.detail = detail
        super().__init__(f"MODEL3_CANDIDATE_FIELD_MISSING:{detail}")


def _extract_first_pass_candidate_count(sp: dict, fa: dict[str, Any]) -> int:
    """Distinguish missing field from true zero. Training loader only."""
    re_ev = sp.get("recallEvidence")
    if isinstance(re_ev, dict) and "firstPassCandidateCount" in re_ev:
        v = re_ev.get("firstPassCandidateCount")
        if v is None:
            raise CandidateFieldMissingError("null_recallEvidence.firstPassCandidateCount")
        return int(v)
    if "rawFirstPassCandidateCount" in sp:
        v = sp.get("rawFirstPassCandidateCount")
        if v is None:
            raise CandidateFieldMissingError("null_rawFirstPassCandidateCount")
        return int(v)
    packed = sp.get("packedInferFields") or sp.get("packedInfer") or {}
    if isinstance(packed, dict) and "firstPassCandidateCount" in packed:
        v = packed.get("firstPassCandidateCount")
        if v is None:
            raise CandidateFieldMissingError("null_packedInferFields.firstPassCandidateCount")
        return int(v)
    # Channel explicitly unavailable → treat as masked zero (avail mask set below).
    if not fa.get("recallFirstPass", True):
        return 0
    raise CandidateFieldMissingError("missing_firstPassCandidateCount")


def span_features(
    sp: dict,
    fa: dict[str, Any],
    span_index: int = 0,
    n_spans: int = 1,
) -> tuple[list[float], list[float]]:
    """Pack ONLY runtime-derivable / allowlisted features from CURRENT span."""
    surf = sp.get("surface") or ""
    cjk_len = len(_CJK.findall(surf))
    recall = _extract_first_pass_candidate_count(sp, fa)
    rel_pos = span_index / max(n_spans - 1, 1)

    feats = [
        float(bool(sp.get("isAnchor"))),
        math.log1p(float(len(surf))),
        float(rel_pos),
        math.log1p(float(recall)),
        math.log1p(float(cjk_len)),
        1.0 if fa.get("pinyinTextDerived") else 0.0,
    ]
    avail = [1.0] * len(feats)
    # first-pass recall channel absent when featureAvailability says so
    if not fa.get("recallFirstPass"):
        avail[3] = 0.0
        feats[3] = 0.0
    if not fa.get("pinyinTextDerived"):
        avail[5] = 0.0
        feats[5] = 0.0
    assert len(feats) == FEAT_DIM
    return feats, avail


def sample_to_tensors(sample: dict, vocab: dict[str, int]) -> dict[str, Any]:
    """Schema may hold label-side fields; this function must ignore them for feats."""
    fa = sample.get("featureAvailability") or {}
    spans = sample.get("spans") or []
    n = len(spans)
    token_rows = []
    feat_rows = []
    avail_rows = []
    target_mask = []
    labels = []
    anchor_mask = []
    for i, sp in enumerate(spans):
        token_rows.append(encode_surface(sp.get("surface") or "", vocab))
        f, a = span_features(sp, fa, span_index=i, n_spans=n)
        feat_rows.append(f)
        avail_rows.append(a)
        # targetMask: LOSS / eligibility only — never packed into feats
        target_mask.append(sp.get("targetMask", 0))
        anchor_mask.append(int(bool(sp.get("isAnchor"))))
        if sp.get("label") == "KEEP":
            labels.append(0)
        elif sp.get("label") == "RETRY":
            labels.append(1)
        else:
            labels.append(-100)
    return {
        "tokens": token_rows,
        "feats": feat_rows,
        "avail": avail_rows,
        "target_mask": target_mask,
        "labels": labels,
        "anchor_mask": anchor_mask,
        "sampleId": sample["sampleId"],
        "split": sample.get("split"),
    }


def model_input_hash(sample: dict, vocab: dict[str, int]) -> str:
    """Hash of model-visible tensors only (tokens+feats+avail). Labels/masks excluded."""
    item = sample_to_tensors(sample, vocab)
    payload = {
        "tokens": item["tokens"],
        "feats": item["feats"],
        "avail": item["avail"],
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def collate_batch(batch: list[dict], device: torch.device) -> dict[str, torch.Tensor]:
    max_n = max(len(x["tokens"]) for x in batch)
    max_l = len(batch[0]["tokens"][0])
    feat_dim = len(batch[0]["feats"][0])
    bsz = len(batch)
    tokens = torch.zeros(bsz, max_n, max_l, dtype=torch.long)
    feats = torch.zeros(bsz, max_n, feat_dim)
    avail = torch.zeros(bsz, max_n, feat_dim)
    target_mask = torch.zeros(bsz, max_n)
    labels = torch.full((bsz, max_n), -100, dtype=torch.long)
    valid = torch.zeros(bsz, max_n)
    for i, item in enumerate(batch):
        n = len(item["tokens"])
        valid[i, :n] = 1.0
        tokens[i, :n] = torch.tensor(item["tokens"], dtype=torch.long)
        feats[i, :n] = torch.tensor(item["feats"])
        avail[i, :n] = torch.tensor(item["avail"])
        target_mask[i, :n] = torch.tensor(item["target_mask"], dtype=torch.float)
        labels[i, :n] = torch.tensor(item["labels"], dtype=torch.long)
    return {
        "tokens": tokens.to(device),
        "feats": feats.to(device),
        "avail": avail.to(device),
        "target_mask": target_mask.to(device),
        "labels": labels.to(device),
        "valid": valid.to(device),
    }


def save_model_bundle(
    out_dir: Path,
    model: Model3BiGRUV1,
    vocab: dict[str, int],
    config: dict,
    model_name: str = "MODEL3_V1_SYNTHETIC_BASELINE_NOLEAK_V1",
):
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out_dir / "weights.pt")
    (out_dir / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "feature_allowlist.json").write_text(
        json.dumps({"feat_names": list(FEAT_NAMES), "feat_dim": FEAT_DIM}, indent=2),
        encoding="utf-8",
    )
    manifest = {
        "modelName": model_name,
        "architecture": "Small BiGRU",
        "config": config,
        "vocabSize": len(vocab),
        "featNames": list(FEAT_NAMES),
        "featDim": FEAT_DIM,
        "leakedPredecessor": "MODEL3_V1_SYNTHETIC_BASELINE",
        "status": "ACTIVE_NOLEAK",
    }
    (out_dir / "model_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
