# model.py single-char delta

File: `training/model2_v3/policy/model.py`  
Stage J freeze inventory: **KEEP** (no architecture change).  
Candidate-Set inventory: **modify**.  
Context V2 inventory: `optional ambiguity_version=v2`.

## `__init__`

Additive kwargs only:

- `with_ambiguity_head: bool = False`
- `ambiguity_version: str = "v1"`

When False (production / host): `ambiguity_head = None`. Param count remains 47210. Matches host `RetrievalPolicyV3(with_domain_head=True)`.

When True: registers `AmbiguityHeadV1` or `AmbiguityHeadV2` (encoder nested in V2). Not used by sidecar load.

Change class: **ADDITIVE** / **LOCAL_BRANCH**. Not P/D structural overwrite.

## `encode` / `forward`

No single-char tensors. `forward` keys unchanged. Encoder output does not enter trunk (V2 isolation tests + reports).

## Checkpoint loading

Default construction still strict-loads expA. Optional head uses `strict=False` only in experiment scripts/tests.

## Parameter registration

Default: identical to Stage J (47210). Optional modules only if flag True.

## Architecture version

Host still labels `RetrievalPolicyV3`. Extra load-metadata keys `with_ambiguity_head` / `ambiguity_contract` are sidecar JSON additives, not weight-file fields.

## Restore method (no git)

Delete the two kwargs, the `if with_ambiguity_head` block, and related attributes. Leave trunk/P/D blocks untouched. Restore source **E** (precise reverse of additive delta). Confidence **HIGH**.
