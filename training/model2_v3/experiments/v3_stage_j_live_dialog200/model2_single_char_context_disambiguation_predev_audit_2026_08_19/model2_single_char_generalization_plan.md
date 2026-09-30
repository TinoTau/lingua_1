# Generalization plan (future training — not executed)

If Model2 memorizes fixed characters or dialog_200 utterances: **FAIL**.

## Must prove after any train

1. **Held-out characters:** candidate surfaces never seen in train still selectable when they appear in a set + supporting context.
2. **Held-out combinations:** train saw {A,B} not {A,C}; {A,C} still works.
3. **Held-out contexts:** same set, new sentences.
4. **Empty profile / empty domain:** no collapse to first index or frequency.
5. **Ops vocabulary churn:** add/remove a lexicon row without retrain; only set membership changes.

## Representation requirement

Features = candidate-relative (index, hashed surface, pinyin+tone, optional prior as **feature not gate**).  
Output classes = `ABSTAIN, C0, C1, … C_{K-1}` with K = cap (8), **not** a closed hanzi inventory.

If a proposed design adds an output class per new character: **ARCHITECTURE_NOT_ACCEPTABLE**.

## dialog_200

Evaluation / counterfactual only. Never hard-mine, never special-case, never leakage into train.
