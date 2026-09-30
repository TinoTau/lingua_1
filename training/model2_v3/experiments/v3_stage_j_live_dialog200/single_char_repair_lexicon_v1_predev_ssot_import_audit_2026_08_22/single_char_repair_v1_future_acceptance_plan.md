# Future acceptance plan (post-rebuild; not run now)

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
