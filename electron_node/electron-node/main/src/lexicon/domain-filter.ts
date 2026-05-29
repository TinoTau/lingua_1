/**
 * FW detector — hotword domain gate (no general full-corpus recall).
 */

export function matchEnabledDomain(
  hotwordDomains: string[] | undefined,
  enabledDomains: string[]
): boolean {
  if (!enabledDomains.length) {
    return false;
  }
  const domains = hotwordDomains?.length ? hotwordDomains : ['general'];
  if (domains.includes('general')) {
    return false;
  }
  return domains.some((d) => enabledDomains.includes(d));
}
