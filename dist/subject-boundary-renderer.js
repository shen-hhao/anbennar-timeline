import { BORDER_SEGMENT_STRIDE, tileVisible } from './map-renderer.js';
import { subjectBoundaryStyle } from './subject-boundary.js';
import { boundaryScale } from './boundary-scale.js';

const drawingCache = new WeakMap();

function pathFromPolylines(polylines) {
  const path = new Path2D();
  for (const coordinates of polylines) {
    if (coordinates.length < 4) continue;
    path.moveTo(coordinates[0], coordinates[1]);
    for (let index = 2; index < coordinates.length; index += 2) path.lineTo(coordinates[index], coordinates[index + 1]);
    if (coordinates.length > 4 && coordinates[0] === coordinates.at(-2) && coordinates[1] === coordinates.at(-1)) path.closePath();
  }
  return path;
}

/** Join oriented edges without reversing their country-facing side. */
function traceDirectedPaths(segments) {
  const edges = segments.map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, used: false }));
  const outgoing = new Map(), incoming = new Map();
  const pointKey = (x, y) => `${x},${y}`;
  for (const edge of edges) {
    const start = pointKey(edge.x1, edge.y1), end = pointKey(edge.x2, edge.y2);
    if (!outgoing.has(start)) outgoing.set(start, []);
    outgoing.get(start).push(edge);
    incoming.set(end, (incoming.get(end) || 0) + 1);
  }
  function turnRank(from, to) {
    const ax = from.x2 - from.x1, ay = from.y2 - from.y1;
    const bx = to.x2 - to.x1, by = to.y2 - to.y1;
    const cross = ax * by - ay * bx, dot = ax * bx + ay * by;
    // Screen y increases downwards: a right turn keeps the owned pixel on
    // the same inward side, including two enclaves meeting at one corner.
    return cross > 0 ? 0 : dot > 0 ? 1 : cross < 0 ? 2 : 3;
  }
  const result = [];
  function follow(first) {
    if (first.used) return;
    const coordinates = [first.x1, first.y1];
    let edge = first;
    while (edge && !edge.used) {
      edge.used = true;
      coordinates.push(edge.x2, edge.y2);
      if (edge.x2 === first.x1 && edge.y2 === first.y1) break;
      const choices = (outgoing.get(pointKey(edge.x2, edge.y2)) || []).filter(next => !next.used);
      choices.sort((a, b) => turnRank(edge, a) - turnRank(edge, b));
      edge = choices[0];
    }
    result.push(coordinates);
  }
  // Trace open coast/tile endpoints first, then remaining closed outlines.
  for (const edge of edges) if (!incoming.has(pointKey(edge.x1, edge.y1))) follow(edge);
  for (const edge of edges) follow(edge);
  return result;
}

/** Add each special subject's own inset marker; ordinary borders stay intact. */
export function buildSubjectBorderTiles(borderTiles, countryTags, relations, { worldWidth } = {}) {
  const tiles = [], styles = new Map();
  const knownTags = new Set(countryTags.filter(tag => typeof tag === 'string' && tag.length));
  const relationMap = relations || {};
  function validRelation(tag) {
    const direct = relationMap[tag];
    if (!direct || (direct.subject && direct.subject !== tag) || !knownTags.has(direct.overlord)) return null;
    const seen = new Set([tag]);
    let current = tag;
    while (relationMap[current]) {
      const relation = relationMap[current];
      // Missing remote records do not erase an explicitly valid direct bond.
      if ((relation.subject && relation.subject !== current) || !knownTags.has(relation.overlord)) break;
      if (seen.has(relation.overlord)) return null;
      seen.add(relation.overlord); current = relation.overlord;
    }
    return direct;
  }
  function ownerStyle(owner) {
    if (!styles.has(owner)) styles.set(owner, subjectBoundaryStyle(validRelation(countryTags[owner])));
    return styles.get(owner);
  }
  for (const tile of borderTiles) {
    if (tile.kind !== 'political') continue;
    const groups = new Map();
    for (let index = 0; index < tile.segments.length; index += BORDER_SEGMENT_STRIDE) {
      const [rawX1, rawY1, rawX2, rawY2, ownerA, ownerB] = tile.segments.subarray(index, index + BORDER_SEGMENT_STRIDE);
      if (!ownerA || !ownerB || ownerA === ownerB || !knownTags.has(countryTags[ownerA]) || !knownTags.has(countryTags[ownerB])) continue;
      const horizontal = rawY1 === rawY2 && rawX1 !== rawX2;
      const vertical = rawX1 === rawX2 && rawY1 !== rawY2;
      if (!horizontal && !vertical) continue;
      const x1 = Math.min(rawX1, rawX2), x2 = Math.max(rawX1, rawX2);
      const y1 = Math.min(rawY1, rawY2), y2 = Math.max(rawY1, rawY2);
      for (const owner of [ownerA, ownerB]) {
        const style = ownerStyle(owner);
        if (style.kind === 'normal') continue;
        // Positive offset [-dy, dx] must always point into this owner. A is
        // above a horizontal edge / left of a vertical edge in source data.
        const forward = horizontal ? owner === ownerB : owner === ownerA;
        const seam = vertical && x1 === 0 && owner === ownerA && Number.isFinite(worldWidth) && worldWidth > 0;
        const shift = seam ? worldWidth : 0, key = `${owner}:${seam ? 1 : 0}`;
        if (!groups.has(key)) groups.set(key, { owner, style, seam, segments: [] });
        groups.get(key).segments.push(forward
          ? [x1 + shift, y1, x2 + shift, y2]
          : [x2 + shift, y2, x1 + shift, y1]);
      }
    }
    for (const { owner, style, seam, segments } of groups.values()) {
      const polylines = traceDirectedPaths(segments);
      tiles.push({ x: seam ? worldWidth - 1 : tile.x, y: tile.y,
        width: seam ? 1 : tile.width, height: tile.height,
        kind: 'subject', owner: countryTags[owner], ownerIndex: owner,
        style, polylines, centerPath: pathFromPolylines(polylines) });
    }
  }
  return { tiles };
}

