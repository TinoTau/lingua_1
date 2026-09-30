# -*- coding: utf-8 -*-
"""Model3 checkpoint ↔ dataset identity guard (G0).

Fail-closed. Must run BEFORE any training-shard sample load for S3
causality / generalization audits.

Uses existing checkpoint config + sidecar manifests + dataset_manifest.json.
Does NOT create a registry/service/DB.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]

# Frozen authoritative S3 binding (also verified from on-disk metadata).
AUTHORITATIVE_S3 = {
    "modelId": "MODEL3_V2_S3_RANDOM_INIT_V1",
    "weightsSha256": "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1",
    "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
    "datasetBuildId": "prod_core_s3_build_20260830_v1",
    "featureContract": "packModel3SpanInferFields",
    "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
    "checkpointDir": REPO
    / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013",
    "datasetRoot": REPO / "training/model3_dataset/model3_v2_production_core_s3",
}

NOT_AUTHORITATIVE_FOR_S3 = frozenset(
    {
        "MODEL3_V2_LABELED",
        "model3_v2_labeled",
        "MODEL3_V2_REALDIST_EXPANDED_V1",
        "model3_v2_realdist_expanded_v1",
        "model3_v2_realdist",
    }
)


class Model3DatasetIdentityError(Exception):
    """Hard-stop identity / provenance failure."""

    def __init__(self, code: str, detail: str = "", **fields: Any):
        self.code = code
        self.detail = detail
        self.fields = fields
        parts = [code]
        if detail:
            parts.append(detail)
        for k, v in fields.items():
            parts.append(f"{k}={v}")
        super().__init__(":".join(str(p) for p in parts))


@dataclass(frozen=True)
class Model3DatasetIdentity:
    modelId: str
    weightsSha256: str
    datasetId: str
    datasetBuildId: str
    featureContract: str
    labelContractVersion: str
    checkpointDir: str
    datasetRoot: str
    trainDir: str
    devDir: str
    testDir: str
    datasetManifestPath: str
    checkpointManifestPath: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().lower()


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_MANIFEST_MISSING",
            f"missing_json:{path}",
            path=str(path),
        )
    return json.loads(path.read_text(encoding="utf-8"))


def load_checkpoint_provenance(checkpoint_dir: Path) -> dict[str, Any]:
    """Load identity fields from checkpoint config + optional sidecar hashes."""
    checkpoint_dir = Path(checkpoint_dir)
    if not checkpoint_dir.is_dir():
        raise Model3DatasetIdentityError(
            "MODEL3_CHECKPOINT_PROVENANCE_INCOMPLETE",
            "checkpoint_dir_missing",
            checkpointDir=str(checkpoint_dir),
        )
    cfg_path = checkpoint_dir / "config.json"
    cfg = _read_json(cfg_path)
    weights = checkpoint_dir / "weights.pt"
    if not weights.is_file():
        raise Model3DatasetIdentityError(
            "MODEL3_CHECKPOINT_PROVENANCE_INCOMPLETE",
            "weights_missing",
            checkpointDir=str(checkpoint_dir),
        )
    weights_sha = file_sha256(weights)

    # Sidecar bindings (docs + local training_metrics) — must agree if present.
    hashes: list[tuple[str, str]] = [("weights.pt", weights_sha)]
    metrics = checkpoint_dir / "training_metrics.json"
    if metrics.is_file():
        m = json.loads(metrics.read_text(encoding="utf-8"))
        if m.get("weightsSha256"):
            hashes.append(("training_metrics.json", str(m["weightsSha256"]).lower()))
    docs_manifest = REPO / "docs/user_correction/model3/model3_v2_s3_checkpoint_manifest.json"
    if docs_manifest.is_file():
        dm = json.loads(docs_manifest.read_text(encoding="utf-8"))
        if dm.get("weightsSha256"):
            hashes.append(("s3_checkpoint_manifest.json", str(dm["weightsSha256"]).lower()))
        # If docs bind a different model/checkpoint dir, still compare hash only when same modelId
        if dm.get("modelId") and cfg.get("modelId") and dm["modelId"] != cfg.get("modelId"):
            raise Model3DatasetIdentityError(
                "MODEL3_DATASET_IDENTITY_MISMATCH",
                "docs_manifest_modelId_mismatch",
                expected_modelId=cfg.get("modelId"),
                actual_modelId=dm.get("modelId"),
            )

    uniq = {h for _, h in hashes}
    if len(uniq) > 1:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_IDENTITY_MISMATCH",
            "weightsSha256_sidecar_disagreement",
            hashes=";".join(f"{n}={h}" for n, h in hashes),
        )

    required = ("modelId", "datasetId", "datasetBuildId")
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        raise Model3DatasetIdentityError(
            "MODEL3_CHECKPOINT_PROVENANCE_INCOMPLETE",
            "config_missing_fields",
            missing=",".join(missing),
            checkpointDir=str(checkpoint_dir),
        )

    feature = cfg.get("featureContract") or cfg.get("featureContractIdentity")
    label = cfg.get("labelContractVersion") or cfg.get("labelContractIdentity")
    if not feature or not label:
        raise Model3DatasetIdentityError(
            "MODEL3_CHECKPOINT_PROVENANCE_INCOMPLETE",
            "config_missing_contracts",
            featureContract=feature,
            labelContractVersion=label,
        )

    return {
        "modelId": cfg["modelId"],
        "datasetId": cfg["datasetId"],
        "datasetBuildId": cfg["datasetBuildId"],
        "featureContract": feature,
        "labelContractVersion": label,
        "weightsSha256": weights_sha,
        "seed": cfg.get("seed"),
        "checkpointDir": str(checkpoint_dir.resolve()),
        "configPath": str(cfg_path.resolve()),
    }


def resolve_dataset_root(dataset_id: str, repo: Path = REPO) -> Path:
    """Map datasetId → on-disk root. No latest/newest discovery."""
    mapping = {
        "MODEL3_V2_PRODUCTION_CORE_S3": repo / "training/model3_dataset/model3_v2_production_core_s3",
        "MODEL3_V2_PRODUCTION_CORE_S2": repo / "training/model3_dataset/model3_v2_production_core_s2",
        "MODEL3_V2_PRODUCTION_CORE_S1": repo / "training/model3_dataset/model3_v2_production_core_s1",
    }
    if dataset_id not in mapping:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_IDENTITY_MISMATCH",
            "unknown_datasetId_mapping",
            datasetId=dataset_id,
        )
    root = mapping[dataset_id]
    if not root.is_dir():
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_MANIFEST_MISSING",
            "dataset_root_missing",
            datasetId=dataset_id,
            dataset_path=str(root),
        )
    return root


def load_dataset_manifest(dataset_root: Path) -> dict[str, Any]:
    path = Path(dataset_root) / "dataset_manifest.json"
    if not path.is_file():
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_MANIFEST_MISSING",
            "dataset_manifest.json_absent",
            dataset_path=str(dataset_root),
        )
    man = _read_json(path)
    if not man.get("datasetId") or not man.get("datasetBuildId"):
        raise Model3DatasetIdentityError(
            "MODEL3_CHECKPOINT_PROVENANCE_INCOMPLETE",
            "manifest_missing_identity_fields",
            dataset_path=str(dataset_root),
        )
    return man


def _norm_contract(value: str | None) -> str:
    return (value or "").strip()


def assert_model3_dataset_identity(
    *,
    checkpoint_dir: Path | str | None = None,
    dataset_path: Path | str | None = None,
    expected_model_id: str | None = None,
    expected_dataset_id: str | None = None,
    expected_dataset_build_id: str | None = None,
    expected_feature_contract: str | None = None,
    expected_label_contract: str | None = None,
    expected_weights_sha256: str | None = None,
    require_authoritative_s3: bool = False,
) -> Model3DatasetIdentity:
    """Assert checkpoint provenance matches dataset manifest BEFORE sample load.

    ``dataset_path`` if provided must still match checkpoint-bound identity;
    it cannot override or bypass G0.
    """
    ckpt = Path(checkpoint_dir) if checkpoint_dir else AUTHORITATIVE_S3["checkpointDir"]
    prov = load_checkpoint_provenance(ckpt)

    # Defaults: when require_authoritative_s3, freeze to known S3 binding.
    exp_model = expected_model_id or (
        AUTHORITATIVE_S3["modelId"] if require_authoritative_s3 else prov["modelId"]
    )
    exp_ds = expected_dataset_id or (
        AUTHORITATIVE_S3["datasetId"] if require_authoritative_s3 else prov["datasetId"]
    )
    exp_build = expected_dataset_build_id or (
        AUTHORITATIVE_S3["datasetBuildId"] if require_authoritative_s3 else prov["datasetBuildId"]
    )
    exp_feat = expected_feature_contract or (
        AUTHORITATIVE_S3["featureContract"] if require_authoritative_s3 else prov["featureContract"]
    )
    exp_label = expected_label_contract or (
        AUTHORITATIVE_S3["labelContractVersion"]
        if require_authoritative_s3
        else prov["labelContractVersion"]
    )
    exp_sha = (expected_weights_sha256 or AUTHORITATIVE_S3["weightsSha256"]).lower()

    if require_authoritative_s3 or expected_weights_sha256:
        if prov["weightsSha256"] != exp_sha:
            raise Model3DatasetIdentityError(
                "MODEL3_DATASET_IDENTITY_MISMATCH",
                "weightsSha256_mismatch",
                expected_weightsSha256=exp_sha,
                actual_weightsSha256=prov["weightsSha256"],
            )

    if prov["modelId"] != exp_model:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_IDENTITY_MISMATCH",
            "modelId_mismatch",
            expected_modelId=exp_model,
            actual_modelId=prov["modelId"],
        )
    if prov["datasetId"] != exp_ds:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_IDENTITY_MISMATCH",
            "checkpoint_datasetId_mismatch",
            expected_datasetId=exp_ds,
            actual_datasetId=prov["datasetId"],
        )
    if prov["datasetBuildId"] != exp_build:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_BUILD_MISMATCH",
            "checkpoint_datasetBuildId_mismatch",
            expected_datasetBuildId=exp_build,
            actual_datasetBuildId=prov["datasetBuildId"],
        )
    if _norm_contract(prov["featureContract"]) != _norm_contract(exp_feat):
        raise Model3DatasetIdentityError(
            "MODEL3_FEATURE_CONTRACT_MISMATCH",
            "feature_contract_mismatch",
            expected_featureContract=exp_feat,
            actual_featureContract=prov["featureContract"],
        )
    if _norm_contract(prov["labelContractVersion"]) != _norm_contract(exp_label):
        raise Model3DatasetIdentityError(
            "MODEL3_LABEL_CONTRACT_MISMATCH",
            "label_contract_mismatch",
            expected_labelContractVersion=exp_label,
            actual_labelContractVersion=prov["labelContractVersion"],
        )

    # Resolve authoritative root from checkpoint datasetId (not directory discovery).
    root = resolve_dataset_root(prov["datasetId"])
    man = load_dataset_manifest(root)

    if man.get("datasetId") != exp_ds:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_IDENTITY_MISMATCH",
            "manifest_datasetId_mismatch",
            expected_datasetId=exp_ds,
            actual_datasetId=man.get("datasetId"),
            dataset_path=str(root),
        )
    if man.get("datasetBuildId") != exp_build:
        raise Model3DatasetIdentityError(
            "MODEL3_DATASET_BUILD_MISMATCH",
            "manifest_datasetBuildId_mismatch",
            expected_datasetBuildId=exp_build,
            actual_datasetBuildId=man.get("datasetBuildId"),
            dataset_path=str(root),
        )

    man_feat = man.get("featureContractIdentity") or man.get("featureContract")
    man_label = man.get("labelContractIdentity") or man.get("labelContractVersion")
    if man_feat and _norm_contract(man_feat) != _norm_contract(exp_feat):
        raise Model3DatasetIdentityError(
            "MODEL3_FEATURE_CONTRACT_MISMATCH",
            "manifest_feature_contract_mismatch",
            expected_featureContract=exp_feat,
            actual_featureContract=man_feat,
            dataset_path=str(root),
        )
    if man_label and _norm_contract(man_label) != _norm_contract(exp_label):
        raise Model3DatasetIdentityError(
            "MODEL3_LABEL_CONTRACT_MISMATCH",
            "manifest_label_contract_mismatch",
            expected_labelContractVersion=exp_label,
            actual_labelContractVersion=man_label,
            dataset_path=str(root),
        )

    # Explicit path cannot override identity.
    if dataset_path is not None:
        provided = Path(dataset_path).resolve()
        # Accept dataset root or a split subdir (…/train).
        allowed = {root.resolve(), (root / "train").resolve(), (root / "dev").resolve(), (root / "test").resolve()}
        if provided not in allowed and root.resolve() not in provided.parents and provided != root.resolve():
            # Also reject if path points into a known non-authoritative tree while requiring S3.
            path_s = str(provided).replace("\\", "/")
            for bad in NOT_AUTHORITATIVE_FOR_S3:
                if bad in path_s:
                    raise Model3DatasetIdentityError(
                        "MODEL3_DATASET_IDENTITY_MISMATCH",
                        "explicit_path_not_authoritative_for_s3",
                        expected_datasetId=exp_ds,
                        expected_datasetBuildId=exp_build,
                        actual_datasetId=bad,
                        actual_datasetBuildId="N/A",
                        dataset_path=str(provided),
                    )
            raise Model3DatasetIdentityError(
                "MODEL3_DATASET_IDENTITY_MISMATCH",
                "explicit_path_does_not_match_checkpoint_dataset",
                expected_datasetId=exp_ds,
                expected_datasetBuildId=exp_build,
                actual_datasetId=prov["datasetId"],
                actual_datasetBuildId=prov["datasetBuildId"],
                dataset_path=str(provided),
                expected_dataset_path=str(root),
            )

    for split in ("train", "dev", "test"):
        split_dir = root / split
        if not split_dir.is_dir():
            raise Model3DatasetIdentityError(
                "MODEL3_DATASET_MANIFEST_MISSING",
                f"split_dir_missing:{split}",
                dataset_path=str(root),
            )
        if not any(split_dir.glob("shard-*.jsonl")):
            raise Model3DatasetIdentityError(
                "MODEL3_DATASET_MANIFEST_MISSING",
                f"split_shards_missing:{split}",
                dataset_path=str(root),
            )

    docs_ckpt = REPO / "docs/user_correction/model3/model3_v2_s3_checkpoint_manifest.json"
    return Model3DatasetIdentity(
        modelId=prov["modelId"],
        weightsSha256=prov["weightsSha256"],
        datasetId=exp_ds,
        datasetBuildId=exp_build,
        featureContract=exp_feat,
        labelContractVersion=exp_label,
        checkpointDir=str(Path(ckpt).resolve()),
        datasetRoot=str(root.resolve()),
        trainDir=str((root / "train").resolve()),
        devDir=str((root / "dev").resolve()),
        testDir=str((root / "test").resolve()),
        datasetManifestPath=str((root / "dataset_manifest.json").resolve()),
        checkpointManifestPath=str(docs_ckpt.resolve()) if docs_ckpt.is_file() else "",
    )


def assert_authoritative_s3_identity(
    dataset_path: Path | str | None = None,
) -> Model3DatasetIdentity:
    """Convenience: bind current frozen S3 checkpoint to production_core_s3."""
    return assert_model3_dataset_identity(
        checkpoint_dir=AUTHORITATIVE_S3["checkpointDir"],
        dataset_path=dataset_path,
        require_authoritative_s3=True,
    )


# CLI for Node / shell smoke: prints JSON identity or exits non-zero.
def _cli() -> int:
    import argparse
    import sys

    p = argparse.ArgumentParser(description="Model3 G0 dataset identity assert")
    p.add_argument("--checkpoint-dir", default=str(AUTHORITATIVE_S3["checkpointDir"]))
    p.add_argument("--dataset-path", default=None)
    p.add_argument("--require-authoritative-s3", action="store_true")
    p.add_argument("--expected-dataset-id", default=None)
    p.add_argument("--expected-dataset-build-id", default=None)
    p.add_argument("--expected-feature-contract", default=None)
    p.add_argument("--expected-label-contract", default=None)
    p.add_argument("--expected-model-id", default=None)
    p.add_argument("--expected-weights-sha256", default=None)
    args = p.parse_args()
    try:
        ident = assert_model3_dataset_identity(
            checkpoint_dir=args.checkpoint_dir,
            dataset_path=args.dataset_path,
            expected_model_id=args.expected_model_id,
            expected_dataset_id=args.expected_dataset_id,
            expected_dataset_build_id=args.expected_dataset_build_id,
            expected_feature_contract=args.expected_feature_contract,
            expected_label_contract=args.expected_label_contract,
            expected_weights_sha256=args.expected_weights_sha256,
            require_authoritative_s3=args.require_authoritative_s3,
        )
        print(json.dumps({"ok": True, "identity": ident.to_dict()}, ensure_ascii=False, indent=2))
        return 0
    except Model3DatasetIdentityError as e:
        print(
            json.dumps(
                {"ok": False, "code": e.code, "detail": e.detail, "fields": e.fields, "error": str(e)},
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(_cli())
