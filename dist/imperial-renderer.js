import {buildMaskTiles,tileVisible} from './map-renderer.js';

// Area fills never alter political ownership, national borders or picking.
export const IMPERIAL_STYLES={
  // Z01 Empire of Anbennar and A58 Dameria, official EU4 country RGBs.
  1:{fill:'#ffffff',colorRgb:[255,255,255]},
  2:{fill:'#00a5bb',colorRgb:[0,165,187]},
  // An external legal claim marks the existing political fill, never imperial control.
  3:{fill:null,colorRgb:null,mark:'#547c85',motif:'bars'},
  4:{fill:'#e7e7e9',colorRgb:[231,231,233],mark:'#77727c',motif:'crosses'},
};
export function buildImperialTiles(idPixels,classes,width,height){
  const fills=buildMaskTiles(idPixels,classes,width,height).tiles.map(tile=>{
    const path=new Path2D();for(let i=0;i<tile.rects.length;i+=4)path.rect(...tile.rects.subarray(i,i+4));
    return {...tile,path};
  });
  return {fills};
}
const patterns=new Map();let patternSignature='';
// World-space dimensions: 11 CSS pixels apart and .85 pixels wide at scale 1.5.
// Only a low-zoom readability floor changes the density; zooming in keeps the
// same world footprint instead of locking marks to a fixed screen distance.
const PATTERN_SPACING=11/1.5,PATTERN_LINE_WIDTH=.85/1.5;
export function imperialPatternLayout(scale,worldWidth){
  if(!(scale>0)||!Number.isFinite(scale)||!(worldWidth>0)||!Number.isFinite(worldWidth))return null;
  const desired=Math.max(PATTERN_SPACING,7/scale);
  const spacing=worldWidth/Math.max(1,Math.round(worldWidth/desired));
  return {spacing,lineWidth:PATTERN_LINE_WIDTH*spacing/PATTERN_SPACING};
}
function imperialPattern(context,kind,scale,pixelRatio,worldWidth){
  const signature=`${scale}:${pixelRatio}:${worldWidth}`;
  if(signature!==patternSignature){patternSignature=signature;patterns.clear();}
  if(patterns.has(kind))return patterns.get(kind);
  const style=IMPERIAL_STYLES[kind],layout=imperialPatternLayout(scale,worldWidth);
  if(!layout)return null;
  const {spacing,lineWidth}=layout;
  const surface=document.createElement('canvas');surface.width=surface.height=Math.max(8,Math.ceil(spacing*scale*pixelRatio));
  const brush=surface.getContext('2d');brush.scale(surface.width/spacing,surface.height/spacing);
  brush.strokeStyle=style.mark;brush.lineWidth=lineWidth;brush.lineCap='butt';brush.beginPath();
  // Short horizontal bars differ from all diagonal evidence hatches.
  brush.moveTo(spacing*.23,spacing*.5);brush.lineTo(spacing*.77,spacing*.5);
  if(style.motif==='crosses'){brush.moveTo(spacing*.5,spacing*.23);brush.lineTo(spacing*.5,spacing*.77);}
  brush.stroke();const pattern=context.createPattern(surface,'repeat');
  pattern.setTransform(new DOMMatrix([spacing/surface.width,0,0,spacing/surface.height,0,0]));patterns.set(kind,pattern);return pattern;
}
export function paintImperialFill(context,tiles,bounds,scale,pixelRatio,worldWidth){
  for(const tile of tiles.fills)if(tileVisible(tile,bounds)){
    const style=IMPERIAL_STYLES[tile.kind];
    if(style.fill){context.fillStyle=style.fill;context.fill(tile.path);}
    if(style.motif){const pattern=imperialPattern(context,tile.kind,scale,pixelRatio,worldWidth);if(pattern){context.fillStyle=pattern;context.fill(tile.path);}}
  }
}
