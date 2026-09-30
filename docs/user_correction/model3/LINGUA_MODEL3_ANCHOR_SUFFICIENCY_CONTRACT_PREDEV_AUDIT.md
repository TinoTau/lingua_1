# LINGUA_MODEL3_ANCHOR_SUFFICIENCY_CONTRACT_PREDEV_AUDIT

**PHASE:** `LINGUA_MODEL3_ANCHOR_SUFFICIENCY_CONTRACT_PREDEVELOPMENT_AUDIT`  
**MODE:** READ-ONLY · PRE-DEVELOPMENT CONTRACT AUDIT · TRACE-FIRST · CONTROL-GROUP REQUIRED  
**PRODUCT_CODE_CHANGE_THIS_ROUND:** `NO`

---

## 0. Baseline Identity

| Check | Expected | Observed |
|------|----------|----------|
| Previous phase | `LINGUA_MODEL3_ANCHOR_EVIDENCE_SUFFICIENCY_AUDIT` | PASS |
| FALSE cases | 9 | 9 |
| A1 / A3 | 1 / 8 | unchanged (not reopened) |
| Sufficiency contract | ABSENT | ABSENT |
| Coverage granularity | LOST | LOST |
| Owner | `ANCHOR_EVIDENCE_SUFFICIENCY_OWNER` | same |
| Production entry | `model3-anchor-adapter.ts` :: `materializeModel3Anchors` | confirmed |
| Predicate | `domainOk OR model2Ok → whole PathFineSpan Anchor` | confirmed lines 114–116 |

```text
BASELINE_IDENTITY = PASS
```

---

## 1. Frozen constraints (honored)

No reopen of Model2 insertion/binding, Domain Vote redesign, FineSpan, Tone, Retry, Stage-2, KenLM, Assembly, JobResult, Model3 weights.  
Pilot `target*` used **only** as AUDIT_GROUND_TRUTH, never as runtime predicate input.

---

## 2. Groups

### Group F — Known False Anchors (NEGATIVE CONTROL)

Exactly the prior 9 M3-B residual spans:

`p2_u001_020, p2_u002_012, p2_u003_017, p2_u003_024, p2_u004_005, p2_u004_009, p2_u004_019, p2_u005_019, p2_u005_034`

### Group C — Legitimate / overprotect controls (N=12)

| caseId | Why included (AUDIT GT) |
|--------|-------------------------|
| p2_u002_037 | ASR≠target region complex; off-target + soft anchors |
| p2_u002_010 | ASR contains exact `工作制` |
| p2_u005_020 | ASR contains exact `显示屏` |
| p2_u001_018 | ASR contains exact `信息牌` |
| p2_u002_003 | ASR contains exact `自由行` |
| p2_u004_008 | ASR contains exact `检查和` |
| p2_u001_025 | CLEAN_PRESERVE |
| p2_u001_029 | CLEAN / short |
| p2_u003_016 | M3-D; off-target anchors (套餐等) |
| p2_u004_001 | CORRECT_PROFILE SUCCESS path |
| p2_u001_039 | MODEL2 mono「刘」probe (contrast vs 藏) |
| p2_u003_022 | M3-D off-target anchors |

```text
CONTROL_GROUP_COUNT = 12
CONTROL_GROUP_VALID = YES
```

Replay: CORRECT_PROFILE + frozen tone evidence + `MODEL2_DIALOG200_TRACE=1` (read-only harness under `audit_temp_predev/`, deleted after extraction).

---

## 3. Runtime field inventory (selected)

