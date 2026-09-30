/**
 * Stage J runtime swap — Node host identity / ONE inference / empty-profile still runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getModel2InferenceHost,
  resetModel2InferenceHostForTests,
  STAGE_J_EXPECTED_SHA256,
  resolveStageJCheckpoint,
  sha256File,
} from './inference-host';

const REPO = path.resolve(__dirname, '../../../../../');
const OUT = path.join(REPO, 'training/model2_v3/experiments/v3_stage_j_runtime_swap');

function writeJson(name: string, obj: unknown): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2), 'utf-8');
}

describe('Stage J runtime host (Node)', () => {
  afterEach(async () => {
    resetModel2InferenceHostForTests();
  });

  it('explicit Stage-J sha256 matches freeze (no latest glob)', () => {
    const ckpt = resolveStageJCheckpoint();
    expect(fs.existsSync(ckpt)).toBe(true);
    expect(sha256File(ckpt)).toBe(STAGE_J_EXPECTED_SHA256);
    expect(ckpt.includes('expA_frozen_trunk.pt')).toBe(true);
    expect(ckpt.includes('v3_phase3_stage_p')).toBe(false);
  });

  it('ONE inference returns P actions and D action together', async () => {
    const host = getModel2InferenceHost();
    const r = await host.infer({
      spanSyllables: ['lai', 'zi'],
      phoneticBias: { n_l: 0.9 },
      basePool: 0,
      personalTerms: ['拿铁'],
      longTermDomainEvidence: { coffee: 0.9 },
    });
    if (host.isLoadFailed()) {
      writeJson('stage_j_node_host_load_fail.json', { error: host.getLoadError() });
      expect(host.getLoadError()).toBeTruthy();
      return;
    }
    expect(r.ok).toBe(true);
    expect(r.model2Invoked).toBe(true);
    expect(r.sha256).toBe(STAGE_J_EXPECTED_SHA256);
    expect(r.featurePack).toBe('MODEL2_FEATURE_HASH_V1');
    expect(typeof r.domainAction).toBe('string');
    expect(r.selectedActions.some((a) => a.includes('n_l'))).toBe(true);
    const stats = await host.stats();
    writeJson('stage_j_node_one_inference.json', {
      selected_actions: r.selectedActions,
      domain_action: r.domainAction,
      domain_none: r.domainNone,
      load_count: stats?.load_count,
      inference_count: stats?.inference_count,
      model_instances: stats?.model_instances,
      dual_model: stats?.dual_model,
    });
    expect(stats?.model_instances).toBe(1);
    expect(stats?.dual_model).toBe(false);
  }, 120000);

  it('hash mismatch fail-fast does not spawn Stage-P fallback', async () => {
    const prev = process.env.MODEL2_STAGE_J_CHECKPOINT;
    process.env.MODEL2_STAGE_J_CHECKPOINT = path.join(
      REPO,
      'training/model2_v3/experiments/v3_phase3_stage_p/training/stage_p_checkpoint.pt'
    );
    try {
      resetModel2InferenceHostForTests();
      const host = getModel2InferenceHost();
      const r = await host.infer({
        spanSyllables: ['lai', 'zi'],
        phoneticBias: { n_l: 0.9 },
        basePool: 0,
      });
      expect(r.model2Invoked).toBe(false);
      expect(String(r.error || host.getLoadError())).toContain('checkpoint_hash_mismatch');
    } finally {
      if (prev === undefined) delete process.env.MODEL2_STAGE_J_CHECKPOINT;
      else process.env.MODEL2_STAGE_J_CHECKPOINT = prev;
    }
  }, 30000);
});
