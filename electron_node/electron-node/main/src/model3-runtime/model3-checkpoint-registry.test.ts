/**
 * MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA — identity selection contract.
 */

import {
  MODEL3_CHECKPOINT_REGISTRY,
  MODEL3_EXPLICIT_ROLLBACK_IDENTITY_ID,
  MODEL3_PRODUCTION_IDENTITY_ID,
  getModel3CheckpointIdentity,
  resolveModel3CheckpointIdentityId,
} from './model3-checkpoint-registry';
import {
  MODEL3_EXPECTED_CONFIG_HASH,
  MODEL3_EXPECTED_WEIGHTS_SHA256,
} from './model3-types';

describe('model3-checkpoint-registry — runtime default promotion', () => {
  const prev = process.env.MODEL3_CHECKPOINT_IDENTITY;

  afterEach(() => {
    if (prev === undefined) delete process.env.MODEL3_CHECKPOINT_IDENTITY;
    else process.env.MODEL3_CHECKPOINT_IDENTITY = prev;
  });

  it('no-env default is MODEL3_V2_S3_RANDOM_INIT_V1', () => {
    delete process.env.MODEL3_CHECKPOINT_IDENTITY;
    expect(MODEL3_PRODUCTION_IDENTITY_ID).toBe('MODEL3_V2_S3_RANDOM_INIT_V1');
    expect(resolveModel3CheckpointIdentityId()).toBe('MODEL3_V2_S3_RANDOM_INIT_V1');
    const id = getModel3CheckpointIdentity();
    expect(id.modelId).toBe('MODEL3_V2_S3_RANDOM_INIT_V1');
    expect(id.role).toBe('PRODUCTION');
    expect(id.expectedWeightsSha256).toBe(
      'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1'
    );
    expect(id.expectedConfigHash).toBe(
      '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221'
    );
    expect(id.configHashMode).toBe('config_file_sha256');
  });

  it('explicit rollback MODEL3_SYNTHETIC_V1 remains loadable', () => {
    process.env.MODEL3_CHECKPOINT_IDENTITY = MODEL3_EXPLICIT_ROLLBACK_IDENTITY_ID;
    expect(resolveModel3CheckpointIdentityId()).toBe('MODEL3_SYNTHETIC_V1');
    const id = getModel3CheckpointIdentity();
    expect(id.modelId).toBe('MODEL3_SYNTHETIC_V1');
    expect(id.role).toBe('CANDIDATE');
  });

  it('invalid identity fail-closed (throws)', () => {
    process.env.MODEL3_CHECKPOINT_IDENTITY = 'INVALID_MODEL3_IDENTITY';
    expect(() => getModel3CheckpointIdentity()).toThrow(/unknown_model3_checkpoint_identity/);
  });

  it('production seal constants match registry S3 entry', () => {
    const s3 = MODEL3_CHECKPOINT_REGISTRY.MODEL3_V2_S3_RANDOM_INIT_V1;
    expect(MODEL3_EXPECTED_WEIGHTS_SHA256).toBe(s3.expectedWeightsSha256);
    expect(MODEL3_EXPECTED_CONFIG_HASH).toBe(s3.expectedConfigHash);
  });

  it('A1 remains non-promoted candidate', () => {
    expect(MODEL3_CHECKPOINT_REGISTRY.MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1.role).toBe(
      'CANDIDATE'
    );
    expect(MODEL3_PRODUCTION_IDENTITY_ID).not.toBe(
      'MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1'
    );
  });
});
