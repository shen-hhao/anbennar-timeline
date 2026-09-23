// Halann is a cylinder: longitude repeats; latitude remains bounded.
export function wrapX(x, width) {
  return ((x % width) + width) % width;
}

export function visibleCopies(offset, period, viewportWidth) {
  const first = Math.floor(-offset / period);
  const last = Math.ceil((viewportWidth - offset) / period) - 1;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

// Fit one complete world inside the actual map stage. A relatively narrow
// stage reaches the longitude limit first; a wide stage reaches latitude first.
// worldFrame centers the spare space without repeating any visible longitude.
export function adaptiveFitScale(viewportWidth, viewportHeight, mapWidth, mapHeight) {
  if (![viewportWidth, viewportHeight, mapWidth, mapHeight]
    .every(value => Number.isFinite(value) && value > 0)) return 1;
  const scale = Math.min(viewportWidth / mapWidth, viewportHeight / mapHeight);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// The visible window never spans more than one turn around Halann. A whole
// world narrower than the viewport gets a centered window instead of repeats.
// Short maps are centered vertically, matching constrainCamera below.
export function worldFrame(viewportWidth, viewportHeight, mapWidth, mapHeight, scale) {
  if (![viewportWidth, viewportHeight, mapWidth, mapHeight, scale].every(Number.isFinite)
    || viewportWidth < 0 || viewportHeight < 0 || mapWidth <= 0 || mapHeight <= 0 || scale <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.min(viewportWidth, mapWidth * scale);
  const height = Math.min(viewportHeight, mapHeight * scale);
  return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height };
}

// Copies are render tiles, not additional visible worlds: callers must clip
// every map layer to frame. Half-open edges avoid drawing an extra seam tile.
export function clippedCopies(offset, period, frame) {
  if (!Number.isFinite(offset) || !Number.isFinite(period) || period <= 0
    || !frame || !Number.isFinite(frame.x) || !Number.isFinite(frame.width) || frame.width <= 0) return [];
  const snapInteger = value => {
    const integer = Math.round(value);
    return Math.abs(value - integer) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 8 ? integer : value;
  };
  const first = Math.floor(snapInteger((frame.x - offset) / period));
  const last = Math.ceil(snapInteger((frame.x + Math.min(frame.width, period) - offset) / period)) - 1;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

export function frameContains(x, y, frame) {
  return Boolean(frame && Number.isFinite(x) && Number.isFinite(y)
    && frame.width > 0 && frame.height > 0
    && x >= frame.x && x < frame.x + frame.width
    && y >= frame.y && y < frame.y + frame.height);
}

export function constrainCamera(tx, ty, scale, mapWidth, mapHeight, viewportWidth, viewportHeight, padding = 50) {
  const frame = worldFrame(viewportWidth, viewportHeight, mapWidth, mapHeight, scale);
  if (!frame.width || !frame.height) return { tx: 0, ty: 0 };
  const width = mapWidth * scale, height = mapHeight * scale;
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return {
    tx: wrapX(Number.isFinite(tx) ? tx : frame.x, width),
    ty: height <= viewportHeight ? frame.y
      : Math.max(viewportHeight - height - safePadding, Math.min(safePadding, Number.isFinite(ty) ? ty : 0)),
  };
}

export function mapPoint(x, y, tx, ty, scale, width, height) {
  const my = Math.floor((y - ty) / scale);
  if (my < 0 || my >= height) return null;
  return { x: Math.floor(wrapX((x - tx) / scale, width)), y: my };
}

// Smallest continuous horizontal arc containing the supplied province bounds.
// Returning an end greater than width lets camera focus cross the world seam.
export function circularBounds(bounds, width) {
  if (!bounds.length) return [0, width];
  const intervals = bounds.map(b => [b[0], b[2] + 1]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  let gap = width - merged.at(-1)[1] + merged[0][0];
  let start = merged[0][0], end = merged.at(-1)[1];
  for (let i = 1; i < merged.length; i++) {
    const candidate = merged[i][0] - merged[i - 1][1];
    if (candidate > gap) { gap = candidate; start = merged[i][0]; end = merged[i - 1][1] + width; }
  }
  return [start, end];
}
