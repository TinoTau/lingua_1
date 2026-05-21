import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import {
  getConfigPath,
  getLexiconRecallSelectorConfig,
  isLexiconRecallFeatureEnabled,
  loadNodeConfig,
} from '../node-config';
import { ensureLexiconRuntimeLoaded } from './lexicon-runtime-holder';
import {
  LEXICON_RUNTIME_PROJECT_ROOT_MSG,
  lexiconBundleFileNames,
  requireProjectRootForLexicon,
  resolveLexiconBundleDir,
} from './lexicon-bundle-path';

/** 启动时打印词库配置与 bundle 状态（禁止 silent fallback）。 */
export function logLexiconStartupContract(): void {
  const configPath = getConfigPath();
  let rawLexicon: unknown = null;
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      rawLexicon = parsed?.features?.lexiconRecall ?? null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ configPath, error: message }, '[LEXICON_RUNTIME] failed to read config file');
  }

  const merged = loadNodeConfig().features?.lexiconRecall;
  const selector = getLexiconRecallSelectorConfig();
  const featureEnabled = isLexiconRecallFeatureEnabled();

  console.log('\n[LEXICON_RUNTIME] startup contract');
  console.log(`  configPath: ${configPath}`);
  console.log(`  raw.lexiconRecall: ${JSON.stringify(rawLexicon)}`);
  console.log(`  merged.lexiconRecall: ${JSON.stringify(merged)}`);
  console.log(`  featureEnabled: ${featureEnabled}`);
  console.log(`  selector: maxReplacements=${selector.maxReplacements} minPhoneticScore=${selector.minPhoneticScore}`);
  console.log(`  PROJECT_ROOT: ${process.env.PROJECT_ROOT?.trim() || '(not set)'}`);
  console.log(`  LEXICON_BUNDLE_PATH: ${process.env.LEXICON_BUNDLE_PATH?.trim() || '(not set)'}`);

  if (!featureEnabled) {
    logger.warn(
      { rawLexicon, merged },
      '[LEXICON_RUNTIME] lexiconRecall.enabled is false — LEXICON_RECALL will be skipped'
    );
    return;
  }

  try {
    const projectRoot = requireProjectRootForLexicon();
    const bundleDir = resolveLexiconBundleDir();
    if (!bundleDir) {
      const expected = path.join(projectRoot, 'node_runtime', 'lexicon', 'current');
      logger.error(
        { projectRoot, expected },
        '[LEXICON_RUNTIME] bundle not found under PROJECT_ROOT'
      );
      console.log(`  bundle: MISSING (expected ${expected})`);
      return;
    }

    const files = lexiconBundleFileNames(bundleDir);
    const sqliteStat = fs.existsSync(files.sqlitePath)
      ? fs.statSync(files.sqlitePath)
      : null;

    const state = ensureLexiconRuntimeLoaded();
    console.log(`  bundleDir: ${bundleDir}`);
    console.log(`  sqlite: ${files.sqlitePath} (${sqliteStat?.size ?? 0} bytes)`);
    console.log(`  lexicon_runtime_status: ${state.status}`);
    if (state.manifestVersion) {
      console.log(`  manifestVersion: ${state.manifestVersion}`);
    }
    if (state.errorMessage) {
      console.log(`  error: ${state.errorMessage}`);
    }
    logger.info(
      {
        bundleDir,
        status: state.status,
        manifestVersion: state.manifestVersion,
        sqliteBytes: sqliteStat?.size,
      },
      '[LEXICON_RUNTIME] startup load completed'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === LEXICON_RUNTIME_PROJECT_ROOT_MSG) {
      logger.error({}, LEXICON_RUNTIME_PROJECT_ROOT_MSG);
      console.log(`  ${LEXICON_RUNTIME_PROJECT_ROOT_MSG}`);
    } else {
      logger.error({ error: message }, '[LEXICON_RUNTIME] startup failed');
      console.log(`  error: ${message}`);
    }
  }
  console.log('');
}
