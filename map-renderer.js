// Borders live on pixel-grid edges, independently of the ownership fill. A
// source pixel can therefore remain a visible country even at high zoom.
export const BORDER_SEGMENT_STRIDE = 6;

/**
 * Build merged, tiled political borders in O(width * height) time.
 *
 * Each tile has source-coordinate bounds and a Uint32Array of segments:
 * [x1, y1, x2, y2, ownerA, ownerB]. For horizontal lines A is above B;
 * for vertical lines A is left of B. Owner 0 is sea or unowned land.
 *
 * Cache a Path2D per tile and stroke at CSS-pixel width after camera scaling.
 * A selected country's outline uses just segments with A or B equal to its
 * index; selecting a country never needs another full ownership scan.
 *
 * The longitude seam is emitted once at x=0, joining the last and first
 * columns. Render these tiles with the same wrapped copies as the fill and
 * clip all copies to the single-world viewport. Latitude does not wrap.
 */
export function buildBorderTiles(idPixels, ownerIndex, width, height, { tileSize = 256 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || !Number.isInteger(tileSize) || tileSize <= 0 || idPixels?.length !== width * height
    || !ownerIndex?.length) {
    throw new RangeError('Political borders require a complete positive-sized ownership raster and tile size.');
  }
  const columns = Math.ceil(width / tileSize), rows = Math.ceil(height / tileSize);
  const tiles = new Array(columns * rows);
  let segmentCount = 0, edgeCount = 0;
  function add(tileX, tileY, x1, y1, x2, y2, a, b) {
    const index = tileY * columns + tileX;
    let tile = tiles[index];
    if (!tile) {
      const x = tileX * tileSize, y = tileY * tileSize;
      tile = tiles[index] = { x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y), segments: [] };
    }
    tile.segments.push(x1, y1, x2, y2, a, b);
    segmentCount++;
  }
  function horizontal(x1, x2, y, a, b) {
    if (a === b || x1 === x2) return;
    edgeCount += x2 - x1;
    const tileY = Math.min(rows - 1, Math.floor(y / tileSize));
    for (let start = x1; start < x2;) {
      const tileX = Math.floor(start / tileSize), end = Math.min(x2, (tileX + 1) * tileSize);
      add(tileX, tileY, start, y, end, y, a, b);
      start = end;
    }
  }
  function vertical(x, y1, y2, a, b) {
    if (a === b || y1 === y2) return;
    edgeCount += y2 - y1;
    const tileX = Math.floor(x / tileSize);
    for (let start = y1; start < y2;) {
      const tileY = Math.floor(start / tileSize), end = Math.min(y2, (tileY + 1) * tileSize);
      add(tileX, tileY, x, start, x, end, a, b);
      start = end;
    }
  }

  // One open vertical run per column avoids a full-size intermediate raster.
  const verticalA = new Uint32Array(width), verticalB = new Uint32Array(width);
  const verticalStart = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let left = ownerIndex[idPixels[row + width - 1]] || 0;
    let runStart = 0, runA = 0, runB = 0;
    for (let x = 0; x < width; x++) {
      const current = ownerIndex[idPixels[row + x]] || 0;
      const above = y ? ownerIndex[idPixels[row + x - width]] || 0 : 0;
      if (x === 0) { runA = above; runB = current; }
      else if (above !== runA || current !== runB) {
        horizontal(runStart, x, y, runA, runB);
        runStart = x; runA = above; runB = current;
      }
      if (left !== verticalA[x] || current !== verticalB[x]) {
        vertical(x, verticalStart[x], y, verticalA[x], verticalB[x]);
        verticalStart[x] = y; verticalA[x] = left; verticalB[x] = current;
      }
      left = current;
    }
    horizontal(runStart, width, y, runA, runB);
  }
  for (let x = 0; x < width; x++) vertical(x, verticalStart[x], height, verticalA[x], verticalB[x]);

  // The bottom border belongs to the final row's tiles, including when the
  // height is an exact tile multiple. There is no extra row outside the map.
  const bottom = (height - 1) * width;
  let bottomStart = 0, bottomOwner = ownerIndex[idPixels[bottom]] || 0;
  for (let x = 1; x <= width; x++) {
    const owner = x < width ? ownerIndex[idPixels[bottom + x]] || 0 : -1;
    if (owner !== bottomOwner) {
      horizontal(bottomStart, x, height, bottomOwner, 0);
      bottomStart = x; bottomOwner = owner;
    }
  }
  return {
    width, height, tileSize, segmentCount, edgeCount,
    tiles: tiles.filter(Boolean).map(tile => ({ ...tile, segments: Uint32Array.from(tile.segments) })),
  };
}