| FIELD | PRODUCER | @Window | @Candidate | @Edge | @PathFineSpan | @Anchor adapter | SEMANTIC |
|-------|----------|---------|------------|-------|---------------|-----------------|----------|
| windowText / windowPinyinKey | GlobalWindowDescriptor | Y | copied as `windowPinyinKey` | via cand | via cand | readable | ASR observation pinyin, **not** candidate lexicon pinyin |
| replacement | lexicon / Model2 materialize | — | Y | Y | Y | Y | candidate **surface** |
| source | graph (`domain_term`/`base_term`/…) | — | Y | Y | Y | Y | edge source class |
| retrievalProvenance | tagBase / materializeProfile/Domain | — | Y | Y | Y | Y | BASE_FUZZY / PROFILE_* |
| domains[] | hotword / D hit | — | Y | Y | Y | Y | domain membership |
| termId | lexicon id | — | Y | Y | Y | Y | term identity |
| geometry raw/syl | window/policy | Y | Y | Y | Y | Y | bind + cover |
| originSpanId | Model2 policy span | — | Y | Y | Y | Y | origin bind |
| model2ActionId | Model2 | — | Y | Y | Y | Y | which action introduced |
| vote.retainedDomains | Domain Vote | — | — | — | — | Y | retained set |
| rawText | pipeline | — | — | — | — | Y | slice → spanSurface |
| hit.pinyin_key / hotword.pinyin | recall hit | Y(hit) | **NO** | NO | NO | NO | **dropped** |
| transformed query syllables / nChanged | relation-lexicon-adapter | transient | **NO** | NO | NO | NO | **dropped** |
| acousticTonePattern | tone rebind | — | — | — | toneRebindTrace | not used by adapter | tone only |

---

## 4. Evidence loss audit

| Class | Finding |
|-------|---------|
| **E1** | `replacement`, `domains`, `retrievalProvenance`, geometry, `rawText`, `retainedDomains` already at adapter |
| **E2** | Candidate lexicon pinyin (`hit.pinyin_key`) dropped in `candidate-materialize.ts`; transformed query / `nChanged` never stored on `WindowCandidate` |
| **E3** | Span surface = `rawText.slice(rawStart,rawEnd)`; full-geometry exact surface check **derivable** without new fields |
| **E4** | No syllable coverage bitmap field exists on candidates |
| **E5** | Not required for recommended contract |

```text
EVIDENCE_LOSS_LOCATION =
candidate-materialize.ts (drop hit pinyin) +
relation-lexicon-adapter.ts (drop transform coverage) ;
Anchor adapter never compares surface (semantic gap, not missing bytes for CONTRACT_A)
```

Trace note: `DIALOG200_CANDIDATE_CAP=24` truncates **observation** dumps; production `activeCandidates` remain uncapped. Counterfactuals for soft-list spans used bound samples + `exactSurfaceFullGeomCount` from union of capped lists; residual FALSE spans remain decisive.

---

## 5. Q1–Q3 evidence semantics

### Q1 — `domain_term` meaning

**Soft / membership expansion**, not “explains this span surface/pronunciation”.  
Empirically: span `德鸾` / `理事` bind candidates `预订|入园|…` with `windowPinyinKey` = ASR pinyin of the span.

### Q2 — `PROFILE_DOMAIN`

Model2 **DAction** soft expansion (`materializeDomainHits`), **not** pronunciation relation explanation. Dual-triggers `domainOk` and `model2Ok` today.

### Q3 — Is PROFILE_DOMAIN sufficiency evidence?

```text
PROFILE_DOMAIN_IS_SUFFICIENCY_EVIDENCE = CONDITIONAL
```

Only if the same candidate also **names** the span (`replacement === spanSurface`) and carries retained domain — i.e. it collapses to lexical+domain proof. Soft mismatched surfaces = **NONE**.

### P vs D separation

| Provenance | Proves | Can justify protection alone? |
|------------|--------|-------------------------------|
| PROFILE_PRONUNCIATION | relation-conditioned lexicon retrieval | **NO** |
| PROFILE_RETRIEVAL | profile lexical retrieval | **NO** alone (need surface/domain sufficiency) |
| PROFILE_DOMAIN | domain soft expansion | **NO** unless exact surface+retained domain |
| BASE_FUZZY exact surface echo | ASR string is a known term | **NO** alone (注册/藏 false positives) |

```text
RETAINED_DOMAIN_MEMBERSHIP_ALONE_CAN_PROVE_ANCHOR = NO
DOMAIN_MEMBERSHIP_SUFFICIENCY_ROLE = SUPPORT_ONLY
MODEL2_PRONUNCIATION_SUFFICIENCY_ROLE = NONE
LEXICAL_EVIDENCE_SUFFICIENCY_ROLE = CONDITIONAL
```

---

## 6. Pronunciation coverage

Upstream `hypothesizeIntendedSyllables` computes `{syllables, nChanged}` but **does not** persist per-position deltas onto candidates.  
At Anchor adapter: coverage = **not available** (would be E2/E4).  
Recommended contract **does not** depend on coverage (avoids E5 / Architecture Change).

