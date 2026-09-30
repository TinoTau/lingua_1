"""StageDRetrievalTargetIdentityV1 — lexical identity vs retrieval provenance.

Contract (frozen for D1+):
  Lexical identity key = (normalized surface, pinyin_key)
  Provenance = term_id + term_type (base|domain) + domain_ids

Does NOT invent a second lexicon SSOT. Uses CandidateIndexMetaV1 fields only.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from training.model2.candidates.index import CandidateIndexMetaV1, CandidateRecord


CONTRACT_ID = "StageDRetrievalTargetIdentityV1"


def lexical_identity_key(rec: CandidateRecord) -> tuple[str, str]:
    return (rec.surface or "", rec.pinyin_key or "")


def lexical_identity_key_from_term_id(
    index: CandidateIndexMetaV1, term_id: str
) -> Optional[tuple[str, str]]:
    rec = index.by_term_id.get(term_id)
    if not rec:
        return None
    return lexical_identity_key(rec)


def identities_in_term_ids(
    index: CandidateIndexMetaV1, term_ids: Iterable[str]
) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for tid in term_ids:
        k = lexical_identity_key_from_term_id(index, tid)
        if k is not None:
            out.add(k)
    return out


def target_hit(
    index: CandidateIndexMetaV1,
    target_term_id: str,
    retrieved_term_ids: Iterable[str],
) -> dict[str, Any]:
    """Hit under StageDRetrievalTargetIdentityV1 (not raw term_id equality)."""
    want = lexical_identity_key_from_term_id(index, target_term_id)
    got_ids = list(retrieved_term_ids or [])
    got = identities_in_term_ids(index, got_ids)
    identity_hit = want is not None and want in got
    tid_hit = target_term_id in set(got_ids)
    provenance = []
    if want is not None:
        for tid in got_ids:
            rec = index.by_term_id.get(tid)
            if rec and lexical_identity_key(rec) == want:
                provenance.append(
                    {
                        "term_id": tid,
                        "term_type": rec.term_type,
                        "domain_ids": list(rec.domain_ids or []),
                    }
                )
    return {
        "contract": CONTRACT_ID,
        "want_identity": list(want) if want else None,
        "identity_hit": identity_hit,
        "term_id_hit": tid_hit,
        "matched_provenance": provenance,
    }


def contract_meta() -> dict[str, Any]:
    return {
        "contract_id": CONTRACT_ID,
        "lexical_identity": "normalized_surface + pinyin_key (CandidateRecord)",
        "provenance_retained": ["term_id", "term_type", "domain_ids"],
        "not_a_second_lexicon_ssot": True,
        "surface_alone_not_sufficient": True,
        "note": (
            "Same surface+pinyin_key => same lexical identity across base:/domain: "
            "siblings. term_id remains diagnostic provenance only."
        ),
    }