/**
 * Classify borders using source geography as well as current ownership.
 * surfaceKinds is indexed by province ID: 0 water (sea/lake/wide river),
 * 1 unowned land, 2 wasteland, 3 unknown/excluded, 4 ownable/owned land.
 * Ownership always comes from ownerIndex, never from surfaceKinds.
 *
 * Each result tile has one kind: political, shore, frontier, wasteland, or
 * uncertain. Its segments retain REAL owner indexes in the usual stride 6;
 * unowned geographical shores have ownerA=ownerB=0. Selection paths can use
 * exactly the same owner filtering as with buildBorderTiles. Multiple kinds
 * can occupy the same spatial tile and get separate cached drawing paths.
 */
export function buildTypedBorderTiles(idPixels, ownerIndex, surfaceKinds, width, height, { tileSize = 256 } = {}) {
  if (!ownerIndex?.length || !surfaceKinds?.length) {
    throw new RangeError('Typed borders require province ownership and surface classifications.');
  }
  let maxOwner = 0;
  for (const owner of ownerIndex) {
    if (!Number.isInteger(owner) || owner < 0 || owner > 0xffffffff - 5) {
      throw new RangeError('Border owners must be unsigned indexes with room for surface sentinels.');
    }
    maxOwner = Math.max(maxOwner, owner);
  }
  const encodedOwners = new Uint32Array(Math.max(ownerIndex.length, surfaceKinds.length));
  for (let id = 0; id < encodedOwners.length; id++) {
    const owner = ownerIndex[id] || 0, surface = surfaceKinds[id];
    const kind = Number.isInteger(surface) && surface >= 0 && surface <= 4 ? surface : 3;
    encodedOwners[id] = owner || maxOwner + 1 + kind;
  }
  const raw = buildBorderTiles(idPixels, encodedOwners, width, height, { tileSize });
  const tiles = [], edgeCounts = { political: 0, shore: 0, frontier: 0, wasteland: 0, uncertain: 0 };
  const segmentCounts = { ...edgeCounts };
  let segmentCount = 0, edgeCount = 0;
  // Index zero is only used for a province missing from both lookup arrays.
  // Such a missing source is unknown geography, never presumed to be water.
  const realOwner = owner => owner <= maxOwner ? owner : 0;
  const surfaceKind = owner => owner > maxOwner ? owner - maxOwner - 1 : owner ? 4 : 3;
  for (const tile of raw.tiles) {
    const groups = new Map();
    for (let i = 0; i < tile.segments.length; i += BORDER_SEGMENT_STRIDE) {
      const [x1, y1, x2, y2, encodedA, encodedB] = tile.segments.subarray(i, i + BORDER_SEGMENT_STRIDE);
      // Latitude ends at the raster boundary; there is no imaginary ocean
      // outside the top or bottom row. Longitude's real x=0 seam is retained.
      if (y1 === y2 && (y1 === 0 || y1 === height)) continue;
      const a = realOwner(encodedA), b = realOwner(encodedB);
      const aKind = surfaceKind(encodedA), bKind = surfaceKind(encodedB);
      let kind;
      if (a && b) kind = 'political';
      else if (a || b) {
        const other = a ? bKind : aKind;
        kind = other === 0 ? 'shore' : other === 1 ? 'frontier' : other === 2 ? 'wasteland' : 'uncertain';
      } else if ((aKind === 0) !== (bKind === 0)) kind = 'shore';
      else continue;
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(x1, y1, x2, y2, a, b);
      const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
      edgeCount += length; edgeCounts[kind] += length;
      segmentCount++; segmentCounts[kind]++;
    }
    for (const [kind, segments] of groups) {
      tiles.push({ x: tile.x, y: tile.y, width: tile.width, height: tile.height, kind,
        segments: Uint32Array.from(segments) });
    }
  }
  return { width, height, tileSize, segmentCount, edgeCount, edgeCounts, segmentCounts, tiles };
}

