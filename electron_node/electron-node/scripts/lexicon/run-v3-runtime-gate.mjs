#!/usr/bin/env node
/**
 * Legacy V1 current-bundle gate — disabled under Schema V2 Only.
 */
import { failLegacyLexiconBuild } from './lib/legacy-build-block.mjs';

failLegacyLexiconBuild('lexicon:v3-gate');
