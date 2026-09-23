import {contrastingComplementRGB, contrastRatio} from './overlay-contrast.js';
import {boundaryScale} from './boundary-scale.js';

const DEFAULT_BACKGROUND = [242, 242, 242];

// Width is in CSS pixels; the map renderer divides it by its current scale.
// Keep province lines subtler than national borders through width, rather than
// translucent grey that disappears against similarly coloured territories.
export function provinceBoundaryStyle(backgroundRGB, scale, multiplier = 1) {
  const validRGB = (Array.isArray(backgroundRGB) || ArrayBuffer.isView(backgroundRGB))
    && backgroundRGB.length >= 3
    && Array.from(backgroundRGB).slice(0, 3).every(Number.isFinite);
  const background = validRGB
    ? Array.from(backgroundRGB).slice(0, 3).map(value => Math.max(0, Math.min(255, value)))
    : DEFAULT_BACKGROUND;
  const colorRgb = contrastingComplementRGB(background);
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const weight = Number.isFinite(multiplier) && multiplier > 0
    ? Math.min(3, Math.max(1, multiplier)) : 1;
  return {
    color: '#' + colorRgb.map(value => value.toString(16).padStart(2, '0')).join(''),
    colorRgb,
    width: .35 * weight * boundaryScale(zoom),
    contrastRatio: contrastRatio(colorRgb, background),
  };
}