/**
 * Optional internal province borders, using exact source pixel-grid edges.
 * An edge is emitted only between DIFFERENT province IDs sharing the same
 * positive current owner index. National and neutral-terrain boundaries are
 * left to buildTypedBorderTiles, regardless of the countries' display colors.
 *
 * Result tiles use the usual stride 6 and both owner fields contain the real
 * common owner. Longitude wraps once at x=0; the latitude edges never appear.
 * Unknown, water and unowned IDs must have ownerIndex=0, as in the main layer.
 *
 * The scan is O(width * height + ownerIndex.length). Its working storage is
 * O(width + ownerIndex.length + emitted source edges), without an additional
 * full-sized raster. Unowned IDs are collapsed before scanning, so the helper
 * never builds a worldwide network of water or unresearched province edges.
 * Build lazily when enabled, cache the paths, and invalidate on owner changes.
 */
export function buildProvinceBorderTiles(idPixels, ownerIndex, width, height, { tileSize = 256 } = {}) {
  if (!ownerIndex?.length) throw new RangeError('Province borders require current province ownership.');
  const provinceIndexes = new Uint32Array(ownerIndex.length);
  for (let id = 0; id < ownerIndex.length; id++) {
    const owner = ownerIndex[id];
    if (!Number.isInteger(owner) || owner < 0 || owner > 0xffffffff) {
      throw new RangeError('Province border owners must be unsigned integer indexes.');
    }
    // Reserve zero for every invisible/neutral ID. The +1 also supports an
    // explicit owned ID zero without confusing it with absent geography.
    if (owner) provinceIndexes[id] = id + 1;
  }
  const raw = buildBorderTiles(idPixels, provinceIndexes, width, height, { tileSize });
  const tiles = [];
  let edgeCount = 0, segmentCount = 0;
  for (const tile of raw.tiles) {
    const segments = [], provincePairs = [];
    for (let i = 0; i < tile.segments.length; i += BORDER_SEGMENT_STRIDE) {
      const a = tile.segments[i + 4], b = tile.segments[i + 5];
      if (!a || !b) continue;
      const owner = ownerIndex[a - 1];
      if (!owner || owner !== ownerIndex[b - 1]) continue;
      const x1 = tile.segments[i], y1 = tile.segments[i + 1];
      const x2 = tile.segments[i + 2], y2 = tile.segments[i + 3];
      segments.push(x1, y1, x2, y2, owner, owner);
      provincePairs.push(a - 1, b - 1);
      edgeCount += x2 - x1 + y2 - y1;
      segmentCount++;
    }
    if (segments.length) tiles.push({ x: tile.x, y: tile.y, width: tile.width, height: tile.height,
      kind: 'province', segments: Uint32Array.from(segments), provincePairs: Uint32Array.from(provincePairs) });
  }
  return { width, height, tileSize, segmentCount, edgeCount, tiles };
}

/**
 * Connect stride-6 segments into continuous polylines for dash rendering.
 * Only degree-two vertices join: branches remain separate paths. Every input
 * edge survives once, including parallel edges; closed paths repeat their
 * first coordinate. Coordinates are retained exactly without simplification.
 * Pass one tile/kind at a time, or already filtered selection segments.
 */
export function traceBorderPaths(segments) {
  if (!segments || segments.length % BORDER_SEGMENT_STRIDE !== 0) {
    throw new RangeError('Border paths require complete stride-6 segments.');
  }
  const vertices = new Map(), edges = [];
  function vertex(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Border path coordinates must be finite.');
    const key = `${x},${y}`;
    if (!vertices.has(key)) vertices.set(key, { x, y, edges: [] });
    return vertices.get(key);
  }
  for (let i = 0; i < segments.length; i += BORDER_SEGMENT_STRIDE) {
    const a = vertex(segments[i], segments[i + 1]), b = vertex(segments[i + 2], segments[i + 3]);
    const id = edges.length;
    edges.push({ a, b }); a.edges.push(id); b.edges.push(id);
  }
  const visited = new Uint8Array(edges.length), paths = [];
  function trace(start, firstEdge) {
    const path = [start.x, start.y];
    let current = start, edgeId = firstEdge;
    while (edgeId !== undefined && !visited[edgeId]) {
      visited[edgeId] = 1;
      const edge = edges[edgeId];
      current = edge.a === current ? edge.b : edge.a;
      path.push(current.x, current.y);
      if (current.edges.length !== 2) break;
      edgeId = current.edges.find(id => !visited[id]);
    }
    paths.push(path);
  }
  for (const start of vertices.values()) {
    if (start.edges.length === 2) continue;
    for (const edgeId of start.edges) if (!visited[edgeId]) trace(start, edgeId);
  }
  // Any untouched component consists entirely of degree-two vertices: a loop.
  for (let id = 0; id < edges.length; id++) if (!visited[id]) trace(edges[id].a, id);
  return paths;
}

