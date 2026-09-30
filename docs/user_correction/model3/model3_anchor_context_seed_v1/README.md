# MODEL3_ANCHOR_CONTEXT_SEED_V1

Candidate seed corpus for the full ~100k Model3 V1 Anchor-dependent dataset.

Hard rules:
- NOT MODEL3_TRAINING_SAMPLE_V1.
- intendedRole is generation intent only, never an authoritative KEEP/RETRY label.
- Final labels must be materialized by the existing Stage2 / production-equivalent Recall path.
- RETRY candidates must be rejected unless referenceReachable=YES.
- anchorCandidateSurface is only a training-construction hint. It is not a new runtime Anchor source.
- Formal runtime Anchor sources remain DOMAIN / MODEL2 / DOMAIN_AND_MODEL2.
- Do not expose intendedRole, referenceSurface, generation provenance, or reachability to model tensors.
- This corpus supplements anchor/context diversity, strong contrast pairs, hard KEEP cases, and no-anchor controls.
