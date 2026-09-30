# Pilot vs Real ASR Error Comparison

Measurement: **MEASURED_PARTIAL**

```json
{
  "measurement": "MEASURED_PARTIAL",
  "unequal_pairs_total_scanned_flag": 8793,
  "checked_for_active_applicability": 1500,
  "active_set_applicable_or_planned_family": 1401,
  "approx_rate_on_checked": 0.934,
  "note": "Applicability ≠ realized ASR error is that family; partial heuristic + planned family field",
  "pilot_family_counts": {
    "z_zh": 164,
    "eng_en": 264,
    "sh_s": 380,
    "in_ing": 215,
    "ORTHOGRAPHIC_DE_DI_DE": 35,
    "n_l": 124,
    "h_f": 129,
    "ch_c": 263
  }
}
```

Synthetic V1 covers ACTIVE_SET_V1 pronunciation families only; real ASR also contains non-phonetic errors — synthetic need not match all.
