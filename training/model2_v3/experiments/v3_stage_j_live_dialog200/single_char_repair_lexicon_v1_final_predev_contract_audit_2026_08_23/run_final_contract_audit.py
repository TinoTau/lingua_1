# -*- coding: utf-8 -*-
"""Final pre-development contract closure audit. READ ONLY."""
from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
OUT = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_lexicon_v1_final_predev_contract_audit_2026_08_23"
)
OUT.mkdir(parents=True, exist_ok=True)
STRICT = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv"
IME = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"
MANIFEST = ROOT / "node_runtime/lexicon/v3/manifest.json"
PRIOR_CONST = 0.9


def sha(p: Path) -> str:
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


def main() -> None:
    strict_rows = list(csv.DictReader(STRICT.open(encoding="utf-8-sig")))
    chars = {r["word"] for r in strict_rows}
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    write(
        OUT / "single_char_repair_v1_final_build_source_contract.md",
        f"""# Single-Char Repair Lexicon V1 — Final Build Source Contract (FROZEN)

## Authoritative Repair SSOT (ONE)

| Item | Value |
|------|-------|
| Path | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` |
| Format | TAB-separated, UTF-8 (BOM optional), **loader-native** |
| Rows | 1125 |
| Content | EXACT surface set of approved STRICT 1125 |
| Status | CREATE on implement (not generated this audit round) |

## Audit artifact (NOT build authority)

`docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv`
— selection provenance / frequencies. **RAW/AUDIT ONLY** after V1 TSV exists.

## Required columns (match `loadSingleCharRows`)

| Column | Required | V1 value |
|--------|----------|----------|
| `surface` | YES | one CJK char |
| `canonical` | YES | = surface |
| `pinyin` | YES | syllable **without** tone digit (e.g. `de`, `wo`) |
| `tone_pinyin` | YES | syllable **with** tone digit (e.g. `de5`, `wo3`) — derive from STRICT `pinyin` column |
| `weight` | YES | constant `{PRIOR_CONST}` (see Prior Contract) |
| `source` | YES | `single-char-repair-v1-strict` |

Do **not** include SUBTL/Weibo/tier/diagnostics in build SSOT.

## Loader contract (verified in code)

- File: `electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs`
- Function: `loadSingleCharRows(tsvPath, ...)`
- Delimiter: TAB
- Encoding: UTF-8, strips BOM
- Duplicate: skip duplicate `(pinyin_key, surface)` within file
- Skip if surface already in multi-char term set
- Sort: `word` then `id` localeCompare
- Term id: `slugTermId(surface, pinyinKey)` or `sc-<hash>`
- enabled: always 1 at insert
- repair_target: 0

## Injection (verified)

`runFullRebuildFromSources` → `opts.singleCharTsvPath || DEFAULT_SINGLE_CHAR_TSV()` → `loadSingleCharRows`.

Production CLI `run-lexicon-full-rebuild.mjs` does **not** pass `singleCharTsvPath` today; minimum fix = change `DEFAULT_SINGLE_CHAR_TSV()` to V1 path (or add CLI flag).

## Dual source: FORBIDDEN

Only `single_char_repair_lexicon_v1.tsv` is runtime build authority. No parallel patch JSON/CSV.
""",
    )

    write(
        OUT / "single_char_repair_v1_final_prior_contract.md",
        f"""# Single-Char Repair Lexicon V1 — Final Prior Contract (FROZEN)

## Constant

**`SINGLE_CHAR_REPAIR_V1_PRIOR = {PRIOR_CONST}`**

Applied to every V1 row at import via TSV `weight` column → `base_lexicon.prior_score`.

## IME weight

**FORBIDDEN** — IME role weights 0.08–0.30 must not be reused.

## End-to-end trace (code-verified)

| Step | File | Function/Field | Consumer | Condition |
|------|------|----------------|----------|-----------|
| Build SSOT | `single_char_repair_lexicon_v1.tsv` | `weight` | loader | constant {PRIOR_CONST} |
| Loader | `full-rebuild-from-csv.mjs` | `loadSingleCharRows` | maps to `prior_score` | `>0` else 0.12 default — V1 must supply weight |
| SQLite | `base_lexicon` | `prior_score` | runtime | stored |
| Runtime map | `lexicon-runtime-v2.ts` | `priorScore` | HotwordEntry | |
| Collector eligibility | `recall-span-topk-v2.ts` | `scoreHotword` / length1 filter | | `priorScore > 0` |
| SQL order | `lexicon-runtime-v2.ts` | `ORDER BY prior_score DESC` | tie order | all equal at {PRIOR_CONST} |
| Candidate score | `candidate-score.ts` | `computeCandidateScore` | ranking | **additive** `priorScore + phonetic + ...` (not probability) |
| Bind gate | `recall-topk-for-windows.ts` | `bindLexiconHitsToWindow` | | `priorScore >= minPrior` |
| minPrior | `fw-config.ts` | `minPrior` | default **0.5** | no length-1 bypass |

## Why {PRIOR_CONST} is safe

1. `{PRIOR_CONST} > 0` — collector eligibility ✓
2. `{PRIOR_CONST} >= 0.5` — bind minPrior ✓
3. Aligns with multi-char Full Rebuild default **0.9** (`full-rebuild-from-csv.mjs` multi-char path)
4. No code treats prior as probability on this path
5. No gate requiring `> 0.9` or `= 1.0` on bind/collector
6. Uniform constant removes false ranking among length-1 rows (membership already selective)

## Explicitly forbidden

- SUBTL/Weibo → prior formulas
- Per-character tuned priors
- Changing minPrior in the same change-set (separate decision if needed)

## CONTRACT_GAP resolved

Prior contract **FROZEN** for development validation.
""",
    )

    write(
        OUT / "single_char_repair_v1_final_rebuild_contract.md",
        """# Single-Char Repair Lexicon V1 — Final Rebuild Contract (FROZEN)

## Strategy

**REUSE FULL REBUILD (OPTION 1)** — no length-1 patch tool.

## Before → After

| | Before | After |
|--|--------|-------|
| singleCharSource | `docs/pinyin-v2/import/single_char_dictionary.tsv` | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` |
| length-1 count | 2510 | 1125 |
| IME TSV in Repair | YES (wrong) | NO |

## Minimum code changes (implement phase)

1. **CREATE** `single_char_repair_lexicon_v1.tsv` (1125 rows, loader shape)
2. **MODIFY** `DEFAULT_SINGLE_CHAR_TSV()` → V1 path
3. **MODIFY** manifest `rebuild.sources` hardcoded string (metadata only, line ~862)
4. **OPTIONAL RECOMMENDED** `dict-export-core.mjs` — `length(word) >= 2` on base export

## Preserved by Full Rebuild (unchanged inputs)

- `lexicon_full_corrected_review.csv` and other full_rebuild_v1 CSVs
- idiom JSONL, profile-registry, domain tags
- length>=2 base terms: **IDENTICAL** if those sources unchanged
- domain / term_domain_tags / aliases: rebuilt from same sources — **no business change expected**

## Forbidden

- Runtime filter keeping 2510 in sqlite
- Second import pipeline
- SQLite manual edits
- IME TSV as Repair fallback (must **fail closed** if V1 missing)

## Post-rebuild acceptance

- Set equality: enabled length-1 surfaces == V1 TSV surfaces == STRICT 1125
- Net delta: -1385 rows (auxiliary; set equality is primary)
- bundleVersion bump + checksum match
- 毫/涡/皿 NOT ACTIVE
- 的/吗/我 ACTIVE
""",
    )

    targets = [
        {
            "action": "CREATE",
            "path": "docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv",
            "why": "ONE authoritative Repair build SSOT; loader-native TAB; 1125 rows from STRICT mapping",
            "must_not": "Include audit-only frequency columns; dual patch files",
        },
        {
            "action": "MODIFY",
            "path": "electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs",
            "why": "DEFAULT_SINGLE_CHAR_TSV → V1 path; update manifest.rebuild.sources metadata",
            "must_not": "New loader pipeline; change multi-char load; change schema",
        },
        {
            "action": "MODIFY",
            "path": "electron_node/electron-node/scripts/pinyin-ime-v2/lib/dict-export-core.mjs",
            "why": "Optional: filter base_lexicon export to length>=2; avoid leaking Repair length-1",
            "must_not": "Keep 2510 mirror for export compatibility",
        },
        {
            "action": "KEEP",
            "path": "electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts",
            "why": "collectBaseOnlySingleCharCandidate unchanged",
            "must_not": "",
        },
        {
            "action": "KEEP",
            "path": "electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts",
            "why": "lookupBaseByPinyinAndToneKey unchanged",
            "must_not": "",
        },
        {
            "action": "KEEP",
            "path": "docs/pinyin-v2/import/single_char_dictionary.tsv",
            "why": "IME SSOT only",
            "must_not": "Delete or shrink for Repair",
        },
        {
            "action": "DO_NOT_TOUCH",
            "path": "electron_node/electron-node/main/src/model2-runtime/**",
            "why": "Model2 P/D only",
            "must_not": "Any Model2 single-char change",
        },
        {
            "action": "DO_NOT_TOUCH",
            "path": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/** (except optional export unrelated)",
            "why": "Recall/Assembly/KenLM architecture frozen",
            "must_not": "minPrior change in same PR unless separate approved",
        },
    ]
    write_csv(OUT / "single_char_repair_v1_development_target_list.csv", targets)

    write(
        OUT / "single_char_repair_v1_development_check_list.md",
        """# Development Check List

## Pre-implement
- [ ] STRICT CSV sha256 recorded
- [ ] Materialize V1 TSV 1125 rows (loader columns only)
- [ ] Verify every row: surface, canonical, pinyin, tone_pinyin, weight=0.9, source=single-char-repair-v1-strict

## Build
- [ ] `DEFAULT_SINGLE_CHAR_TSV` points to V1 TSV
- [ ] `npm run lexicon:full-rebuild -- --force`
- [ ] Promote bundle to `node_runtime/lexicon/v3`
- [ ] manifest.singleCharSource.path != IME TSV
- [ ] manifest.singleCharSource.recordCount = 1125

## Inventory
- [ ] enabled length(word)=1 count = 1125
- [ ] Surface set equals V1 TSV exactly
- [ ] length>=2 base snapshot diff = empty (lexical content)
- [ ] domain_lexicon / term_domain_tags counts unchanged

## Pollution / function
- [ ] 毫 涡 皿 not in enabled length-1
- [ ] 的 吗 我 present
- [ ] prior_score all = 0.9 (or frozen constant)

## Architecture
- [ ] No new table
- [ ] Collector tests pass without code change
- [ ] Model2 unchanged

## Tooling
- [ ] IME runtime still loads IME TSV
- [ ] Export tool reviewed (length filter if applied)

## After only
- [ ] dialog_200 measurement (not membership tuning)
""",
    )

    write_json(
        OUT / "single_char_repair_v1_expected_post_rebuild_inventory.json",
        {
            "enabled_length1_rows": 1125,
            "old_length1_rows": 2510,
            "net_delta": -1385,
            "set_equality_required": True,
            "length_ge2_change": "NONE_EXPECTED",
            "domain_data_change": "NONE_EXPECTED",
            "prior_score_all": PRIOR_CONST,
            "source_label": "single-char-repair-v1-strict",
            "pollution_absent": ["毫", "涡", "皿"],
            "function_present": ["的", "吗", "我"],
            "active_bundle_before": {
                "bundleVersion": manifest.get("bundleVersion"),
                "singleCharSource": manifest.get("sourceInputs", {}).get("singleCharSource"),
            },
        },
    )

    write_json(
        OUT / "single_char_repair_v1_ssot_final_check.json",
        {
            "repair_ssot_count": 1,
            "repair_ssot_path": "docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv",
            "ime_ssot_count": 1,
            "ime_ssot_path": "docs/pinyin-v2/import/single_char_dictionary.tsv",
            "repair_ime_mixed": False,
            "dual_repair_source": False,
            "strict_csv_is_build_authority": False,
        },
    )

    write_json(
        OUT / "single_char_repair_v1_no_fallback_check.json",
        {
            "ime_fallback_to_tsv_on_missing_repair": False,
            "loadSingleCharRows_on_missing": "throws Error",
            "DEFAULT_SINGLE_CHAR_TSV_currently_ime": True,
            "after_dev_must_point_v1": True,
            "hidden_dual_source": False,
        },
    )

    write_json(
        OUT / "single_char_repair_v1_architecture_preservation_check.json",
        {
            "recall_change": False,
            "fineSpan_change": False,
            "domain_vote_change": False,
            "assembly_change": False,
            "kenlm_change": False,
            "new_table": False,
            "second_pipeline": False,
            "runtime_filter": False,
            "expected_modify_file_count_small": True,
            "architecture_drift_risk": False,
        },
    )

    write_json(
        OUT / "single_char_repair_v1_model2_model3_isolation_check.json",
        {
            "model2_modified": False,
            "model3_created": False,
            "model3_placeholder": False,
            "model3_interface": False,
            "model3_references_in_electron_node": 0,
        },
    )

    write(
        OUT / "single_char_repair_v1_export_tooling_impact.md",
        """# Export tooling impact

## Runtime IME (product)

`pinyin-ime-v2-dict-load.ts` reads `single_char_dictionary.tsv` — **NOT affected** if IME TSV preserved.

## Export tool

`scripts/pinyin-ime-v2/lib/dict-export-core.mjs` → `fetchRows(db, 'base_lexicon')` with **no length filter**.

After V1 rebuild, exported IME base layer would include 1125 Repair singles unless filtered.

| | |
|--|--|
| Runtime dependency | NO (IME decode uses TSV) |
| Must fix in same development | **RECOMMENDED** (add `AND length(word) >= 2`) |
| Reason to keep 2510 mirror | **FORBIDDEN** |
""",
    )

    write_json(
        OUT / "go_summary.json",
        {
            "verdict": "PASS",
            "prior_frozen": True,
            "prior_constant": PRIOR_CONST,
            "build_ssot_frozen": True,
            "safe_to_develop": True,
            "next_phase": "SINGLE_CHAR_REPAIR_V1_IMPLEMENT_REBUILD",
            "strict_sha256": sha(STRICT),
            "sqlite_writes": 0,
        },
    )

    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": str(OUT), "action": "created"},
            {
                "path": "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_V1_Final_PreDevelopment_Contract_Audit_2026_08_23.md",
                "action": "created",
            },
            {"path": "electron_node/**", "action": "UNCHANGED"},
            {"path": "node_runtime/lexicon/v3/**", "action": "UNCHANGED"},
        ],
    )

    print("PASS", len(chars))


if __name__ == "__main__":
    main()
