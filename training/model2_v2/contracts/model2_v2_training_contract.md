# Model2 V2 Training Contract

## Objective

Learn **relation / expansion activation** for a FineSpan given UserProfile.

```text
model(span_features, profile_features) → activation scores over relations
→ bounded reverse-map queries
→ lexicon retrieval (outside the neural net)
```

## Labels (training only)

- Positive relation(s) that apply to observed syllables and recover absent target (oracle for label construction only)
- Empty / Wrong / Swapped counterfactual rows

## Forbidden features

- `target_term_id`, canonical target pinyin as query, oracle family as input feature

## Capacity

- Prefer &lt; 500k parameters; CPU inference

## Checkpoints

- Namespace: `model2_v2_recall_*`
- Must never load `stage_a_baseline_v1` / `stage_b_baseline_v1`
