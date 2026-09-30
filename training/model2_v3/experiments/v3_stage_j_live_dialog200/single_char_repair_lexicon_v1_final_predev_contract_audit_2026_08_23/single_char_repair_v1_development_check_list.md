# Development Check List

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
