import {boundaryScale} from './boundary-scale.js';

// Surface categories describe source geography and research coverage, never
// infer an uncolonized province merely from an empty owner in a partial view.
export function surfaceKind(province,countries={}) {
  if(!province)return 3;
  if(province.water)return 0;
  if(province.wasteland)return 2;
  if(province.excluded||province.coverage===false||province.sourceConflict)return 3;
  if(province.owner)return countries[province.owner]?4:3;
  return 1;
}

const SURFACE_COLORS=[[235,243,248],[250,247,239],[215,218,216],[241,242,245],[250,247,239]];
export function surfaceColor(kind){return SURFACE_COLORS[kind]||SURFACE_COLORS[3];}
export function surfaceLabel(kind){return ['海域／湖泊／宽河水面','原件未指定国家控制（原住、部族或地方组织另行记录）','荒地／不可通行地形','未收录／归属待核','已收录领土'][kind]||'未收录／归属待核';}

export function boundaryStyle(kind,scale,multiplier=3,mode='original') {
  if(!Number.isFinite(multiplier)||multiplier<=0)throw new RangeError('Boundary width requires a positive finite multiplier.');
  const factor=boundaryScale(scale),width=.7*multiplier*factor;
  const style=(color,weight,dash,casing)=>({color,width:weight,dash:dash.map(value=>value*factor),casing,
    casingWidth:casing?weight+.2*multiplier*factor:0});
  switch(kind){
    case 'shore': return style('#587f94',width*.85,[],null);
    case 'frontier': return style('#927341',width*.9,[4,3],'#fffaf0b3');
    case 'wasteland': return style('#555e56',width,[7,3,1.5,3],'#ffffffe0');
    case 'uncertain': return style('#898499',width*.8,[8,4],'#ffffffe0');
    default: return style('#30353ae6',width,[],'#ffffffa0');
  }
}
