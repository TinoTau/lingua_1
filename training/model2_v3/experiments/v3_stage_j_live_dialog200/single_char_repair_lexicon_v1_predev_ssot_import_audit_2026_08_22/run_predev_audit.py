# -*- coding: utf-8 -*-
"""Pre-development SSOT/import audit for STRICT-1125. READ ONLY."""
from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
OUT = (
    ROOT
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "single_char_repair_lexicon_v1_predev_ssot_import_audit_2026_08_22"
)
OUT.mkdir(parents=True, exist_ok=True)

STRICT = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv"
IME = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"
CJK = re.compile(r"^[\u4e00-\u9fff\u3400-\u4dbf]$")
PY = re.compile(r"^[a-z]+[1-5]?$", re.I)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def validate_strict() -> dict:
    rows = list(csv.DictReader(STRICT.open(encoding="utf-8-sig")))
    words = [r["word"].strip() for r in rows]
    dups = [w for w, c in Counter(words).items() if c > 1]
    return {
        "file": str(STRICT.relative_to(ROOT)).replace("\\", "/"),
        "sha256": sha256(STRICT),
        "expected_rows": 1125,
        "rows": len(rows),
        "unique_characters": len(set(words)),
        "duplicate_surfaces": len(dups),
        "duplicate_sample": dups[:10],
        "non_han_rows": sum(1 for w in words if not CJK.match(w)),
        "multi_character_rows": sum(1 for w in words if len(w) != 1),
        "missing_pinyin": sum(1 for r in rows if not (r.get("pinyin") or "").strip()),
        "missing_tone": sum(1 for r in rows if not str(r.get("tone") or "").strip()),
        "invalid_tone": sum(1 for r in rows if str(r.get("tone") or "").strip() not in set("12345")),
        "invalid_pinyin": sum(1 for r in rows if not PY.match((r.get("pinyin") or "").strip())),
        "encoding": "utf-8-sig",
        "delimiter": "comma_csv",
        "headers": list(rows[0].keys()) if rows else [],
        "case_specific_overrides": 0,
        "sorting": "as_in_file_combined_frequency_desc_observed",
        "loader_compat_today": {
            "loadSingleCharRows_expects": ["surface|canonical", "pinyin", "tone_pinyin", "weight?", "source?"],
            "strict_has": ["word", "pinyin", "tone", "frequency_*", "tier", "source"],
            "delimiter_match": False,
            "column_name_match": False,
            "direct_path_swap_works": False,
            "note": "Need build SSOT in loader shape OR minimal loader field-map; not a second pipeline",
        },
        "content_valid": len(rows) == 1125
        and len(set(words)) == 1125
        and not dups
        and all(CJK.match(w) for w in words),
    }


