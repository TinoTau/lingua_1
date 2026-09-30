# Operations SSOT

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