Partial Model2 transform is neither proof of Anchor nor of RETRY (frozen): other evidence must decide protection.

---

## 7. Contract candidates (≤3)

### CONTRACT_A — RECOMMENDED

```text
FULL_GEOMETRY_EXACT_SURFACE_AND_RETAINED_DOMAIN

Anchor iff ∃ activeCandidate c:
  boundToSpan(c, span) AND
  c.rawStart==span.rawStart AND c.rawEnd==span.rawEnd AND
  c.syllableStart==span.syllableStart AND c.syllableEnd==span.syllableEnd AND
  c.replacement === rawText.slice(span.rawStart, span.rawEnd) AND
  (c.domains ∩ vote.retainedDomains) ≠ ∅
```

Uses only E1/E3 fields. No Pilot target. No Model2/Domain Vote semantic change.

### CONTRACT_B

```text
FULL_GEOMETRY_EXACT_SURFACE_NON_PROFILE_DOMAIN_PROVENANCE
(replacement===spanSurface ∧ provenance ≠ PROFILE_DOMAIN)
```

### CONTRACT_C

```text
FULL_GEOMETRY_EXACT_SURFACE_ANY
```

---

## 8. Counterfactual results

### Group F — residual span only

| caseId | residual | Cur | A | B | C |
|--------|----------|-----|---|---|---|
| p2_u001_020 | 理事 | D∧M2 | NON | NON | NON |
| p2_u002_012 | 注册 | D∧M2 | NON | **ANCHOR** | **ANCHOR** |
| p2_u003_017 | 市场 | D∧M2 | NON | NON | NON |
| p2_u003_024 | 对方 | D∧M2 | NON | NON | NON |
| p2_u004_005 | 把剪 | D∧M2 | NON | NON | NON |
| p2_u004_009 | 藏 | M2 | NON | **ANCHOR** | **ANCHOR** |
| p2_u004_019 | 德鸾 | D∧M2 | NON | NON | NON |
| p2_u005_019 | 归病 | D∧M2 | NON | NON | NON |
| p2_u005_034 | 解锁 | D∧M2 | NON | NON | NON |

```text
FALSE_ANCHOR_REJECTION:
  CONTRACT_A = 9/9
  CONTRACT_B = 7/9  (fails 注册, 藏 — BASE_FUZZY surface echo)
  CONTRACT_C = 7/9
```

Why B/C fail on 藏/注册: ASR surface is itself a lexicon `BASE_FUZZY` term; exact surface ≠ “sufficiently explained residual”.

### Group C — current Anchor spans

```text
CONTROL current Anchor spans = 62
CONTRACT_A/B/C preserve = 0/62
```

Classification (not failure):

```text
CURRENT_ANCHOR_WAS_ACTUALLY_OVERPROTECTED = 62/62
```

Visible bound evidence on control anchors is overwhelmingly `PROFILE_DOMAIN` soft lists (`接客/预订/中杯/…`) with **mismatched** surfaces — same false mechanism as Group F, on text that GT says needs no Model3 repair.

```text
NOT_ANCHOR ≠ WRONG
NOT_ANCHOR ≠ RETRY
```

Demotion means Model3 **may KEEP**; it does not mandate RETRY.

### Positive sufficiency exemplar (same replay)

`p2_u001_020` off-residual span **行程**: `replacement=行程`, `source=domain_term`, `domains=[tourism_route]` ∩ retained → **CONTRACT_A ANCHOR**. Proves the predicate can fire when evidence is real.

---

## 9. Protection risk

| Risk | Verdict |
|------|---------|
| Lose soft-domain anchors on clean text | Expected / correct (overprotect removal) |
| Lose MODEL2-only mono (刘) | Expected: P alone ≠ sufficiency; Assembly still has `牛` candidates |
| Lose BASE_FUZZY echo (藏/注册) | Desired for false residual |
| Lose true domain-named exact spans | Should preserve (exemplar 行程); controls showed 0 such among *current* anchors under visible evidence |

```text
LEGITIMATE_ANCHOR_PRESERVATION =
0/62 current control anchors (overprotected demotion)
+ CONTRACT_A preserves true exact+domain when present
```

---

## 10. Data / ownership / perf

