# Single-char invocation option matrix

Failed checkpoint `retrieval_policy_v3_single_char_ambiguity_v1.pt` is **out of** the performance plan. Transport design assumes frozen P/D sidecar + future accepted ambiguity weights.

| | A per-span extra IPC | B utterance/path batch | C merge into existing P/D infer | D reuse encode() h |
|---|---|---|---|---|
| Architecture change | extra `disambiguate` in span loop | collect N>1; one `disambiguateBatch` | change frozen `infer` JSON | couple heads on `h` |
| Code complexity | LOW | LOW–MEDIUM | MEDIUM | MEDIUM |
| Runtime complexity | HIGH (IPC storm) | LOW | MEDIUM | MEDIUM |
| Additional IPC | ~5/utt proxy (1046/200 windows); stacks on existing 20 | 0 or 1 | 0 | 0 |
| Additional forward | same as IPC | 1 (or tiny batch inside one IPC) | 0 extra forward if piggyback | 0 |
| Latency risk | HIGH | LOW | LOW | LOW |
| P/D regression | LOW | LOW | MEDIUM (infer contract) | MEDIUM |
| Candidate contract | KEEP | KEEP + `requests[]` transport | KEEP but pollutes infer | KEEP |
| Maintenance | HIGH | LOW | HIGH | HIGH |
| Verdict | **REJECT** | **ACCEPT (recommended)** | **NOT_WORTH_COMPLEXITY** | **REJECT** (h lacks Han context) |

Stage 1 froze existing `infer` JSON. Option C would reopen that surface for a head that already failed HEAD_ONLY_INSUFFICIENT.

Existing P/D is already per-span (~20 IPC). Do **not** rewrite that lifecycle to force “one inference per utterance” just to attach single-char.
