// Boundary measurements are CSS pixels at this reference camera scale.
// Every map boundary then scales linearly, keeping its footprint fixed in
// source-map coordinates, independently of the political colour mode.
export const BOUNDARY_REFERENCE_SCALE = 1.5;

export function boundaryScale(scale) {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Boundary scaling requires a positive finite camera scale.');
  }
  return scale / BOUNDARY_REFERENCE_SCALE;
}

export function selectionBoundaryWidth(scale, multiplier = 3) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('Boundary width requires a positive finite multiplier.');
  }
  return 1.25 * multiplier * boundaryScale(scale);
}
