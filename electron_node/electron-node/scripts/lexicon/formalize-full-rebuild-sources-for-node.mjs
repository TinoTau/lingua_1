#!/usr/bin/env node
/**
 * Formalize sources then remind: NOT seed shadow.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'lexicon', 'formalize-full-rebuild-sources.mjs');
runCmd(process.execPath, [script], { cwd: root, label: 'formalize full-rebuild sources' });