/** Offset a continuous centerline with bounded miters, retaining closed loops. */
export function offsetPolyline(coordinates, offset, miterLimit = 3) {
  if (!Array.isArray(coordinates) || coordinates.length % 2 || !coordinates.every(Number.isFinite)
    || !Number.isFinite(offset) || !Number.isFinite(miterLimit) || miterLimit < 1) {
    throw new RangeError('Parallel border paths require finite coordinates, an offset and a positive miter limit.');
  }
  const points = [];
  for (let index = 0; index < coordinates.length; index += 2) {
    const point = [coordinates[index], coordinates[index + 1]], previous = points.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
  }
  if (points.length < 2) return points.flat();
  const closed = points.length > 2 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  if (closed) points.pop();
  const count = points.length;
  function normal(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
    return [-dy / length, dx / length];
  }
  const moved = points.map((point, index) => {
    const previous = index ? points[index - 1] : closed ? points[count - 1] : null;
    const next = index < count - 1 ? points[index + 1] : closed ? points[0] : null;
    const incoming = previous ? normal(previous, point) : null;
    const outgoing = next ? normal(point, next) : null;
    let dx, dy;
    if (incoming && outgoing) {
      const denominator = 1 + incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
      if (denominator > 1e-8) {
        dx = (incoming[0] + outgoing[0]) * offset / denominator;
        dy = (incoming[1] + outgoing[1]) * offset / denominator;
        const length = Math.hypot(dx, dy), maximum = Math.abs(offset) * miterLimit;
        if (length > maximum) { dx *= maximum / length; dy *= maximum / length; }
      } else { dx = outgoing[0] * offset; dy = outgoing[1] * offset; }
    } else {
      const direction = incoming || outgoing;
      dx = direction[0] * offset; dy = direction[1] * offset;
    }
    return [point[0] + dx, point[1] + dy];
  });
  if (closed) moved.push([...moved[0]]);
  return moved.flat();
}

function drawingFor(tile, scale, factor) {
  const key = `${scale}:${factor}`;
  let cached = drawingCache.get(tile);
  if (cached?.key === key) return cached;
  // lines[0] is the ordinary national-border sample used by the legend.
  // It is drawn separately from the untouched source border paths.
  const lines = tile.style.lines.slice(1).map(line => ({
    path: pathFromPolylines(tile.polylines.map(polyline => offsetPolyline(polyline, line.offset * factor / scale))),
    width: line.width * factor / scale,
    haloWidth: (line.width + .6) * factor / scale,
    dash: line.dash.map(value => value * factor / scale),
  }));
  cached = { key, lines };
  drawingCache.set(tile, cached);
  return cached;
}

/** Draw subject-side markers before the caller paints every normal border. */
export function paintSubjectBorders(context, tiles, bounds, scale, borderWeight = 3) {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(borderWeight) || borderWeight <= 0) {
    throw new RangeError('Subject borders require a positive camera scale and border weight.');
  }
  const factor = borderWeight / 3 * boundaryScale(scale);
  // Never render an unbounded inset: narrow islands, enclaves and concave
  // corners can put an offset outside the owner's exact raster mask.
  const visible = tiles.filter(tile => tile.clipPath && tileVisible(tile, bounds, 5 * factor / scale));
  if (!visible.length) return;
  context.save();
  context.lineJoin = 'round'; context.lineCap = 'round'; context.lineDashOffset = 0;
  // Paint all narrow marker casings first. No casing follows a centerline,
  // crosses into another country or removes a preceding marker at a join.
  for (const halo of [true, false]) {
    for (const tile of visible) {
      context.save(); context.clip(tile.clipPath);
      context.strokeStyle = halo ? tile.style.halo : tile.style.color;
      for (const line of drawingFor(tile, scale, factor).lines) {
        context.lineWidth = halo ? line.haloWidth : line.width;
        context.setLineDash(halo ? [] : line.dash);
        context.stroke(line.path);
      }
      context.restore();
    }
  }
  context.restore();
}
