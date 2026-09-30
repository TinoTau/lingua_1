# -*- coding: utf-8 -*-
"""Build P0–P3 UserProfileV1 via synthetic correction history → offline ProfileDelta."""

from __future__ import annotations

from typing import Any, Callable

from training.dialog2000_v2_pilot200.constants import STRENGTH_TO_WEIGHT, USER_ASSIGNMENTS
from training.dialog2000_v2_pilot200.profile_delta_offline import apply_profile_delta, empty_user_profile
from training.dialog2000_v2_pilot200.term_banks import TERM_BANKS

STAGE_HISTORY_SPEC = {
    # (terms_per_relation, repeats_per_term)
    "P0": (0, 0),
    "P1": (2, 1),
    "P2": (4, 2),
    "P3": (6, 3),
}


def build_user_profiles(
    *,
    term_id_resolver: Callable[[str], tuple[str | None, str]] | None = None,
    build_banks: dict[str, list[str]] | None = None,
) -> dict[str, dict[str, Any]]:
    banks = build_banks or {k: v["build"] for k, v in TERM_BANKS.items()}
    out: dict[str, dict[str, Any]] = {}
    for user_id, strengths in USER_ASSIGNMENTS.items():
        build_surfaces: list[str] = []
        build_term_ids: list[str] = []
        for fam in strengths:
            for t in banks.get(fam, TERM_BANKS[fam]["build"]):
                if t not in build_surfaces:
                    build_surfaces.append(t)

        histories: dict[str, list[dict[str, Any]]] = {"P0": []}
        profiles: dict[str, dict[str, Any]] = {
            "P0": {
                "profileRef": f"prof_{user_id.lower()}_p0",
                "userId": user_id,
                "profileStage": "P0",
                "constructionMethod": "CORRECTION_HISTORY_PROFILE_DELTA",
                "dominantRelations": list(strengths.keys()),
                "profileBuildSetId": f"pbs_{user_id.lower()}_p0",
                "profileBuildTermIds": [],
                "userProfileV1": empty_user_profile(),
                "historyEvents": [],
            }
        }

        for stage in ("P1", "P2", "P3"):
            n_terms, repeats = STAGE_HISTORY_SPEC[stage]
            events: list[dict[str, Any]] = []
            profile = empty_user_profile()
            stage_term_ids: list[str] = []
            stage_surfaces: list[str] = []
            for fam, strength in strengths.items():
                weight = STRENGTH_TO_WEIGHT[strength]
                fam_build = banks.get(fam, TERM_BANKS[fam]["build"])
                picked: list[str] = []
                for t in fam_build:
                    if t not in picked:
                        picked.append(t)
                    if len(picked) >= n_terms:
                        break
                for term in picked:
                    stage_surfaces.append(term)
                    for r in range(repeats):
                        event_id = f"{user_id}_{stage}_{fam}_{term}_{r}"
                        events.append(
                            {
                                "source_event_id": event_id,
                                "feature_key": fam,
                                "term": term,
                                "evidence": 1.0,
                                "weight": weight,
                            }
                        )
                        resolved = None
                        if term_id_resolver is not None:
                            tid, surf = term_id_resolver(term)
                            resolved = tid
                            term_for_update = surf
                        else:
                            term_for_update = term
                        profile = apply_profile_delta(
                            profile,
                            source_event_id=event_id,
                            phonetic_updates=[
                                {
                                    "feature_key": fam,
                                    "evidence": 1.0,
                                    "weight": weight,
                                }
                            ],
                            personal_term_updates=[
                                {"term": term_for_update, "evidence": 1.0, "weight": weight}
                            ],
                            term_id_resolver=term_id_resolver,
                        )
                        if resolved:
                            if resolved not in stage_term_ids:
                                stage_term_ids.append(resolved)
                            if resolved not in build_term_ids:
                                build_term_ids.append(resolved)
                        else:
                            syn = f"surface:{term}"
                            if syn not in stage_term_ids:
                                stage_term_ids.append(syn)
                            if syn not in build_term_ids:
                                build_term_ids.append(syn)

            histories[stage] = events
            profiles[stage] = {
                "profileRef": f"prof_{user_id.lower()}_{stage.lower()}",
                "userId": user_id,
                "profileStage": stage,
                "constructionMethod": "CORRECTION_HISTORY_PROFILE_DELTA",
                "dominantRelations": list(strengths.keys()),
                "profileBuildSetId": f"pbs_{user_id.lower()}_{stage.lower()}",
                "profileBuildTermIds": stage_term_ids,
                "profileBuildSurfaces": stage_surfaces,
                "userProfileV1": profile,
                "historyEvents": events,
            }

        out[user_id] = {
            "profiles": profiles,
            "histories": histories,
            "build_term_ids": build_term_ids,
            "build_surfaces": build_surfaces,
            "dominantRelations": list(strengths.keys()),
            "strengths": strengths,
        }
    return out


def pick_wrong_user(user_id: str, relation_family: str | None) -> str | None:
    """Prefer another simulated user whose dominant relations do not include target relation."""
    target = relation_family
    for other, strengths in USER_ASSIGNMENTS.items():
        if other == user_id:
            continue
        if target and target in strengths:
            continue
        return other
    return None
