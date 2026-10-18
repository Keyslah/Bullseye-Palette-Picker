/**
 * Purpose: find the visible photo belonging to a right-clicked image link or overlay.
 * Setup: inject findLinkedImage into the clicked frame after its context-menu gesture.
 * Destructive behavior: none; only reads the matching links and their image elements.
 * Constraints: no network, page changes, persistent listeners, or unrelated image guesses.
 */

export function findLinkedImage(linkUrl) {
  // Every dependency stays inside this function so executeScript can serialize it.
  if (typeof linkUrl !== 'string' || !linkUrl) return '';
  let target;
  try {
    target = new URL(linkUrl, document.baseURI);
    if (!['http:', 'https:'].includes(target.protocol)) return '';
  } catch { return ''; }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const candidates = new Map();
  const minimumSide = 48;
  const clips = value => ['hidden', 'clip', 'scroll', 'auto'].includes(value);

  function visibleArea(img) {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) return 0;
    const rect = img.getBoundingClientRect();
    if (rect.width < minimumSide || rect.height < minimumSide) return 0;
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(viewportWidth, rect.right);
    let bottom = Math.min(viewportHeight, rect.bottom);

    for (let element = img; element; element = element.parentElement) {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.contentVisibility === 'hidden'
        || Number(style.opacity) === 0) return 0;
      // Visibility can be overridden by descendants; the image's computed value
      // already includes inheritance from its ancestors.
      if (element === img && ['hidden', 'collapse'].includes(style.visibility)) return 0;
      if (element === img) continue;
      const clipX = clips(style.overflowX);
      const clipY = clips(style.overflowY);
      if (clipX || clipY) {
        const bounds = element.getBoundingClientRect();
        if (clipX) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (clipY) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
    }
    const width = right - left;
    const height = bottom - top;
    return width >= minimumSide && height >= minimumSide ? width * height : 0;
  }

  // Compare resolved hrefs instead of interpolating untrusted URLs into a selector.
  for (const anchor of document.querySelectorAll('a[href]')) {
    let href;
    try { href = new URL(anchor.href, document.baseURI).href; } catch { continue; }
    if (href !== target.href) continue;
    for (const img of anchor.querySelectorAll('img')) {
      const area = visibleArea(img);
      if (!area) continue;
      const selectedSource = img.currentSrc || img.src;
      if (typeof selectedSource !== 'string' || !selectedSource.trim()) continue;
      let source;
      try {
        source = new URL(selectedSource, document.baseURI);
        if (!['http:', 'https:', 'data:'].includes(source.protocol)) continue;
      } catch { continue; }
      candidates.set(source.href, Math.max(area, candidates.get(source.href) || 0));
    }
  }
  const ranked = [...candidates].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return '';
  // A gallery-sized rival makes the link ambiguous. A small accompanying image
  // does not prevent using a clearly dominant photo.
  if (ranked[1] && ranked[1][1] >= ranked[0][1] * 0.6) return '';
  return ranked[0][0];
}