```text
DATA_DELTA = DERIVE_FROM_EXISTING_FIELDS
NO_NEW_FIELD for recommended contract
SERVICE_INTERNAL_FIELD_REQUIRED = optional reason enum for observability only
JOBRESULT_CHANGE_REQUIRED = NO
CAN_FIX_REMAIN_INSIDE_ANCHOR_OWNER = YES
NEW_MODEL_CALLS = 0
NEW_DB_CALLS = 0
NEW_MODEL2_CALLS = 0
additional work = O(candidates_bound_to_span) string/domain checks
ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = NO
PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = YES
```

Observability (service-internal):

```text
ANCHOR    reason = FULL_SPAN_EXACT_SURFACE_RETAINED_DOMAIN
NON_ANCHOR reason = DOMAIN_SOFT_MISMATCH_ONLY
                 | BASE_FUZZY_SURFACE_ECHO_WITHOUT_DOMAIN
                 | PROFILE_PRONUNCIATION_ONLY
                 | NO_QUALIFYING_CANDIDATE
```

---

## 11. Required Q answers

1. **Legitimate proof:** full-geometry exact surface **and** retained-domain membership on that candidate.  
2. **Cannot independently prove:** PROFILE_DOMAIN soft mismatch; retained membership alone; any PROFILE_* existence; BASE_FUZZY echo; PROFILE_PRONUNCIATION alone.  
3. **PROFILE_DOMAIN:** CONDITIONAL (exact surface only).  
4. **Membership alone:** NO.  
5. **Model2 P alone:** NO.  
6. **Lexical full-span:** CONDITIONAL; CONTRACT_A makes it sufficiency when + domain.  
7. **Coverage available:** surface at adapter (E1); phonetic coverage only upstream (transient).  
8. **Lost:** pinyin_key / transform coverage at materialize.  
9. **Derivable without frozen upstream change:** YES for CONTRACT_A.  
10. **Inside Anchor owner:** YES.  
11. **JobResult change:** NO.  
12. **Architecture change:** NO.

---

## 12. Final verdict

```text
BASELINE_IDENTITY = PASS

FALSE_GROUP_COUNT = 9
CONTROL_GROUP_COUNT = 12
CONTROL_GROUP_VALID = YES

CURRENT_SUFFICIENCY_CONTRACT = ABSENT

RUNTIME_SUFFICIENCY_EVIDENCE_AVAILABLE = PARTIAL

EVIDENCE_LOSS_LOCATION =
candidate-materialize.ts (hit pinyin) +
relation-lexicon-adapter.ts (transform coverage);
adapter surface-equality unused today

PROFILE_DOMAIN_SUFFICIENCY_ROLE = SUPPORT_ONLY / CONDITIONAL(exact surface)
DOMAIN_MEMBERSHIP_SUFFICIENCY_ROLE = SUPPORT_ONLY
MODEL2_PRONUNCIATION_SUFFICIENCY_ROLE = NONE
LEXICAL_EVIDENCE_SUFFICIENCY_ROLE = CONDITIONAL

RECOMMENDED_CONTRACT =
CONTRACT_A FULL_GEOMETRY_EXACT_SURFACE_AND_RETAINED_DOMAIN

FALSE_ANCHOR_REJECTION = 9/9
LEGITIMATE_ANCHOR_PRESERVATION =
0/62 current control anchors demoted as OVERPROTECTED;
exact+domain exemplar preserved when present

CAN_FIX_REMAIN_INSIDE_ANCHOR_OWNER = YES
JOBRESULT_CHANGE_REQUIRED = NO
NEW_MODEL_CALL_REQUIRED = NO
NEW_DB_CALL_REQUIRED = NO

PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = YES
ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = NO
PRODUCT_CODE_CHANGE_THIS_ROUND = NO

ONE_NEXT_OWNER = ANCHOR_EVIDENCE_SUFFICIENCY_OWNER

ONE_NEXT_DELTA =
Replace materializeModel3Anchors predicate
(domainOk OR model2Ok)
with FULL_GEOMETRY_EXACT_SURFACE_AND_RETAINED_DOMAIN
inside model3-anchor-adapter.ts only;
do not change Model2, Domain Vote, FineSpan, Model3, Retry, Stage-2, or JobResult.
```

---

## 13. STOP

Contract audit complete. No product development performed.
