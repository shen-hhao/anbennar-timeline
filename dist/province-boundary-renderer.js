import { BORDER_SEGMENT_STRIDE } from './map-renderer.js';

/**
 * Regroup cached province edges by their actual owner and the fills on both
 * sides. This only visits extracted border segments, never the map raster.
 * A political owner can cross an imperial claim boundary, so owner alone is
 * insufficient to choose a contrasting province line in imperial view.
 */
export function buildProvincePaintTiles(sourceTiles, countryTags, imperialClasses = {}) {
  const output = [];
  for (const tile of sourceTiles) {
    if (tile.kind !== 'province') continue;
    const { segments, provincePairs } = tile;
    if (!segments || segments.length % BORDER_SEGMENT_STRIDE
      || (provincePairs != null && provincePairs.length !== segments.length / BORDER_SEGMENT_STRIDE * 2)) {
      throw new RangeError('Province border segments require one province pair per complete segment.');
    }
    const groups = new Map();
    for (let index = 0; index < segments.length; index += BORDER_SEGMENT_STRIDE) {
      const ownerIndex = segments[index + 4];
      if (!Number.isInteger(ownerIndex) || ownerIndex <= 0 || ownerIndex > 0xffffffff
        || ownerIndex !== segments[index + 5] || !countryTags[ownerIndex]) {
        throw new RangeError('Province borders require one known positive owner on both sides.');
      }
      const pairIndex = index / BORDER_SEGMENT_STRIDE * 2;
      const first = provincePairs == null ? 0 : imperialClasses[provincePairs[pairIndex]] ?? 0;
      const second = provincePairs == null ? 0 : imperialClasses[provincePairs[pairIndex + 1]] ?? 0;
      if (![first, second].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) {
        throw new RangeError('Imperial province classes must be unsigned integer indexes.');
      }
      const imperialKinds = first <= second ? [first, second] : [second, first];
      const key = `${ownerIndex}:${imperialKinds[0]}:${imperialKinds[1]}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          x: tile.x, y: tile.y, width: tile.width, height: tile.height, kind: 'province',
          owner: countryTags[ownerIndex], ownerIndex, imperialKinds, segments: [], path: new Path2D(),
        };
        groups.set(key, group);
      }
      group.path.moveTo(segments[index], segments[index + 1]);
      group.path.lineTo(segments[index + 2], segments[index + 3]);
      for (let offset = 0; offset < BORDER_SEGMENT_STRIDE; offset++) group.segments.push(segments[index + offset]);
    }
    for (const group of groups.values()) output.push({ ...group, segments: Uint32Array.from(group.segments) });
  }
  return output;
}
