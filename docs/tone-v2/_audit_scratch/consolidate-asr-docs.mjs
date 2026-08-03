/**
 * ASR Post-Processing documentation consolidation (docs only).
 * Moves Acceptance/Archive files; writes CURRENT/SUPPORTING indexes.
 * Does not modify code, lexicon, or freeze identity.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const tone = path.join(repo, 'docs/tone-v2');

const dirs = {
  current: path.join(repo, 'docs/current'),
  supporting: path.join(repo, 'docs/supporting'),
  acceptanceDev: path.join(repo, 'docs/acceptance/Development'),
  acceptanceTest: path.join(repo, 'docs/acceptance/Test'),
  acceptanceFreeze: path.join(repo, 'docs/acceptance/Freeze'),
  acceptanceRegression: path.join(repo, 'docs/acceptance/Regression'),
  archiveRetired: path.join(repo, 'docs/archive/RETIRED'),
  archiveSuperseded: path.join(repo, 'docs/archive/SUPERSEDED'),
  archiveExperiment: path.join(repo, 'docs/archive/EXPERIMENT'),
  archiveHistorical: path.join(repo, 'docs/archive/HISTORICAL'),
};

for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

/** Sole Authorities / CURRENT — stay in place; only catalogued */
const CURRENT_KEEP = new Set([
  'RUNTIME_DOMAIN_DOCUMENT_INDEX.md',
  'FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md',
  'Runtime_SSOT_Contract_Freeze.md',
  'FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md',
  'FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md',
  'FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md',
  'Lexicon_Domain_Contract_Freeze_V1.md',
  'Lingua_Runtime_Evolution_Rule.md',
  'FRAMEWORK_FREEZE_SUMMARY.md',
  'TONE_V2_CONTRACT_FREEZE.md',
]);

function classifyToneFile(name) {
  if (!name.endsWith('.md')) return null;
  if (CURRENT_KEEP.has(name)) return { kind: 'CURRENT_STAY' };
  if (/Code_and_Documentation_Freeze_Report|Documentation_Consolidation/i.test(name)) {
    return { kind: 'ACCEPTANCE', sub: 'Freeze', status: 'ACCEPTANCE_RECORD' };
  }
  if (/_Test_Report_|Test_Report_/i.test(name)) {
    return { kind: 'ACCEPTANCE', sub: 'Test', status: 'ACCEPTANCE_RECORD' };
  }
  if (/_Development_Report_|Development_Report_/i.test(name)) {
    return { kind: 'ACCEPTANCE', sub: 'Development', status: 'ACCEPTANCE_RECORD' };
  }
  if (/Acceptance|Regression|Quality_Performance_Acceptance/i.test(name)) {
    return { kind: 'ACCEPTANCE', sub: 'Regression', status: 'ACCEPTANCE_RECORD' };
  }
  if (/LTR|parent_fragment|Parent_Fragment|SoftBoundary|phraseCandidates|term_pinyin/i.test(name)) {
    return {
      kind: 'ARCHIVE',
      sub: 'RETIRED',
      status: 'RETIRED',
      supersededBy: 'FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0',
    };
  }
  if (/PreDevelopment|Pre_Development|Proposal|Supplement_2026|Delete_Replace_Matrix|Interface_Data_Contract_Draft/i.test(name)) {
    return {
      kind: 'ARCHIVE',
      sub: 'SUPERSEDED',
      status: 'SUPERSEDED',
      supersededBy: 'CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03',
    };
  }
  if (/Audit|Experiment|Probe|Necessity|Readiness_Audit|Reconciliation|Inventory/i.test(name)) {
    return {
      kind: 'ARCHIVE',
      sub: 'HISTORICAL',
      status: 'HISTORICAL',
      supersededBy: 'CURRENT SSOT + Acceptance Records',
    };
  }
  if (/Development_Plan|Document_Supersession/i.test(name)) {
    return {
      kind: 'ARCHIVE',
      sub: 'HISTORICAL',
      status: 'HISTORICAL',
      supersededBy: 'CURRENT SSOT',
    };
  }
  // leftover tone-v2 markdown → historical archive
  return {
    kind: 'ARCHIVE',
    sub: 'HISTORICAL',
    status: 'HISTORICAL',
    supersededBy: 'docs/current/INDEX.md',
  };
}

