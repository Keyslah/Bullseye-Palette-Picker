/**
 * Purpose: choose ordinary Black for near-black targets and keep purple/Orange Striker preferences.
 * Setup: receives eligible, color-ranked photo matches, the active-form stock check and target color.
 * Writes: none. Constraints: never changes scores, removes alternatives or overrides
 * an explicit user choice. Hue checks use the selected form's actual sample RGB.
 */
import {hexToRgb, labToRgb, rgbToLab} from './color.js';
import {getColorFamily, sampleDarkness} from './palette.js';

function isNearBlackTarget(target) {
  try {
    // Same neutral, L* <= 20 band as the catalog's existing Black tie-break.
    return getColorFamily(target) === 'neutral' && sampleDarkness(target) >= 80;
  } catch { return false; }
}

function visibleHue(color) {
  try {
    const rgb = typeof color === 'string' ? hexToRgb(color)
      : Array.isArray(color) || ArrayBuffer.isView(color) ? color
      : color?.rgb || (color?.hex ? hexToRgb(color.hex) : color?.lab ? labToRgb(color.lab) : null);
    if (!rgb) return null;
    const [, a, b] = rgbToLab(rgb), high = Math.max(...rgb), low = Math.min(...rgb), span = high - low;
    // Hue is unreliable in nearly neutral colors, including near-black pixels.
    if (Math.hypot(a, b) < 10 || !span) return null;
    const [red, green, blue] = rgb;
    const hue = ((high === red ? (green - blue) / span
      : high === green ? (blue - red) / span + 2 : (red - green) / span + 4) * 60 + 360) % 360;
    return {hue, saturation: span / high};
  } catch { return null; }
}

function hueDistance(first, second) {
  const distance = Math.abs(first - second);
  return Math.min(distance, 360 - distance);
}

export function preferredAutomaticMatch(matches, isAvailable = () => true, target = null) {
  const automatic = matches.find(isAvailable) || matches[0] || null;
  // Photo lighting and a small color cast can make blue/gray glass score closer
  // than Black for an effectively black target. Select ordinary Black in this
  // existing near-black band without changing raw scores, samples or filters.
  if (isNearBlackTarget(target)) {
    return matches.find(match => match.product.id === '000100' && isAvailable(match)) || automatic;
  }
  if (automatic?.product.id === '001321') {
    return matches.find(match => match.product.id === '001025' && isAvailable(match)) || automatic;
  }
  const wanted = visibleHue(target), actual = visibleHue(automatic?.sample);
  // CIEDE2000 can favor saturated blue over a less saturated purple photograph.
  // For clearly purple targets only, prefer a nearby full-color candidate whose
  // photographed hue is substantially closer. These are conservative picker
  // policy bounds, not a replacement color metric or a physical glass model.
  if (!wanted || !actual || wanted.saturation < .25 || wanted.hue < 260 || wanted.hue > 330
    || actual.hue < 180 || actual.hue >= 255) return automatic;
  const originalGap = hueDistance(wanted.hue, actual.hue);
  return matches.find(match => {
    if (!isAvailable(match) || match.deltaE > Math.min(25, automatic.deltaE + 10)) return false;
    const candidate = visibleHue(match.sample);
    if (!candidate || candidate.hue < 255 || candidate.hue > 340) return false;
    const gap = hueDistance(wanted.hue, candidate.hue);
    return gap <= 25 && gap + 5 <= originalGap;
  }) || automatic;
}
