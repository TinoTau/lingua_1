# Model2 single-char training feasibility

## Can the same model learn this?

**YES — SAME_MODEL_EXTEND_TRAINING**, with a **new bounded select/abstain head**, not by overloading `action_head`.

### Why existing heads are insufficient (Option B rejected)

`action_head` (50) = identity + 7 phonetic singles + 42 composed pairs.  
`domain_action_head` (13) = domain_none + 12 slots.

Neither is “candidate_i among a supplied lexical set”. Reusing them would mix pronunciation/domain retrieval with character choice → **ARCHITECTURE_NOT_ACCEPTABLE**.

### Why a second model is not required (Option C rejected)

Stage D already proved: same trunk + extra head (`domain_action_head`) + frozen-trunk joint (Stage J expA) can add a task without a second ONNX/runtime. Pattern reuse:

- Keep `RetrievalPolicyV3` one module, one sidecar, one `infer`.
- Add `ambiguity_head` (N_MAX+1 including ABSTAIN) consuming frozen `h` plus **candidate-relative** features.
- Invoke only when length==1 and N>1.
- Do **not** change `in_dim` of the existing trunk (SPAN 64 + PROFILE 64 + STATE 12). Changing trunk width would break the frozen 47210-param checkpoint shape and is **MAJOR**.

Smallest compatible design:

1. Existing `encode()` unchanged → `h` (128).
2. New candidate encoder (hashed surface / pinyin / tone / index positional) → matrix.
3. Score `dot(h, cand_i)` or small MLP; extra logit ABSTAIN.
4. Train new params; freeze trunk + P/D heads first (Stage J expA lesson).

### Feature contract

Do not silently mutate `MODEL2_FEATURE_HASH_V1` packing for P/D. New tensors are additional. P/D `pack_batch_inputs` stays bit-compatible.

Left/right context: hash slices of existing `rawText` into candidate scoring path — **reuse**, no new context service.

### Interference

**MEDIUM** if trunk is unfrozen (Stage J unfrozen-trunk joint dropped P RR 0.955→0.902).  
**LOW–MEDIUM** if trunk frozen and only new head trained.

Regression surfaces: Stage P RR, held-out P, Stage D val Top1 / TIR, dialog_200 NO_PROFILE expansion, empty-profile `domain_none` behavior.
