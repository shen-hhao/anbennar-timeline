// Quality is an explicit number of samples per CSS pixel. A device-pixel
// floor would collapse the lower choices on high-DPI displays.
export function renderSurfaceSize(cssWidth, cssHeight, quality = 3, maxPixels = 24_000_000) {
  const w = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const h = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const requestedQuality = [1, 2, 3].includes(quality) ? quality : 3;
  const budget = Number.isFinite(maxPixels) && maxPixels >= 1 ? Math.floor(maxPixels) : 24_000_000;
  let width = Math.max(1, Math.round(w * requestedQuality));
  let height = Math.max(1, Math.round(h * requestedQuality));
  const limited = width * height > budget;
  if (limited) {
    const ratio = Math.sqrt(budget / (w * h));
    width = Math.max(1, Math.floor(w * ratio));
    height = Math.max(1, Math.floor(h * ratio));
    // A minimum one-pixel side must not exceed the budget on extreme aspects.
    height = Math.min(height, budget);
    width = Math.min(width, Math.floor(budget / height));
  }
  return { width, height, requestedQuality, ratio: width / w, limited };
}
