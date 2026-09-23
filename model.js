export const FIRST_YEAR = 1444;
export const LAST_YEAR = 1820;
export function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR;
}
export function visibleProvince(province) {
  return !!province && !province.water && !province.wasteland && !province.excluded && !!province.owner;
}
export function mixWhite(rgb, amount) {
  return rgb.map(channel => Math.round(channel + (255 - channel) * amount));
}
const pastelCache = new Map();
function linearChannel(value) {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}
function encodedChannel(value) {
  return 255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055);
}
function labToLinear(L, a, b) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.7076147010 * s,
  ];
}
// Keep the source hue and relative lightness in a bounded, readable pastel range.
// Chroma is reduced along the same hue when needed to fit the sRGB gamut.
export function pastelColor(rgb) {
  const source = Array.isArray(rgb) && rgb.length === 3 && rgb.every(Number.isFinite)
    ? rgb.map(value => Math.max(0, Math.min(255, value))) : [160, 160, 160];
  const key = source.join(',');
  if (pastelCache.has(key)) return [...pastelCache.get(key)];
  const [r, g, blue] = source.map(linearChannel);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * blue);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * blue);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * blue);
  const L = .2104542553 * l + .7936177850 * m - .0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
  const b = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  const lightness = .70 + .19 * L;
  const chroma = Math.hypot(a, b);
  let chromaScale = chroma ? Math.min(.74, .15 / chroma) : 0;
  let linear = labToLinear(lightness, a * chromaScale, b * chromaScale);
  if (linear.some(value => value < 0 || value > 1)) {
    let low = 0, high = chromaScale;
    for (let step = 0; step < 18; step++) {
      const middle = (low + high) / 2;
      const candidate = labToLinear(lightness, a * middle, b * middle);
      if (candidate.every(value => value >= 0 && value <= 1)) low = middle;
      else high = middle;
    }
    chromaScale = low;
    linear = labToLinear(lightness, a * chromaScale, b * chromaScale);
  }
  const result = linear.map(value => Math.round(encodedChannel(Math.max(0, Math.min(1, value)))));
  pastelCache.set(key, result);
  return [...result];
}
export function resolveSourceColor(tag, countries, relations, mode) {
  const base = countries[tag]?.color || [160,160,160];
  if (mode !== 'subjects' || !relations[tag]) return base;
  let current = tag;
  const seen = new Set();
  while (relations[current]) {
    if (seen.has(current)) return base;
    seen.add(current);
    const relation = relations[current];
    if (!countries[relation.overlord]) return base;
    current = relation.overlord;
  }
  return countries[current].color || base;
}
export function resolveColor(tag, countries, relations, mode, palette = 'pastel') {
  const source = resolveSourceColor(tag, countries, relations, mode);
  return palette === 'source' ? source : pastelColor(source);
}
export function countryName(country) { return country?.nameZh || country?.name || country?.tag || ''; }
export function searchableCountries(countries, query) {
  const q = query.trim().toLocaleLowerCase();
  return Object.values(countries).filter(c => c.provinceIds?.length && `${c.nameZh || ''} ${c.name || ''} ${c.tag} ${c.eu4Tag || ''}`.toLocaleLowerCase().includes(q)).sort((a,b) => {
    const aExact = [a.tag,a.name,a.nameZh,a.eu4Tag].some(v => v?.toLocaleLowerCase() === q);
    const bExact = [b.tag,b.name,b.nameZh,b.eu4Tag].some(v => v?.toLocaleLowerCase() === q);
    return Number(bExact) - Number(aExact) || (b.provinceIds.length-a.provinceIds.length) || a.tag.localeCompare(b.tag);
  });
}
