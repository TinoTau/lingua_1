/**
 * READ_ONLY diagnostic: 8/8 segmentation hypothesis diversity measurement.
 * Uses cached LexicalEdge graphs from path-budget audit. No production changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const CACHE = path.join(OUT, '_path_budget_edge_cache.json');
const G2 = new Set(['p2_u001_003', 'p2_u004_033', 'p2_u005_004', 'p2_u005_015']);
const LIMITS = { active: 8, complete: 8 };

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function compareBestFirst(a, b) {
  if (a.fallbackEdgeCount !== b.fallbackEdgeCount) return a.fallbackEdgeCount - b.fallbackEdgeCount;
  if (a.fuzzyEdgeCount !== b.fuzzyEdgeCount) return a.fuzzyEdgeCount - b.fuzzyEdgeCount;
  if (a.toneRelaxedEdgeCount !== b.toneRelaxedEdgeCount)
    return a.toneRelaxedEdgeCount - b.toneRelaxedEdgeCount;
  if (a.exactEdgeCount !== b.exactEdgeCount) return b.exactEdgeCount - a.exactEdgeCount;
  const lexA = a.edges.length - a.fallbackEdgeCount;
  const lexB = b.edges.length - b.fallbackEdgeCount;
  if (lexA !== lexB) return lexB - lexA;
  return a.boundaryKey.localeCompare(b.boundaryKey);
}

function geometrySignature(edges) {
  return edges.map((e) => `${e.sylStart}:${e.sylEnd}`).join('|');
}

function domainTagSignature(edges) {
  // Offline observability only: sorted unique domain tags across lexical edges' surfaces provenance
  // Cache edges may not have domains[]; use surface set as weak proxy is forbidden for domain.
  // Use termId/surfaces only if domains present; otherwise NOT_EVALUABLE marker.
  const tags = new Set();
  let any = false;
  for (const e of edges) {
    if (Array.isArray(e.domains) && e.domains.length) {
      any = true;
      for (const d of e.domains) tags.add(d);
    }
  }
  if (!any) return null;
  return [...tags].sort().join('+') || 'EMPTY';
}

function enumerateWithDiversity(syllableCount, edges, limits, targetGeom) {
  const outgoing = Array.from({ length: syllableCount + 1 }, () => []);
  const seen = new Set();
  for (const e of edges) {
    const key = `${e.sylStart}:${e.sylEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing[e.sylStart].push(e);
  }
  for (let i = 0; i < syllableCount; i++) {
    outgoing[i].sort((a, b) => {
      if (a.sylEnd !== b.sylEnd) return a.sylEnd - b.sylEnd;
      const ka = a.edgeKind === 'lexical' ? 0 : 1;
      const kb = b.edgeKind === 'lexical' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a.edgeId.localeCompare(b.edgeId);
    });
  }

  const active = Array.from({ length: syllableCount + 1 }, () => []);
  active[0].push({
    edges: [],
    boundaryKey: '',
    fallbackEdgeCount: 0,
    exactEdgeCount: 0,
    toneRelaxedEdgeCount: 0,
    fuzzyEdgeCount: 0,
  });

  let activeCapFired = false;
  let activeTargetKilled = false;
  let peakActive = 0;
  const pathHasTarget = (p) =>
    targetGeom &&
    p.edges.some((e) => e.sylStart === targetGeom.sylStart && e.sylEnd === targetGeom.sylEnd);

  for (let pos = 0; pos < syllableCount; pos++) {
    let prefixes = active[pos];
    peakActive = Math.max(peakActive, prefixes.length);
    if (prefixes.length > limits.active && pos > 0) {
      activeCapFired = true;
      const sorted = [...prefixes].sort(compareBestFirst);
      const kept = sorted.slice(0, limits.active);
      const pruned = sorted.slice(limits.active);
      if (pruned.some(pathHasTarget) && !kept.some(pathHasTarget)) activeTargetKilled = true;
      prefixes = kept;
      active[pos] = kept;
    }
    for (const prefix of prefixes) {
      for (const edge of outgoing[pos] || []) {
        active[edge.sylEnd].push({
          edges: [...prefix.edges, edge],
          boundaryKey: prefix.boundaryKey
            ? `${prefix.boundaryKey}|${edge.sylStart}-${edge.sylEnd}`
            : `${edge.sylStart}-${edge.sylEnd}`,
          fallbackEdgeCount: prefix.fallbackEdgeCount + (edge.edgeKind === 'fallback' ? 1 : 0),
          exactEdgeCount: prefix.exactEdgeCount + (edge.hasExact ? 1 : 0),
          toneRelaxedEdgeCount: prefix.toneRelaxedEdgeCount + (edge.hasToneRelaxed ? 1 : 0),
          fuzzyEdgeCount: prefix.fuzzyEdgeCount + (edge.hasFuzzy ? 1 : 0),
        });
      }
    }
  }

  const completeBefore = active[syllableCount] || [];
  const sortedAll = [...completeBefore].sort(compareBestFirst);
  let kept = completeBefore;
  let completeCapFired = false;
  if (completeBefore.length > limits.complete) {
    completeCapFired = true;
    kept = sortedAll.slice(0, limits.complete);
  }
  kept = [...kept].sort((a, b) => a.boundaryKey.localeCompare(b.boundaryKey));

  const summarize = (paths) => {
    const bks = new Set(paths.map((p) => p.boundaryKey));
    const geoms = new Set(paths.map((p) => geometrySignature(p.edges)));
    const doms = new Set();
    let domEval = false;
    for (const p of paths) {
      const d = domainTagSignature(p.edges);
      if (d != null) {
        domEval = true;
        doms.add(d);
      }
    }
    return {
      n: paths.length,
      uniqueBk: bks.size,
      uniqueGeom: geoms.size,
      uniqueDom: domEval ? doms.size : null,
      geoms: [...geoms],
      bks: [...bks],
    };
  };

  const before = summarize(completeBefore);
  const after = summarize(kept);
  const targetComplete = completeBefore.filter(pathHasTarget);
  const targetKept = kept.filter(pathHasTarget);
  const targetBestRank =
    targetComplete.length > 0 ? sortedAll.findIndex(pathHasTarget) + 1 : null;

  // Target geometry class = any path whose geometry signature contains target edge span
  // as a contiguous segment in the ordered list (i.e. has that edge)
  const targetGeomClassBefore = targetComplete.length > 0;
  const targetGeomClassAfter = targetKept.length > 0;

  // Redundancy: among retained, count how many share the most common geometry prefix length pattern
  // Diagnostic: fraction of retained paths that share identical exact/fuzzy/fallback structural counts with at least one other
  const structKeys = kept.map(
    (p) =>
      `${p.fallbackEdgeCount}:${p.fuzzyEdgeCount}:${p.toneRelaxedEdgeCount}:${p.exactEdgeCount}:${p.edges.length - p.fallbackEdgeCount}`
  );
  const freq = {};
  for (const k of structKeys) freq[k] = (freq[k] || 0) + 1;
  const maxStructDup = Object.values(freq).reduce((a, b) => Math.max(a, b), 0);
  const topNStructuralRedundancy = kept.length ? maxStructDup / kept.length : 0;

  // Geometry-level: max count of same geometry signature among retained
  const gfreq = {};
  for (const g of after.geoms) gfreq[g] = (gfreq[g] || 0) + 1;
  // Wait - after.geoms is unique list. Recount from kept:
  const gfreq2 = {};
  for (const p of kept) {
    const g = geometrySignature(p.edges);
    gfreq2[g] = (gfreq2[g] || 0) + 1;
  }
  const maxGeomDup = Object.values(gfreq2).reduce((a, b) => Math.max(a, b), 0);

  // Similar paths occupy cap: many retained share near-identical edge-count / fine partition preference
  // Heuristic: uniqueGeom/retained < 0.5 OR maxStructDup >= 3
  const similarOccupy =
    kept.length >= 4 && (after.uniqueGeom / kept.length <= 0.5 || maxStructDup >= 3);

  let lossStage = null;
  if (targetGeom && !targetKept.length) {
    if (activeTargetKilled && !targetComplete.length) lossStage = 'ACTIVE_CAP';
    else if (targetComplete.length && completeCapFired) lossStage = 'COMPLETE_CAP';
    else if (!targetComplete.length) lossStage = activeCapFired ? 'ACTIVE_CAP' : 'NO_COMPLETE';
    else lossStage = 'OTHER';
  } else if (targetKept.length) {
    lossStage = 'SURVIVED';
  }

  // Diversity loss class for target losses
  let diversityLossClass = 'N/A';
  if (lossStage && lossStage !== 'SURVIVED') {
    if (lossStage === 'ACTIVE_CAP' && !targetComplete.length) {
      diversityLossClass = 'D4';
    } else if (targetGeomClassAfter) {
      diversityLossClass = 'D3';
    } else if (similarOccupy && !targetGeomClassAfter) {
      diversityLossClass = 'D2';
    } else if (!similarOccupy && !targetGeomClassAfter && after.uniqueGeom >= 4) {
      diversityLossClass = 'D1';
    } else if (!targetGeomClassAfter) {
      diversityLossClass = similarOccupy ? 'D2' : 'D1';
    } else {
      diversityLossClass = 'D5';
    }
  }

  return {
    activeCapFired,
    completeCapFired,
    peakActive,
    before,
    after,
    targetBestRank,
    targetHypothesisCountPrePrune: targetComplete.length,
    targetHypothesisCountPostPrune: targetKept.length,
    targetGeomClassBefore,
    targetGeomClassAfter,
    targetAvailable: targetKept.length > 0,
    lossStage,
    diversityLossClass,
    topNStructuralRedundancy: Number(topNStructuralRedundancy.toFixed(3)),
    maxStructDup,
    maxGeomDup,
    similarOccupy,
    BOUNDARYKEY_RETENTION_RATIO: before.uniqueBk
      ? Number((after.uniqueBk / before.uniqueBk).toFixed(3))
      : null,
    GEOMETRY_RETENTION_RATIO: before.uniqueGeom
      ? Number((after.uniqueGeom / before.uniqueGeom).toFixed(3))
      : null,
    DOMAIN_TAG_SIGNATURE_RETENTION_RATIO:
      before.uniqueDom != null && before.uniqueDom > 0
        ? Number((after.uniqueDom / before.uniqueDom).toFixed(3))
        : null,
  };
}

function main() {
  const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const evaluable = Object.values(cache.cases).filter((c) => c.targetEdgeExists && c.edges);
  const measureRows = [];
  const attrRows = [];

  for (const c of evaluable) {
    const r = enumerateWithDiversity(c.syllableCount, c.edges, LIMITS, c.targetGeom);
    const isG2 = G2.has(c.caseId);
    const isLoss = !r.targetAvailable;

    measureRows.push({
      caseId: c.caseId,
      isG2: isG2 ? 'YES' : 'NO',
      targetSurface: c.targetSurface,
      targetGeom: c.targetGeom ? `${c.targetGeom.sylStart}:${c.targetGeom.sylEnd}` : '',
      COMPLETE_PATHS_BEFORE_CAP: r.before.n,
      COMPLETE_PATHS_AFTER_CAP: r.after.n,
      UNIQUE_BOUNDARY_KEYS_BEFORE_CAP: r.before.uniqueBk,
      UNIQUE_BOUNDARY_KEYS_AFTER_CAP: r.after.uniqueBk,
      UNIQUE_LEXICAL_GEOMETRY_SIGNATURES_BEFORE_CAP: r.before.uniqueGeom,
      UNIQUE_LEXICAL_GEOMETRY_SIGNATURES_AFTER_CAP: r.after.uniqueGeom,
      UNIQUE_DOMAIN_TAG_SIGNATURES_AVAILABLE_BEFORE_CAP: r.before.uniqueDom ?? 'NOT_EVALUABLE',
      UNIQUE_DOMAIN_TAG_SIGNATURES_AVAILABLE_AFTER_CAP: r.after.uniqueDom ?? 'NOT_EVALUABLE',
      BOUNDARYKEY_RETENTION_RATIO: r.BOUNDARYKEY_RETENTION_RATIO,
      GEOMETRY_RETENTION_RATIO: r.GEOMETRY_RETENTION_RATIO,
      DOMAIN_TAG_SIGNATURE_RETENTION_RATIO: r.DOMAIN_TAG_SIGNATURE_RETENTION_RATIO ?? 'NOT_EVALUABLE',
      TOPN_STRUCTURAL_REDUNDANCY: r.topNStructuralRedundancy,
      maxStructDup: r.maxStructDup,
      maxGeomDup: r.maxGeomDup,
      activeCapFired: r.activeCapFired ? 'YES' : 'NO',
      completeCapFired: r.completeCapFired ? 'YES' : 'NO',
      targetAvailableToDomainVote: r.targetAvailable ? 'YES' : 'NO',
      DIAGNOSTIC_GEOMETRY_SIGNATURE_ONLY: 'YES',
    });

    if (isLoss || isG2) {
      attrRows.push({
        caseId: c.caseId,
        isG2: isG2 ? 'YES' : 'NO',
        targetTerm: c.targetSurface,
        TARGET_GEOMETRY: c.targetGeom ? `${c.targetGeom.sylStart}:${c.targetGeom.sylEnd}` : '',
        LOSS_STAGE: r.lossStage,
        TARGET_STRUCTURAL_RANK: r.targetBestRank ?? 'NOT_AVAILABLE',
        RETAINED_PATH_COUNT: r.after.n,
        RETAINED_UNIQUE_BOUNDARYKEY_COUNT: r.after.uniqueBk,
        RETAINED_UNIQUE_GEOMETRY_COUNT: r.after.uniqueGeom,
        TARGET_GEOMETRY_CLASS_REPRESENTED_AFTER_CAP: r.targetGeomClassAfter ? 'YES' : 'NO',
        TARGET_DOMAIN_TAG_SIGNATURE_REPRESENTED_AFTER_CAP: 'NOT_EVALUABLE',
        SIMILAR_PATHS_OCCUPY_CAP: r.similarOccupy ? 'YES' : 'NO',
        DIVERSITY_COLLAPSE_OBSERVED:
          r.similarOccupy && !r.targetGeomClassAfter
            ? 'YES'
            : r.similarOccupy
              ? 'PARTIAL'
              : !r.targetGeomClassAfter && r.after.uniqueGeom <= 3
                ? 'PARTIAL'
                : 'NO',
        DIVERSITY_LOSS_CLASS: r.diversityLossClass,
        GEOMETRY_RETENTION_RATIO: r.GEOMETRY_RETENTION_RATIO,
        TOPN_STRUCTURAL_REDUNDANCY: r.topNStructuralRedundancy,
        targetHypPre: r.targetHypothesisCountPrePrune,
        targetHypPost: r.targetHypothesisCountPostPrune,
      });
    }
  }

  writeCsv(
    path.join(OUT, 'segmentation_8x8_diversity_measurement.csv'),
    Object.keys(measureRows[0] || { caseId: '' }),
    measureRows
  );
  writeCsv(
    path.join(OUT, 'segmentation_target_loss_diversity_attribution.csv'),
    Object.keys(attrRows[0] || { caseId: '' }),
    attrRows
  );

  const losses = measureRows.filter((r) => r.targetAvailableToDomainVote === 'NO');
  const g2Rows = attrRows.filter((r) => r.isG2 === 'YES');
  const collapseG2 = g2Rows.filter((r) => r.DIVERSITY_COLLAPSE_OBSERVED !== 'NO').length;
  const collapseLoss = attrRows.filter(
    (r) => r.targetAvailableToDomainVote !== 'YES' && r.DIVERSITY_COLLAPSE_OBSERVED !== 'NO'
  );
  // fix: attr for losses only
  const lossAttrs = attrRows.filter((r) => r.LOSS_STAGE && r.LOSS_STAGE !== 'SURVIVED');
  const collapseLossCount = lossAttrs.filter((r) => r.DIVERSITY_COLLAPSE_OBSERVED !== 'NO').length;

  const activeCollapse = lossAttrs.filter((r) => r.LOSS_STAGE === 'ACTIVE_CAP').length;
  const completeCollapse = lossAttrs.filter((r) => r.LOSS_STAGE === 'COMPLETE_CAP').length;

  // Aggregate retention among cases where cap fired
  const capped = measureRows.filter((r) => r.completeCapFired === 'YES' || r.activeCapFired === 'YES');
  const meanGeomRet =
    capped.length &&
    capped.reduce((s, r) => s + (Number(r.GEOMETRY_RETENTION_RATIO) || 0), 0) / capped.length;

  const summary = {
    evaluable: evaluable.length,
    losses: losses.length,
    g2Survive: g2Rows.filter((r) => r.LOSS_STAGE === 'SURVIVED').length,
    g2CollapseObserved: collapseG2,
    lossCollapseObserved: collapseLossCount,
    lossByStage: {
      ACTIVE_CAP: activeCollapse,
      COMPLETE_CAP: completeCollapse,
      other: lossAttrs.length - activeCollapse - completeCollapse,
    },
    diversityLossClassCounts: lossAttrs.reduce((acc, r) => {
      acc[r.DIVERSITY_LOSS_CLASS] = (acc[r.DIVERSITY_LOSS_CLASS] || 0) + 1;
      return acc;
    }, {}),
    meanGeometryRetentionWhenCapped: meanGeomRet ? Number(meanGeomRet.toFixed(3)) : null,
    g2Detail: g2Rows,
    lossDetail: lossAttrs,
  };

  fs.writeFileSync(path.join(OUT, '_diversity_measure_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
