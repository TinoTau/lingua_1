import { describe, expect, it } from '@jest/globals';
import {
  LEXICON_INTENT_DEFAULT_MODEL_FILE,
  LEXICON_INTENT_MODEL_DIR_REL,
  getConfiguredLexiconIntentModelPath,
} from './lexicon-intent-model-path';

describe('lexicon-intent-model-path', () => {
  it('defaults to electron-node/models/lexicon-intent canonical file', () => {
    const configured = getConfiguredLexiconIntentModelPath();
    expect(configured.replace(/\\/g, '/')).toContain(
      `${LEXICON_INTENT_MODEL_DIR_REL}/${LEXICON_INTENT_DEFAULT_MODEL_FILE}`.replace(/\\/g, '/')
    );
  });
});
