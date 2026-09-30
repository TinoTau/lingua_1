# Single-Char Context Feature Contract V1

Logical contract (Candidate-Set Interface V1, frozen):

`bounded candidates[] + user/context evidence → SELECT / ABSTAIN`

Internal tensors (training/inference of AmbiguityHeadV2 only):

| Field | Shape | Meaning |
|---|---|---|
| left_ids | [B, 4] | left window char-bucket ids, PAD=0 |
| right_ids | [B, 4] | right window |
| cand_char_ids | [B, 8] | shared char-bucket ids for candidate surfaces |
| cand_tone | [B, 8] | tone/5 |
| cand_py_ids | [B, 8] | pinyin hashed buckets |
| cand_mask | [B, 8] | valid slots |

No closed hanzi output vocab. New Operations characters map to existing buckets; output dim stays 9 (ABSTAIN+8).
UserProfile consumed only as existing prepared fields if present; this V2 head does not query DBs or Lexicon.
Fair no-context ablation: PAD left/right, keep candidate tensors.
