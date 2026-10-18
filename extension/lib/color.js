/**
 * Purpose: Convert full sRGB colors to/from CIELAB and compare their complete color.
 * Setup: Import this dependency-free ES module in a browser or Node.js.
 * Destructive behavior: None; functions do not mutate their inputs or perform I/O.
 * Constraints: RGB is 0..255 sRGB; Lab uses the D65 reference white. CIEDE2000
 * compares lightness, chroma, and hue together, never grayscale alone.
 * References: https://www.w3.org/TR/css-color-4/#color-conversion-code
 * https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
 */

const D65 = [0.9504559270516716, 1, 1.0890577507598784];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;
const DEG_TO_RAD = Math.PI / 180;
const POW_25_7 = 25 ** 7;

function triplet(value, name) {
  if (!value || value.length !== 3) {
    throw new TypeError(name + ' must contain three finite numbers.');
  }
  const result = Array.from(value);
  if (!result.every((channel) => typeof channel === 'number' && Number.isFinite(channel))) {
    throw new TypeError(name + ' must contain three finite numbers.');
  }
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function linearize(channel) {
  const value = clamp(channel, 0, 255) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encode(channel) {
  const value = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(clamp(value, 0, 1) * 255);
}

/** Convert an sRGB RGB triplet to D65 CIELAB without discarding hue or chroma. */
export function rgbToLab(rgb) {
  const [r, g, b] = triplet(rgb, 'RGB').map(linearize);
  const xyz = [
    0.41239079926595934 * r + 0.357584339383878 * g + 0.1804807884018343 * b,
    0.21263900587151027 * r + 0.715168678767756 * g + 0.07219231536073371 * b,
    0.01933081871559182 * r + 0.11919477979462598 * g + 0.9505321522496607 * b,
  ];
  const [x, y, z] = xyz.map((value, index) => {
    const relative = value / D65[index];
    return relative > EPSILON ? Math.cbrt(relative) : (KAPPA * relative + 16) / 116;
  });
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Convert D65 CIELAB to displayable 8-bit sRGB, clipping out-of-gamut channels. */
export function labToRgb(lab) {
  const [lightness, a, b] = triplet(lab, 'Lab');
  const y = (lightness + 16) / 116;
  const [xValue, yValue, zValue] = [y + a / 500, y, y - b / 200].map((value, index) => {
    const cube = value ** 3;
    return (cube > EPSILON ? cube : (116 * value - 16) / KAPPA) * D65[index];
  });
  return [
    3.2409699419045226 * xValue - 1.537383177570094 * yValue - 0.4986107602930034 * zValue,
    -0.9692436362808796 * xValue + 1.8759675015077202 * yValue + 0.04155505740717559 * zValue,
    0.05563007969699366 * xValue - 0.20397695888897652 * yValue + 1.0569715142428786 * zValue,
  ].map(encode);
}

/** Return a #RRGGBB swatch, rounding and clamping RGB channels for display. */
export function rgbToHex(rgb) {
  return '#' + triplet(rgb, 'RGB')
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Parse #RGB or #RRGGBB (a leading # is optional); alpha is not a color swatch. */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') throw new TypeError('Hex color must be a string.');
  let digits = hex.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(digits)) {
    throw new TypeError('Use a three- or six-digit RGB hex color.');
  }
  if (digits.length === 3) digits = digits.split('').map((digit) => digit + digit).join('');
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function hueDegrees(a, b) {
  if (a === 0 && b === 0) return 0;
  const degrees = Math.atan2(b, a) / DEG_TO_RAD;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** CIEDE2000 with standard kL=kC=kH=1; smaller means a closer full-color match. */
export function deltaE2000(lab1, lab2) {
  const [l1, a1, b1] = triplet(lab1, 'First Lab color');
  const [l2, a2, b2] = triplet(lab2, 'Second Lab color');
  const meanChroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const meanChroma7 = meanChroma ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanChroma7 / (meanChroma7 + POW_25_7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const h1Prime = hueDegrees(a1Prime, b1);
  const h2Prime = hueDegrees(a2Prime, b2);
  const zeroChroma = c1Prime * c2Prime === 0;

  const deltaL = l2 - l1;
  const deltaC = c2Prime - c1Prime;
  let deltaHue = h2Prime - h1Prime;
  if (zeroChroma) deltaHue = 0;
  else if (deltaHue > 180) deltaHue -= 360;
  else if (deltaHue < -180) deltaHue += 360;
  const deltaH = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(deltaHue * DEG_TO_RAD / 2);

  const meanL = (l1 + l2) / 2;
  const meanC = (c1Prime + c2Prime) / 2;
  const hueSum = h1Prime + h2Prime;
  let meanHue;
  if (zeroChroma) meanHue = hueSum;
  else if (Math.abs(h1Prime - h2Prime) <= 180) meanHue = hueSum / 2;
  else meanHue = (hueSum + (hueSum < 360 ? 360 : -360)) / 2;

  const t = 1
    - 0.17 * Math.cos((meanHue - 30) * DEG_TO_RAD)
    + 0.24 * Math.cos(2 * meanHue * DEG_TO_RAD)
    + 0.32 * Math.cos((3 * meanHue + 6) * DEG_TO_RAD)
    - 0.20 * Math.cos((4 * meanHue - 63) * DEG_TO_RAD);
  const lightnessOffset2 = (meanL - 50) ** 2;
  const sL = 1 + 0.015 * lightnessOffset2 / Math.sqrt(20 + lightnessOffset2);
  const sC = 1 + 0.045 * meanC;
  const sH = 1 + 0.015 * meanC * t;
  const deltaTheta = 30 * Math.exp(-(((meanHue - 275) / 25) ** 2));
  const meanC7 = meanC ** 7;
  const rC = 2 * Math.sqrt(meanC7 / (meanC7 + POW_25_7));
  const rT = -rC * Math.sin(2 * deltaTheta * DEG_TO_RAD);
  const termL = deltaL / sL;
  const termC = deltaC / sC;
  const termH = deltaH / sH;
  return Math.sqrt(Math.max(0, termL ** 2 + termC ** 2 + termH ** 2 + rT * termC * termH));
}