def main() -> None:
    v = validate_strict()
    write_json(OUT / "single_char_repair_v1_input_validation.json", v)
    write_json(
        OUT / "single_char_repair_v1_provenance.json",
        {
            "content_authority": "Lingua_single_char_repair_lexicon_strict_v1.csv",
            "selection_rule": "CLD v2.1 one-char lexical entry + FrequencySUBTL>=10 AND FrequencyWeibo>=10",
            "selection_version": "strict_v1 / Final Selection Audit 2026-08-21",
            "upstream": "Chinese Lexical Database v2.1",
            "license": "GPL stated in README — PENDING FOR PRODUCTION; not blocking internal validation",
            "proposed_build_ssot_name": "docs/user_correction/single_char/single_char_repair_lexicon_v1.csv",
            "proposed_source_label_in_sqlite": "single-char-repair-v1-strict",
            "ime_tsv": "docs/pinyin-v2/import/single_char_dictionary.tsv — IME ONLY after cutover",
            "sha256_strict": v["sha256"],
        },
    )

    write(
        OUT / "current_ime2510_to_base_lexicon_build_flow.md",
        """# Current IME 2510 → base_lexicon build flow

```
docs/pinyin-v2/import/single_char_dictionary.tsv
  (surface, canonical, pinyin, tone_pinyin, weight, source, single_char_role, ...)
        |
        v
full-rebuild-from-csv.mjs
  DEFAULT_SINGLE_CHAR_TSV() or opts.singleCharTsvPath
  loadSingleCharRows()
    - TAB header
    - surface/canonical length==1 CJK
    - skip if surface already in multi-char term set
    - weight -> prior_score (default 0.12)
    - source column or common-standard-level-1+pinyin-data
    - id = slugTermId / sc-<hash>
        |
        v
INSERT term + INSERT base_lexicon (tier=base, no domain tags)
        |
        v
manifest.sourceInputs.singleCharSource = { path, sha256, recordCount:2510, skipped }
bundleVersion (currently 13), checksum of lexicon.sqlite
        |
        v
promote -> node_runtime/lexicon/v3/
```

Injection point (unique): `loadSingleCharRows` + default path `DEFAULT_SINGLE_CHAR_TSV`.
""",
    )

    write(
        OUT / "strict1125_target_build_flow.md",
        """# Target STRICT 1125 build flow (proposed; not executed)

```
Authoritative Repair SSOT (ONE file):
  docs/user_correction/single_char/single_char_repair_lexicon_v1.csv
  (= STRICT 1125 content, build-ready columns; see source contract)
        |
        v
full-rebuild-from-csv.mjs  (SAME pipeline)
  singleCharTsvPath / DEFAULT path -> Repair V1 SSOT
  loadSingleCharRows (reuse; minimal field-map if needed)
    - prior_score: MUST NOT use IME weight
    - prior_score: value per Prior Contract (not frozen this audit — CONTRACT_GAP)
    - source: single-char-repair-v1-strict
        |
        v
term + base_lexicon length=1 = 1125
manifest.singleCharSource.path != IME TSV
recordCount = 1125
bundleVersion++
        |
        v
node_runtime/lexicon/v3/

IME remains:
  docs/pinyin-v2/import/single_char_dictionary.tsv  (IME ONLY; not Repair input)
```

No second import pipeline. No length-1 patch tool. Prefer Full Rebuild.
""",
    )

    write_csv(
        OUT / "single_char_build_minimum_change_inventory.csv",
        [
            {
                "change_id": "M1",
                "item": "Freeze ONE build SSOT file from STRICT 1125",
                "required": "YES",
                "notes": "Prefer docs/user_correction/single_char/single_char_repair_lexicon_v1.csv",
            },
            {
                "change_id": "M2",
                "item": "Point DEFAULT_SINGLE_CHAR_TSV / singleCharTsvPath to Repair SSOT",
                "required": "YES",
                "notes": "Stop reading IME TSV for Repair",
            },
            {
                "change_id": "M3",
                "item": "Loader field-map OR SSOT columns match loadSingleCharRows",
                "required": "YES",
                "notes": "STRICT raw CSV is comma + word/tone; loader expects tab + surface/tone_pinyin",
            },
            {
                "change_id": "M4",
                "item": "Prior mapping (not IME weight)",
                "required": "YES",
                "notes": "CONTRACT_GAP until value frozen; proposal: constant clearing minPrior",
            },
            {
                "change_id": "M5",
                "item": "source label single-char-repair-v1-strict",
                "required": "YES",
                "notes": "",
            },
            {
                "change_id": "M6",
                "item": "Full Rebuild + promote + bundleVersion bump",
                "required": "YES",
                "notes": "OPTION 1; no new patch tool",
            },
            {
                "change_id": "M7",
                "item": "IME export length>=2 hygiene",
                "required": "RECOMMENDED",
                "notes": "tooling only; do not keep 2510 mirror",
            },
            {
                "change_id": "M8",
                "item": "New table / collector / Model2 / second pipeline",
                "required": "NO",
                "notes": "forbidden",
            },
        ],
    )

    write(
        OUT / "single_char_repair_v1_source_contract.md",
        """# Single-Char Repair Lexicon V1 — Source Contract

## Authoritative FW Repair single-char SSOT

**ONE file:** `docs/user_correction/single_char/single_char_repair_lexicon_v1.csv`

- Content = approved STRICT 1125 (Final Selection Audit 2026-08-21).
- Do not also treat `Lingua_single_char_repair_lexicon_strict_v1.csv` as a second live SSOT after cutover; that file may remain as historical generation artifact, or be replaced by the V1 filename (same bytes).
- No manual patch list, no SQLite edits, no JSON override, no runtime filter list.

## IME SSOT (separate)

`docs/pinyin-v2/import/single_char_dictionary.tsv` — IME ONLY.

## Build-ready columns (minimum)

Must supply what `base_lexicon` / `loadSingleCharRows` need (names may be aliased in loader):

| Field | Required | Notes |
|-------|----------|-------|
| surface (or word) | YES | one CJK char |
| canonical_surface | YES | usually = surface |
| pinyin | YES | syllable; tone digit optional if tone column present |
| tone / tone_pinyin | YES | digit 1–5 or tone-marked key |
| source | YES | `single-char-repair-v1-strict` |
| prior_score or import constant | YES | per Prior Contract — not IME weight |
| enabled | default 1 | |

Forbidden V1 columns: `manual_include`, `manual_exclude`, `dialog_override`, `special_case`.

Optional offline-only (not required in sqlite): CLD frequencies (for audit/prior later).

## Provenance (build source / manifest)

Record selection rule version + file sha256 in `manifest.sourceInputs.singleCharSource`. Runtime schema need not add wordhood columns.
""",
    )

    write(
        OUT / "single_char_length1_prior_consumer_audit.md",
        """# Length-1 prior consumer audit

## Collector (`collectBaseOnlySingleCharCandidate` / eligibility)

- Rejects `priorScore <= 0` or non-finite (**A: eligibility > 0**).
- SQL `ORDER BY prior_score DESC` among tone-exact hits (**B: ranking** when N>1; unique-only often collapses to 0/1).

## Bind (`bindLexiconHitsToWindow`)

- `priorScore >= minPrior` (default **0.5** from `fw-config`) (**C: minPrior gate**).
- **No length branch** — length-1 uses same gate as multi-char.
- Historical Bind MinPrior Length-1 Audit (2026-08-19): IME weights 0.08–0.30 → **0** length-1 binds.

## Downstream

FineSpan/Assembly/KenLM do not redefine prior; they consume bound candidates.

## IME role weight

**NOT** reusable as Repair prior.
""",
    )

    write(
        OUT / "single_char_repair_v1_prior_contract_proposal.md",
        """# Prior contract proposal (NOT FROZEN)

## Status

**CONTRACT_GAP** — this audit must not casually freeze a numeric prior to force PASS.

## Facts forcing an operational prior

1. Schema: `prior_score REAL NOT NULL`.
2. Collector: requires `prior > 0`.
3. Bind: requires `prior >= minPrior` (0.5) or length-1 never materializes.
4. Complex frequency→prior mapping: **forbidden** this round (simplicity rule).
5. Changing minPrior: **forbidden** this round.

## Simplest contract candidate (for next freeze)

| Item | Proposal |
|------|----------|
| Kind | **Constant** for all V1 length-1 rows |
| Suggested value | **0.9** (same default as multi-char Full Rebuild CSV / idiom path) |
| Range | Fixed; must be `>= 0.5` and `> 0` |
| Source | Import-time constant — **not** IME weight, **not** CLD frequency remap |
| Consumer | Collector eligibility + bind minPrior + SQL order (ties only) |

Alternative acceptable band historically discussed: 0.85–0.95. Pick one constant in development ACP.

## Explicit non-goals

- No per-character weight table
- No SUBTL/Weibo → prior formula in V1
- No minPrior change in the same change-set as SSOT swap
""",
    )

    write_json(
        OUT / "single_char_minprior_dependency_check.json",
        {
            "minPrior_default": 0.5,
            "owner": "bindLexiconHitsToWindow / fw-config",
            "applies_to_length1": True,
            "length1_bypass": False,
            "ime_weight_passes_minPrior": False,
            "CONTRACT_GAP": True,
            "gap_description": "Operational prior for STRICT rows not frozen; must clear minPrior without changing minPrior",
            "fix_minPrior_this_round": False,
        },
    )

    write_json(
        OUT / "single_char_repair_v1_base_lexicon_schema_fit.json",
        {
            "SCHEMA_REUSE_SUPPORTED": True,
            "schema_change_required": False,
            "fields_ok": [
                "id",
                "word",
                "canonical_word",
                "normalized",
                "pinyin_key",
                "tone_pinyin_key",
                "prior_score",
                "enabled",
                "source",
                "is_alias",
            ],
            "polyphonic": "PARTIAL_KNOWN_LIMITATION",
            "blocks_v1": False,
        },
    )

    write(
        OUT / "single_char_repair_v1_term_identity_contract.md",
        """# Term identity contract

## Generation (existing)

`loadSingleCharRows`:
- `id = slugTermId(surface, pinyinKey)`
- collision → `sc-<sha256(surface|pinyinKey)[:16]>`

## Rules for V1 rebuild

- Do **not** preserve old IME 2510 row ids.
- Identities regenerate from STRICT surfaces + pinyin keys.
- PK remains `(pinyin_key, word)` on `base_lexicon`.
- Matching `term` rows inserted with `tier=base`.
""",
    )

    write(
        OUT / "single_char_repair_v1_operations_ssot.md",
        """# Operations SSOT

## One Repair source

All ADD / DISABLE / CORRECT PINYIN|TONE for single-char V1:

1. Edit `single_char_repair_lexicon_v1.csv` (only SSOT)
2. Full Rebuild + promote
3. Verify manifest.singleCharSource + length-1 inventory

## Forbidden

- Direct SQLite row edits as ops process
- Patch file / override file / second list
- dialog_200-driven membership
- Shrinking IME TSV for Repair reasons
""",
    )

    write(
        OUT / "single_char_repair_v1_rebuild_option_comparison.md",
        """# Rebuild option comparison

| | OPTION 1 Full Rebuild + swap singleCharSource | OPTION 2 Length-1-only patch tool |
|--|-----------------------------------------------|-----------------------------------|
| Existing | YES | NO (would invent) |
| Atomicity / checksum / manifest | Proven | Must reimplement |
| Risk to length>=2 / domains | Low if multi-char sources unchanged (verify) | Lower blast radius in theory; higher process risk |
| Simplicity | BETTER | WORSE |
| Recommendation | **OPTION 1** | Reject for V1 |

Expected delta: length-1 −2510 +1125 ⇒ net **−1385** rows (verify by surface set, not count alone).
""",
    )

    write(
        OUT / "single_char_repair_v1_future_acceptance_plan.md",
        """# Future acceptance plan (post-rebuild; not run now)

1. `enabled length=1` count = 1125
2. Character set exact-equal to Repair V1 SSOT / STRICT
3. manifest.singleCharSource.path ≠ IME TSV; recordCount=1125; checksum match
4. bundleVersion bumped
5. length>=2 base surfaces unchanged vs pre-rebuild snapshot
6. domain_tags / idioms / routing counts stable (or explained)
7. Examples ABSENT: 毫 涡 皿 (IME pollution); function words still PRESENT (的了吗我…)
8. Collector path unchanged tests still green
9. Model2 single-char symbols still absent
10. dialog_200 **measurement only** after rebuild — never membership
11. prior_score all rows satisfy frozen Prior Contract and `>= minPrior`
""",
    )

    write(
        OUT / "single_char_repair_v1_export_tooling_impact.md",
        """# IME export tooling impact

## Product IME runtime

Loads `single_char_dictionary.tsv` — **unaffected** if TSV preserved.

## Export tool (`dict-export-core.mjs`)

Dumps **all** enabled `base_lexicon` (no length filter) into IME base layer.

After V1: exported base layer length-1 set becomes 1125 STRICT (or fewer if filter added), not 2510.

## Required adjustment

**RECOMMENDED:** export `WHERE length(word) >= 2` for base layer (or document that Repair length-1 may appear in export).

**Do not** keep IME 2510 mirrored in Repair sqlite for export compatibility.
""",
    )

    # governance
    write_json(
        OUT / "single_char_repair_v1_ssot_check.json",
        {
            "repair_ssot_count": 1,
            "proposed_path": "docs/user_correction/single_char/single_char_repair_lexicon_v1.csv",
            "ime_mixed_as_repair": False,
            "dual_source_fallback": False,
        },
    )
    write_json(OUT / "no_new_table_check.json", {"new_table": False})
    write_json(OUT / "no_second_pipeline_check.json", {"second_pipeline": False, "reuse_full_rebuild": True})
    write_json(OUT / "model2_pd_only_check.json", {"model2": "P_D_ONLY", "single_char": False})
    write_json(
        OUT / "ime_ssot_preservation_check.json",
        {"ime_tsv": "docs/pinyin-v2/import/single_char_dictionary.tsv", "modify_ime": False, "keep_for_ime": True},
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": str(OUT), "action": "created", "notes": "audit only"},
            {
                "path": "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_V1_PreDevelopment_SSOT_Import_Audit_2026_08_22.md",
                "action": "created",
                "notes": "report",
            },
            {"path": "node_runtime/lexicon/v3/lexicon.sqlite", "action": "UNCHANGED", "notes": ""},
            {"path": "docs/pinyin-v2/import/single_char_dictionary.tsv", "action": "UNCHANGED", "notes": ""},
            {"path": "electron_node/**", "action": "UNCHANGED", "notes": "no code change this round"},
        ],
    )
    write_json(
        OUT / "go_summary.json",
        {
            "verdict": "CONTRACT_GAP",
            "primary_gap": "prior_score operational value not frozen (must clear minPrior=0.5 without IME weights)",
            "secondary_gap": "STRICT CSV not loadSingleCharRows-native; need one build SSOT shape or minimal field-map",
            "safe_to_proceed_to_development": True,
            "recommended_build": "OPTION_1_FULL_REBUILD_SWAP_SOURCE",
            "new_table": False,
            "second_pipeline": False,
            "sqlite_writes": 0,
            "strict_rows_valid": v["content_valid"],
        },
    )

    print(json.dumps({"verdict": "CONTRACT_GAP", "validation": v}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
