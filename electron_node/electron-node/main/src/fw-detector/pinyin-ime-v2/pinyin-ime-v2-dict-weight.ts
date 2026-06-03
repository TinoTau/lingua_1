export const TARGET_BOOST_FACTOR = 1.25;
export const ALIAS_PENALTY_FACTOR = 0.85;

export function computeImeWeight(row: {
  prior_score: number;
  repair_target?: number;
  is_alias?: number;
  domainBoost?: number;
}): number {
  const prior = Number(row.prior_score) || 0.5;
  const targetMul = row.repair_target ? TARGET_BOOST_FACTOR : 1;
  const aliasMul = row.is_alias ? ALIAS_PENALTY_FACTOR : 1;
  const domainMul = row.domainBoost ?? 1;
  return prior * targetMul * aliasMul * domainMul;
}
