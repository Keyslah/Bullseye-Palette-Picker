/**
 * Purpose: place photo sample markers within the actual contained image, including letterboxing.
 * Setup: use the source image dimensions and the square glass-photo frame dimensions.
 * Writes: none; returns normalized image bounds and valid normalized click coordinates.
 * Constraints: background outside the image is never a sample; does not change measured colors.
 */

export function containedImageBounds(imageWidth, imageHeight, frameWidth = 1, frameHeight = 1) {
  if (![imageWidth, imageHeight, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale / frameWidth, height = imageHeight * scale / frameHeight;
  return {left: (1 - width) / 2, top: (1 - height) / 2, width, height};
}

export function imagePointFromClient(clientX, clientY, bounds) {
  if (!bounds || !Number.isFinite(clientX) || !Number.isFinite(clientY) || bounds.width <= 0 || bounds.height <= 0) return null;
  const x = (clientX - bounds.left) / bounds.width, y = (clientY - bounds.top) / bounds.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? {x, y} : null;
}