// bounds and padding are in source coordinates; callers translate a wrapped
// screen viewport back into each copy's source space before testing its tiles.
// Inclusive edges retain strokes lying exactly on a tile or viewport edge.
export function tileVisible(tile, bounds, padding = 0) {
  return tile.x <= bounds.x + bounds.width + padding
    && tile.x + tile.width >= bounds.x - padding
    && tile.y <= bounds.y + bounds.height + padding
    && tile.y + tile.height >= bounds.y - padding;
}

export const MASK_RECT_STRIDE = 4;

/**
 * Exact coverage masks for a separate vector or subpixel texture layer.
 * classById maps each province ID to one class: 0 (none), 1 (inferred land),
 * 2 (source projection), 3 (continued border), 4 (sourced major change), or
 * 5 (inferred major change). The caller resolves class priority in advance.
 *
 * Every result tile belongs to one kind. Its Uint32Array rects contains
 * [x, y, width, height] in global source coordinates. Rectangles do not
 * overlap, never cross tiles, and cover exactly the input's nonzero pixels.
 * Cache a Path2D of these rectangles per tile and clip the separately drawn
 * pattern to it. Pattern size can then be subpixel without altering any
 * official province boundary or erasing a one-pixel country or hole.
 *
 * Left and right edge coverage stays separate in source coordinates. Use
 * the same cylindrical copies as the fill; no extra source pixels are added
 * at the seam. Matching runs merge vertically only inside their own tile.
 */
export function buildMaskTiles(idPixels, classById, width, height, { tileSize = 256, maxClass = 5 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || !Number.isInteger(tileSize) || tileSize <= 0 || idPixels?.length !== width * height
    || !classById?.length || !Number.isInteger(maxClass) || maxClass<1 || maxClass>65535) {
    throw new RangeError('Coverage masks require a complete positive-sized province raster and tile size.');
  }
  for (const kind of classById) {
    if (!Number.isInteger(kind) || kind < 0 || kind > maxClass) throw new RangeError(`Coverage mask classes must be integers from 0 through ${maxClass}.`);
  }
  const columns = Math.ceil(width / tileSize), rows = Math.ceil(height / tileSize);
  const tiles = new Array(columns * rows * maxClass);
  // An x coordinate can begin only one run on a row. Remember its previous
  // rectangle to merge matching consecutive rows without a full-size bitmap
  // or per-pixel temporary objects.
  const lastKind = new Uint16Array(width), lastWidth = new Uint32Array(width);
  const lastRow = new Int32Array(width).fill(-1), lastRect = new Uint32Array(width);
  let coveredPixels = 0;
  function addRun(start, end, y, kind) {
    if (!kind) return;
    coveredPixels += end - start;
    const tileY = Math.floor(y / tileSize);
    for (let x = start; x < end;) {
      const tileX = Math.floor(x / tileSize), runEnd = Math.min(end, (tileX + 1) * tileSize);
      const runWidth = runEnd - x, index = (tileY * columns + tileX) * maxClass + kind - 1;
      let tile = tiles[index];
      if (!tile) {
        const tileLeft = tileX * tileSize, tileTop = tileY * tileSize;
        tile = tiles[index] = {
          x: tileLeft, y: tileTop, width: Math.min(tileSize, width - tileLeft),
          height: Math.min(tileSize, height - tileTop), kind, rects: [],
        };
      }
      if (y % tileSize !== 0 && lastRow[x] === y - 1 && lastKind[x] === kind && lastWidth[x] === runWidth) {
        tile.rects[lastRect[x] + 3]++;
      } else {
        lastRect[x] = tile.rects.length;
        tile.rects.push(x, y, runWidth, 1);
      }
      lastRow[x] = y; lastKind[x] = kind; lastWidth[x] = runWidth;
      x = runEnd;
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let start = 0, kind = classById[idPixels[row]] || 0;
    for (let x = 1; x <= width; x++) {
      const next = x < width ? classById[idPixels[row + x]] || 0 : -1;
      if (next !== kind) {
        addRun(start, x, y, kind);
        start = x; kind = next;
      }
    }
  }
  return {
    coveredPixels,
    tiles: tiles.filter(Boolean).map(tile => ({ ...tile, rects: Uint32Array.from(tile.rects) })),
  };
}
