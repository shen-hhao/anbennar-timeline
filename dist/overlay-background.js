import {resolveColor} from './model.js';
import {IMPERIAL_STYLES} from './imperial-renderer.js';

export function compositeRgb(background,foreground,alpha){return background.map((v,i)=>v*(1-alpha)+foreground[i]*alpha);}
export function overlayBackground(tile,countries,relations,mode,{imperial=false,selected=null}={}){
  let rgb=resolveColor(tile.owner,countries,relations,mode);
  if(imperial){
    // External claims have no opaque fill: contrast still follows the actual
    // country/overlord colour underneath their transparent horizontal marks.
    const fill=IMPERIAL_STYLES[tile.imperialKind]?.colorRgb;
    if(fill)rgb=[...fill];
  }
  if(selected===tile.owner)rgb=compositeRgb(rgb,[255,255,255],35/255);
  return rgb;
}
