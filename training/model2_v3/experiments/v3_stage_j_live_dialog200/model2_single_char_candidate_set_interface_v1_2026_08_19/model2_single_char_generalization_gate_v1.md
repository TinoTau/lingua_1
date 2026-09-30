# Generalization gates V1 (future training — not run)

Must pass before any production ambiguity weights:

1. Held-out characters
2. Held-out candidate combinations
3. Held-out sentence contexts
4. Candidate-order permutation (same lexical choice)
5. Unseen lexical members (ops add a word without retrain)
6. Empty profile / empty domain
7. Stage P RR (freeze ≥0.945 vs P1) and Stage D modest D metrics — no unfrozen-trunk joint by default

dialog_200 is evaluation only. Never train on it.
