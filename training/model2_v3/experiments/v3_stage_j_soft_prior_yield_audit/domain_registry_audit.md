# Domain Registry Audit

## Python Stage D

`build_domain_action_catalog()` (`domain_actions.py` L28–31) emits `domain_none` + one `domain_soft:{d}` per `DOMAIN_SLOT_IDS` (12).

This is a **static frozen slot list**, not “on node start, scan Lexicon and register domains.”

All 588 identities in this index have at least one tag in `DOMAIN_SLOT_IDS` (ACTION_AVAILABLE=100% among BASE_ABSENT). Zero `DOMAIN_NOT_REGISTERED` on the audited population.

## Node

`queryDomainMultiRowsAtomic` takes caller-supplied `domainIds`. Session/profile resolution lives in `domain-recall-merge.ts` (marked `@deprecated` for V4 main chain).

## Verdict

Python eval registry ≠ live Lexicon scan. Slots still match the frozen 12 fine domains. Classification: **EXPECTED_IMPLEMENTATION** of the frozen contract list, with **mild DOMAIN_SSOT_DRIFT** vs the “build registry from Lexicon at startup” rule.
