import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = 'd:\\Programs\\github\\lingua_1';
const DIST = path.join(PROJECT_ROOT, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
try {
  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  const runtime = new LexiconRuntimeV2();
  const st = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
  fs.writeFileSync(path.join(PROJECT_ROOT, 'docs/user_correction/model3/_audit_probe.txt'), String(st.status));
  runtime.close?.();
  console.log('OK', st.status);
} catch (e) {
  console.error('FAIL', e);
  process.exit(1);
}
