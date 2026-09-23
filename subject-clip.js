import { buildMaskTiles, MASK_RECT_STRIDE } from './map-renderer.js';

/**
 * Add exact ownership clips to inset subject-border tiles. A single raster
 * pass extracts all requested owners together; every tile for one owner then
 * shares the same Path2D. The caller caches these with its subject geometry.
 *
 * Dense mask classes are separate from country indexes, so indexes above 255
 * (or 65535) remain distinct. A whole-map mask tile avoids allocating a sparse
 * spatial tile array for every possible owner. Only actual rectangles exist.
 *
 * Copies at +/- world width cover insets beside the x=0 cylindrical seam.
 * Latitude never wraps and no neighboring, unowned or hole pixels are added.
 */
export function attachSubjectClipPaths(tiles, idPixels, ownerIndex, width, height) {
  if (!Array.isArray(tiles)) throw new TypeError('Subject clip tiles must be an array.');
  if (!tiles.length) return [];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || idPixels?.length !== width * height || !ownerIndex?.length) {
    throw new RangeError('Subject clips require a complete positive-sized ownership raster.');
  }

  const classes = new Map();
  for (const tile of tiles) {
    const owner = tile?.ownerIndex;
    if (!Number.isInteger(owner) || owner <= 0 || owner > 0xffffffff) {
      throw new RangeError('Subject clip owners must be positive unsigned country indexes.');
    }
    if (!classes.has(owner)) classes.set(owner, classes.size + 1);
  }
  if (classes.size > 65535) throw new RangeError('Subject clips support at most 65535 distinct owners.');

  const classById = new Uint16Array(ownerIndex.length);
  for (let id = 0; id < ownerIndex.length; id++) {
    const owner = ownerIndex[id];
    if (!Number.isInteger(owner) || owner < 0 || owner > 0xffffffff) {
      throw new RangeError('Subject clip ownership must contain unsigned country indexes.');
    }
    classById[id] = classes.get(owner) || 0;
  }
  const masks = buildMaskTiles(idPixels, classById, width, height, {
    tileSize: Math.max(width, height), maxClass: classes.size,
  });
  const paths = Array.from({ length: classes.size + 1 }, () => new Path2D());
  for (const mask of masks.tiles) {
    const path = paths[mask.kind];
    for (let i = 0; i < mask.rects.length; i += MASK_RECT_STRIDE) {
      const x = mask.rects[i], y = mask.rects[i + 1];
      const rectWidth = mask.rects[i + 2], rectHeight = mask.rects[i + 3];
      path.rect(x, y, rectWidth, rectHeight);
      path.rect(x - width, y, rectWidth, rectHeight);
      path.rect(x + width, y, rectWidth, rectHeight);
    }
  }
  return tiles.map(tile => ({ ...tile, clipPath: paths[classes.get(tile.ownerIndex)] }));
}