function prependArchiveMeta(filePath, meta) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (text.includes('Status: **') && text.includes('Documentation Hierarchy')) return;
  const block = `<!-- Documentation Hierarchy Metadata
Status: **${meta.status}**
Superseded By: ${meta.supersededBy || 'N/A'}
Archive Path: ${path.relative(repo, filePath).replace(/\\/g, '/')}
-->

> **${meta.status}** — 非 CURRENT。阅读顺序：Framework Snapshot → \`docs/current/\` → Supporting → Acceptance → Archive。  
> Superseded By: ${meta.supersededBy || 'N/A'}

`;
  fs.writeFileSync(filePath, block + text, 'utf8');
}

function gitMv(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    execSync(`git mv -f -- "${from}" "${to}"`, { cwd: repo, stdio: 'pipe' });
  } catch {
    fs.renameSync(from, to);
  }
}

const migration = { acceptance: [], archive: [], stayedCurrent: [], skipped: [] };

const toneFiles = fs.readdirSync(tone).filter((f) => f.endsWith('.md'));
for (const name of toneFiles) {
  const cls = classifyToneFile(name);
  if (!cls) continue;
  const from = path.join(tone, name);
  if (cls.kind === 'CURRENT_STAY') {
    migration.stayedCurrent.push(name);
    continue;
  }
  if (cls.kind === 'ACCEPTANCE') {
    const destDir =
      cls.sub === 'Test'
        ? dirs.acceptanceTest
        : cls.sub === 'Freeze'
          ? dirs.acceptanceFreeze
          : cls.sub === 'Regression'
            ? dirs.acceptanceRegression
            : dirs.acceptanceDev;
    const to = path.join(destDir, name);
    gitMv(from, to);
    prependArchiveMeta(to, { status: 'ACCEPTANCE_RECORD', supersededBy: 'Evidence only — not CURRENT' });
    // leave stub
    fs.writeFileSync(
      from,
      `# MOVED — Acceptance Record\n\n**Status:** ACCEPTANCE_RECORD (not CURRENT)\n\nNew location: [\`${path.relative(tone, to).replace(/\\/g, '/')}\`](${path.relative(tone, to).replace(/\\/g, '/')})\n\nSee [\`docs/current/INDEX.md\`](../current/INDEX.md).\n`,
      'utf8'
    );
    migration.acceptance.push({ name, to: path.relative(repo, to).replace(/\\/g, '/') });
    continue;
  }
  if (cls.kind === 'ARCHIVE') {
    const destDir =
      cls.sub === 'RETIRED'
        ? dirs.archiveRetired
        : cls.sub === 'SUPERSEDED'
          ? dirs.archiveSuperseded
          : cls.sub === 'EXPERIMENT'
            ? dirs.archiveExperiment
            : dirs.archiveHistorical;
    const to = path.join(destDir, name);
    gitMv(from, to);
    prependArchiveMeta(to, { status: cls.status, supersededBy: cls.supersededBy });
    fs.writeFileSync(
      from,
      `# MOVED — Archive\n\n**Status:** ${cls.status}\n\n**Superseded By:** ${cls.supersededBy}\n\nNew location: [\`${path.relative(tone, to).replace(/\\/g, '/')}\`](${path.relative(tone, to).replace(/\\/g, '/')})\n\nDo not use as CURRENT. See [\`docs/current/INDEX.md\`](../current/INDEX.md).\n`,
      'utf8'
    );
    migration.archive.push({ name, status: cls.status, to: path.relative(repo, to).replace(/\\/g, '/') });
  }
}

fs.writeFileSync(
  path.join(repo, 'docs/tone-v2/_doc_consolidation_migration.json'),
  JSON.stringify(migration, null, 2),
  'utf8'
);
console.log(
  JSON.stringify(
    {
      acceptance: migration.acceptance.length,
      archive: migration.archive.length,
      stayedCurrent: migration.stayedCurrent.length,
    },
    null,
    2
  )
);
