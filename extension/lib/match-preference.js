/**
 * Purpose: apply the requested Light Orange Striker preference over Carnelian.
 * Setup: receives eligible, color-ranked matches and the active-form stock check.
 * Writes: none. Constraints: never changes scores, removes alternatives or overrides
 * an explicit user choice. Only a would-be automatic Carnelian choice is replaced.
 */
export function preferredAutomaticMatch(matches, isAvailable = () => true) {
  const automatic = matches.find(isAvailable) || matches[0] || null;
  if (automatic?.product.id !== '001321') return automatic;
  return matches.find(match => match.product.id === '001025' && isAvailable(match)) || automatic;
}
