import json
from pathlib import Path

p = Path("docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/baseline_identity.json")
obj = {
    "freezeId": "FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05",
    "createdAt": "2026-08-05T09:56:00Z",
    "gitCommit": "RESOLVE_FROM_TAG",
    "gitTag": "FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05",
    "previousBaseline": "FW_V4_FREEZE_2026_08_03",
    "workingTreeClean": True,
    "docsCheck": "PASS",
    "dialog200": "INHERITED_BASELINE_200_200_NOT_RERUN",
    "benchmark": "KENLM_BENCHMARK_V1_INHERITED",
    "acceptDomainMultibucketKenlm": "ACCEPTANCE_PASS",
    "unitTestsFreezeRelated": "PASS_122",
    "productionKenlmPath": "kenLM/model/zh_char_3gram.trie.bin",
    "productionKenlmSha256": "532A335A09A006D1BA674F808814EE1D40C5B1D8F3527CA980E96723E7A62A4C",
    "frameworkScope": [
        "Tone",
        "Exact Recall",
        "Lexicon",
        "Domain Vote",
        "SameDomain Bucket",
        "Sentence Assembly",
        "CrossPath",
        "KenLM",
    ],
    "finalVerdict": "FRAMEWORK_FREEZE_COMPLETE",
    "identityNote": "Authoritative commit SHA = git rev-parse <gitTag>. gitCommit=RESOLVE_FROM_TAG avoids self-hash amend loops.",
}
p.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
print("wrote", p)
