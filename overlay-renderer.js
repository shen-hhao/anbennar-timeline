import { adaptiveEvidenceStyle } from './overlay-contrast.js';

export const OVERLAY_NAMES = ['', 'hypothesis', 'reconstructed', 'continued', 'attested-change', 'inferred-change'];

// A texture's coordinates are independent of the source bitmap. Three times
// denser symbols therefore do not require a nine-times-larger ownership map.
export function patternLayout(style, scale, worldWidth) {
  if (!style || !(scale > 0) || !Number.isFinite(scale) || !(worldWidth > 0)) return null;
  const dots = style.motif === 'triangular-dots';
  const desired = Math.max(dots ? 4.5 : 7, Math.min(dots ? 12 : 15, style.spacing * scale)) / scale;
  const horizontalPeriod = dots ? desired : desired * Math.SQRT2;
  // Fit an integer number of repeats around the cylinder to avoid a texture
  // jump at the original longitude seam. The density adjustment is negligible.
  const width = worldWidth / Math.max(1, Math.round(worldWidth / horizontalPeriod));
  const spacing = dots ? width : width / Math.SQRT2;
  const factor = spacing / style.spacing;
  return { width, height: dots ? spacing * Math.sqrt(3) : width, spacing,
    radius: (style.radius || 0) * factor, lineWidth: (style.lineWidth || 0) * factor,
    pairGap: (style.pairGap || 0) * factor };
}

export function paintPatternTile(context, style, layout) {
  const {width, height, radius, lineWidth, pairGap} = layout;
  const halo=style.halo===undefined?'rgba(255,255,255,.45)':style.halo;
  context.fillStyle = style.color;
  context.strokeStyle = style.color;
  if (style.motif === 'triangular-dots') {
    // Circular marks, not triangle-shaped marks: every point has six equally
    // distant neighbours. Include edge copies so the repeat stays seamless.
    context.beginPath();
    for (const [x, y] of [[0,0],[width,0],[width/2,height/2],[0,height],[width,height]]) {
      context.moveTo(x + radius, y);context.arc(x,y,radius,0,Math.PI*2);
    }
    if(style.hollow){
      // Continuations use open circles, so adapting both dark/light palettes
      // cannot make them visually identical to solid hypothesis dots.
      if(halo){context.strokeStyle=halo;context.lineWidth=radius*.95;context.stroke();}
      context.strokeStyle=style.color;context.lineWidth=radius*.5;context.stroke();
    }else{
      if(halo){context.strokeStyle=halo;context.lineWidth=radius*.45;context.stroke();}
      context.fill();
    }
  } else {
    context.lineWidth = lineWidth;
    context.lineCap = 'butt';
    const offsets = style.motif === 'double-hatch' ? [-pairGap/Math.SQRT2, pairGap/Math.SQRT2] : [0];
    context.beginPath();
    for (let repeat=-2; repeat<=2; repeat++) for (const offset of offsets) {
      const intercept = repeat*width + offset;
      context.moveTo(intercept-width,-height);context.lineTo(intercept+2*width,2*height);
    }
    // Keylines switch with the foreground; the caller supplies the actual fill
    // after country, subject, imperial-zone and selection colouring.
    if(halo){context.strokeStyle=halo;context.lineWidth=lineWidth*1.8;context.stroke();}
    context.strokeStyle=style.color;context.lineWidth=lineWidth;context.stroke();
  }
}

export function createOverlayPainter(makeCanvas = () => document.createElement('canvas')) {
  let signature = '', patterns = new Map();
  const styles=new Map();
  return {
    fill(context, tile, scale, pixelRatio, worldWidth) {
      const nextSignature = `${scale}:${pixelRatio}:${worldWidth}`;
      if (signature !== nextSignature) {signature=nextSignature;patterns.clear();}
      const styleKey=`${tile.kind}:${tile.background?.join?.(',')??'legacy'}`;
      let style=styles.get(styleKey);
      if(!style){
        style=adaptiveEvidenceStyle(OVERLAY_NAMES[tile.kind],tile.background);
        if(styles.size>=4096)styles.clear();
        if(style)styles.set(styleKey,style);
      }
      if(!style)return;
      const key=`${tile.kind}:${style.color}:${style.halo}:${Boolean(style.hollow)}`;
      let pattern = patterns.get(key);
      if (!pattern) {
        const layout = patternLayout(style,scale,worldWidth);
        if (!layout) return;
        const surface = makeCanvas();
        surface.width = Math.max(4,Math.ceil(layout.width*scale*pixelRatio));
        surface.height = Math.max(4,Math.ceil(layout.height*scale*pixelRatio));
        const brush = surface.getContext('2d');
        brush.setTransform(surface.width/layout.width,0,0,surface.height/layout.height,0,0);
        paintPatternTile(brush,style,layout);
        pattern=context.createPattern(surface,'repeat');
        pattern.setTransform(new DOMMatrix([layout.width/surface.width,0,0,layout.height/surface.height,0,0]));
        patterns.set(key,pattern);
      }
      context.fillStyle=pattern;context.fill(tile.path);
    },
  };
}
