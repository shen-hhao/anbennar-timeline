import { evidencePattern } from './evidence.js';

// sRGB relative luminance and contrast ratio use the WCAG 2.2 definition.
// The 4.5 target is an engineering choice for tiny map marks, not a claim that
// antialiased edge pixels or the entire map have been accessibility-certified.
export const EVIDENCE_CONTRAST_TARGET = 4.5;
const INK_TARGET = EVIDENCE_CONTRAST_TARGET + .05;
const LEGACY_HALO = 'rgba(255,255,255,.45)';

function linearChannel(value) {
  const channel=value/255;
  return channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4;
}

function encodedChannel(value) {
  return 255*(value<=.0031308 ? value*12.92 : 1.055*value**(1/2.4)-.055);
}

function luminanceOfLinear(rgb) {
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}

function normalizedRGB(value) {
  if (!(Array.isArray(value) || ArrayBuffer.isView(value)) || value.length < 3) return null;
  const rgb = Array.from(value).slice(0,3);
  return rgb.every(Number.isFinite) ? rgb.map(n=>Math.max(0,Math.min(255,n))) : null;
}

export function relativeLuminance(rgb) {
  const normalized = normalizedRGB(rgb);
  if (!normalized) return null;
  return luminanceOfLinear(normalized.map(linearChannel));
}

export function contrastRatio(first, second) {
  const a=relativeLuminance(first),b=relativeLuminance(second);
  return a===null||b===null ? null : (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

function cssHex(rgb) {
  return '#'+rgb.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
}

// An RGB -> RGB transform, not a light/dark palette lookup. Start from the
// channel complement and preserve its linear-light hue while moving it toward
// the nearest usable lightness. Pale blue therefore receives brown marks,
// pink receives green, yellow receives blue, and so on. The contrast constraint
// is checked against both the composited float RGB and its painted 8-bit RGB.
//
// Complement and lightness solving are continuous within either contrast
// branch. Changing between the required light/dark branches must jump: the
// intermediate low-contrast colours cannot meet the 4.5 constraint. Rounding
// also means distinct backgrounds are not promised unique 8-bit foregrounds.
// Maximising only luminance contrast would collapse this back to black/white;
// instead retain as much of the varying complement as the contrast allows.
export function contrastingComplementRGB(backgroundRGB) {
  const background=normalizedRGB(backgroundRGB);
  if (!background) return null;
  const luminances=[relativeLuminance(background),relativeLuminance(background.map(Math.round))];
  const low=Math.min(...luminances),high=Math.max(...luminances);
  const contrastAt=luminance=>Math.min(...luminances.map(bg=>
    (Math.max(luminance,bg)+.05)/(Math.min(luminance,bg)+.05)));
  const contrastOf=rgb=>contrastAt(luminanceOfLinear(rgb.map(linearChannel)));
  const complement=background.map(n=>255-n);
  const rounded=complement.map(Math.round);
  if (contrastOf(rounded)>=INK_TARGET) return rounded;

  const blackContrast=contrastAt(0),whiteContrast=contrastAt(1);
  const dark=blackContrast>=whiteContrast;
  // The small middle-luminance interval may not admit the full safety margin;
  // use the attainable contrast without ever lowering the actual 4.5 target.
  const target=Math.min(INK_TARGET,Math.max(blackContrast,whiteContrast));
  const targetLuminance=dark?(low+.05)/target-.05:target*(high+.05)-.05;
  const linear=complement.map(linearChannel),current=luminanceOfLinear(linear);
  const amount=dark?targetLuminance/current:(targetLuminance-current)/(1-current);
  const ink=linear.map(channel=>Math.round(encodedChannel(Math.max(0,Math.min(1,
    dark?channel*amount:channel+(1-channel)*amount)))));
  // Correct only the final 8-bit rounding error; no country-specific exceptions.
  while(contrastOf(ink)<target){
    const next=ink.map(channel=>Math.max(0,Math.min(255,channel+(dark?-1:1))));
    if(next.every((channel,i)=>channel===ink[i]))break;
    ink.splice(0,3,...next);
  }
  return ink;
}

// Shape and world-space dimensions always come from evidencePattern. Colour
// adapts solely to the already-composited fill; it never encodes certainty.
// Missing background retains the original palette for older callers.
export function adaptiveEvidenceStyle(kindName, backgroundRGB) {
  const shape=evidencePattern(kindName);
  if (!shape) return null;
  const background=normalizedRGB(backgroundRGB);
  if (!background) return {...shape,halo:LEGACY_HALO,adaptive:false,contrastRatio:null};
  const colorRgb=contrastingComplementRGB(background);
  const light=relativeLuminance(colorRgb)>relativeLuminance(background);
  return {...shape,color:cssHex(colorRgb),colorRgb:[...colorRgb],
    halo:light?'rgba(0,0,0,.5)':'rgba(255,255,255,.65)',
    ...(kindName==='continued'?{hollow:true}:{}),
    adaptive:true,contrastRatio:contrastRatio(colorRgb,background)};
}
