/**
 * Sealed Model3 checkpoint identities for production + controlled candidate validation.
 *
 * Production / Electron default (no MODEL3_CHECKPOINT_IDENTITY):
 *   MODEL3_V2_S3_RANDOM_INIT_V1
 *
 * Explicit rollback only:
 *   MODEL3_CHECKPOINT_IDENTITY=MODEL3_SYNTHETIC_V1
 *
 * Other candidates require explicit MODEL3_CHECKPOINT_IDENTITY —
 * never by "latest checkpoint" discovery or hash-check bypass.
 * Load failure is FAIL_CLOSED — never silent fallback to another identity.
 *
 * Each entry requires an exact expected weights SHA256 (integrity guard).
 * Config seal: either embedded config.config_hash (V1) or sha256(config.json) (S3+).
 */

export type Model3ConfigHashMode = 'config_field' | 'config_file_sha256';

export type Model3CheckpointIdentity = {
  modelId: string;
  /** Repo-relative checkpoint directory. */
  checkpointDirRelative: string;
  expectedWeightsSha256: string;
  expectedConfigHash: string;
  configHashMode: Model3ConfigHashMode;
  role: 'PRODUCTION' | 'CANDIDATE';
};

/** Production / Electron default identity — MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA 2026-09-08. */
export const MODEL3_PRODUCTION_IDENTITY_ID = 'MODEL3_V2_S3_RANDOM_INIT_V1';

/** Explicit rollback identity (env override only; never silent fallback). */
export const MODEL3_EXPLICIT_ROLLBACK_IDENTITY_ID = 'MODEL3_SYNTHETIC_V1';

export const MODEL3_CHECKPOINT_REGISTRY: Readonly<Record<string, Model3CheckpointIdentity>> = {
  /** AUTHORITATIVE_MODEL_ARTIFACT + RUNTIME_DEFAULT_MODEL */
  MODEL3_V2_S3_RANDOM_INIT_V1: {
    modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
    expectedWeightsSha256:
      'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
    expectedConfigHash: '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221',
    configHashMode: 'config_file_sha256',
    role: 'PRODUCTION',
  },
  /** EXPLICIT_ROLLBACK_MODEL — load only via MODEL3_CHECKPOINT_IDENTITY */
  MODEL3_SYNTHETIC_V1: {
    modelId: 'MODEL3_SYNTHETIC_V1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520',
    expectedWeightsSha256:
      '9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815',
    expectedConfigHash: 'f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830',
    configHashMode: 'config_field',
    role: 'CANDIDATE',
  },
  MODEL3_V2_REALDIST_V1: {
    modelId: 'MODEL3_V2_REALDIST_V1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903',
    expectedWeightsSha256:
      'fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e',
    /** sha256 of config.json (no embedded config_hash field on this candidate). */
    expectedConfigHash: '2a235106436b7a5bf23ab19ba8b55587df8a3bf5dfb874ac0df03c56b3eacfe7',
    configHashMode: 'config_file_sha256',
    role: 'CANDIDATE',
  },
  /** A1 class-weight — REJECTED_NON_PROMOTED; audit candidate only. */
  MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1: {
    modelId: 'MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v2_s3_exp_class_weight_a1_rerun1/seed_2026083013',
    expectedWeightsSha256:
      '2d1c763249d5fca5c7586ea41868e391cc70e495069b5bab5f2e5905982e1bd0',
    expectedConfigHash: 'e52a4c97b6e6187030c4211288d3d4cd5a814483660c62f51ba73b016a454cbe',
    configHashMode: 'config_file_sha256',
    role: 'CANDIDATE',
  },
} as const;

export function resolveModel3CheckpointIdentityId(): string {
  const raw = process.env.MODEL3_CHECKPOINT_IDENTITY?.trim();
  if (!raw) return MODEL3_PRODUCTION_IDENTITY_ID;
  return raw;
}

export function getModel3CheckpointIdentity(
  identityId: string = resolveModel3CheckpointIdentityId()
): Model3CheckpointIdentity {
  const entry = MODEL3_CHECKPOINT_REGISTRY[identityId];
  if (!entry) {
    throw new Error(
      `unknown_model3_checkpoint_identity:${identityId}:known=${Object.keys(MODEL3_CHECKPOINT_REGISTRY).join(',')}`
    );
  }
  return entry;
}
