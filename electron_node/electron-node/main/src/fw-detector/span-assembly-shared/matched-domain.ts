/** Pick fine domain with highest tag weight (Schema V2). */
export function pickMatchedDomainFromWeights(
  domainWeights: Record<string, number> | undefined
): string | undefined {
  if (!domainWeights) {
    return undefined;
  }
  let bestDomain: string | undefined;
  let bestWeight = -1;
  for (const [domainId, weight] of Object.entries(domainWeights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestDomain = domainId;
    }
  }
  return bestDomain;
}
