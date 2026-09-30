"""CandidateIndexMetaV1 — derived from Lexicon SSOT (not a new vocabulary SSOT)."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from training.model2.contract import CANDIDATE_INDEX_VERSION
from training.model2.phonetic.syllables import normalize_syllable, parse_raw_pinyin


@dataclass
class CandidateRecord:
    term_id: str
    surface: str
    pinyin_key: str
    syllables: list[str]
    syllable_count: int
    domain_ids: list[str]
    term_type: str  # base | domain
    prior_score: float


@dataclass
class CandidateIndexMetaV1:
    candidate_index_version: str
    lexicon_snapshot_id: str
    candidate_count: int
    records: list[CandidateRecord] = field(default_factory=list)
    # indexes
    by_term_id: dict[str, CandidateRecord] = field(default_factory=dict, repr=False)
    by_surface: dict[str, list[CandidateRecord]] = field(default_factory=dict, repr=False)
    by_syllable_count: dict[int, list[CandidateRecord]] = field(default_factory=dict, repr=False)

    def rebuild_indexes(self) -> None:
        self.by_term_id = {r.term_id: r for r in self.records}
        self.by_surface = {}
        self.by_syllable_count = {}
        for r in self.records:
            self.by_surface.setdefault(r.surface, []).append(r)
            self.by_syllable_count.setdefault(r.syllable_count, []).append(r)

    def resolve_surface(self, surface: str, preferred_domain: Optional[str] = None) -> Optional[CandidateRecord]:
        hits = self.by_surface.get(surface) or []
        if not hits:
            return None
        if preferred_domain:
            for h in hits:
                if preferred_domain in h.domain_ids:
                    return h
        # Prefer domain over base when multiple
        domain_hits = [h for h in hits if h.term_type == "domain"]
        if domain_hits:
            return sorted(domain_hits, key=lambda x: -x.prior_score)[0]
        return sorted(hits, key=lambda x: -x.prior_score)[0]

    def to_meta_dict(self) -> dict[str, Any]:
        return {
            "candidate_index_version": self.candidate_index_version,
            "lexicon_snapshot_id": self.lexicon_snapshot_id,
            "candidate_count": self.candidate_count,
            "term_types": ["base", "domain"],
            "note": "Derived from Lexicon SSOT; not a vocabulary SSOT.",
        }

    def save_jsonl(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            for r in self.records:
                f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")

    def save_meta(self, path: Path) -> None:
        path.write_text(json.dumps(self.to_meta_dict(), ensure_ascii=False, indent=2), encoding="utf-8")


def _make_term_id(term_type: str, domain_id: Optional[str], word: str, pinyin_key: str) -> str:
    # Stable identity: type + domain + surface + pinyin (matches runtime uniqueness intent)
    dom = domain_id or "_"
    return f"{term_type}:{dom}:{word}:{pinyin_key}"


def build_candidate_index_from_sqlite(
    sqlite_path: Path,
    lexicon_snapshot_id: str,
    *,
    include_idiom: bool = False,
) -> CandidateIndexMetaV1:
    conn = sqlite3.connect(str(sqlite_path))
    conn.row_factory = sqlite3.Row
    records: list[CandidateRecord] = []
    seen: set[str] = set()

    # Domain terms first (higher priority identity for same surface)
    for row in conn.execute(
        """
        SELECT word, domain_id, pinyin_key, prior_score, COALESCE(is_alias,0) AS is_alias
        FROM domain_lexicon
        WHERE enabled = 1 AND COALESCE(is_alias,0) = 0
        """
    ):
        word = row["word"]
        pk = row["pinyin_key"] or ""
        syls = parse_raw_pinyin(pk) or [normalize_syllable(x) for x in pk.split("|") if x]
        tid = _make_term_id("domain", row["domain_id"], word, pk)
        if tid in seen:
            continue
        seen.add(tid)
        records.append(
            CandidateRecord(
                term_id=tid,
                surface=word,
                pinyin_key=pk,
                syllables=syls,
                syllable_count=len(syls),
                domain_ids=[row["domain_id"]],
                term_type="domain",
                prior_score=float(row["prior_score"] or 0.0),
            )
        )

    for row in conn.execute(
        """
        SELECT word, pinyin_key, prior_score
        FROM base_lexicon
        WHERE enabled = 1
        """
    ):
        word = row["word"]
        pk = row["pinyin_key"] or ""
        syls = parse_raw_pinyin(pk) or [normalize_syllable(x) for x in pk.split("|") if x]
        tid = _make_term_id("base", None, word, pk)
        if tid in seen:
            continue
        # If surface already has domain record, still keep base as separate candidate
        # (runtime may distinguish). Surface resolve prefers domain.
        seen.add(tid)
        records.append(
            CandidateRecord(
                term_id=tid,
                surface=word,
                pinyin_key=pk,
                syllables=syls,
                syllable_count=len(syls),
                domain_ids=[],
                term_type="base",
                prior_score=float(row["prior_score"] or 0.0),
            )
        )

    if include_idiom:
        for row in conn.execute(
            """
            SELECT word, pinyin_key, prior_score
            FROM idiom_lexicon
            WHERE enabled = 1
            """
        ):
            word = row["word"]
            pk = row["pinyin_key"] or ""
            syls = parse_raw_pinyin(pk) or []
            tid = _make_term_id("idiom", None, word, pk)
            if tid in seen:
                continue
            seen.add(tid)
            records.append(
                CandidateRecord(
                    term_id=tid,
                    surface=word,
                    pinyin_key=pk,
                    syllables=syls,
                    syllable_count=len(syls),
                    domain_ids=[],
                    term_type="idiom",
                    prior_score=float(row["prior_score"] or 0.0),
                )
            )

    conn.close()
    idx = CandidateIndexMetaV1(
        candidate_index_version=CANDIDATE_INDEX_VERSION,
        lexicon_snapshot_id=lexicon_snapshot_id,
        candidate_count=len(records),
        records=records,
    )
    idx.rebuild_indexes()
    return idx
