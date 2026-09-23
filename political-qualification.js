// These marks describe a reviewed display hypothesis, never new source sovereignty.
export function qualifyProvince(province, qualifications, actors, year, evidence) {
  if(evidence!=='reconstructed')return province;
  const rows=qualifications.filter(q=>q.provinceIds.includes(province.id)&&q.fromYear<=year&&year<=q.throughYear);
  if(!rows.length)return province;
  if(rows.length!==1)throw new Error(`Overlapping political display qualifications: ${province.id}/${year}`);
  const q=rows[0];
  if(!province.owner||!q.visibleText||!q.id)throw new Error(`Invalid political display qualification: ${province.id}/${year}`);
  const secondary=q.secondaryDisplayRole==='concurrent-control'&&q.displaySecondaryOwner!==province.owner&&actors[q.displaySecondaryOwner]?.color?q.displaySecondaryOwner:null;
  return {...province,politicalQualification:{...q,secondaryColor:secondary?actors[secondary].color:null,
    historicalSovereigntyConfirmed:false},basis:{...province.basis,certainty:'hypothesis',displayQualificationId:q.id}};
}

export function qualifiedPixelColor(qualification,color,x,y,enabled=true) {
  if(!enabled||!qualification||((Math.floor(x)+Math.floor(y))%10)<6)return color;
  // A second polity is a schematic stripe, not a surveyed internal border.
  return qualification.secondaryColor||color.map(v=>Math.max(0,Math.round(v*.55)));
}

// Texture is a viewing preference, separate from the historical qualification.
const preferenceKey='atlas:qualification-stripes';
export function loadQualificationPreference() {
  try{return globalThis.localStorage?.getItem(preferenceKey)==='true';}catch{return false;}
}
export function saveQualificationPreference(enabled) {
  try{globalThis.localStorage?.setItem(preferenceKey,String(Boolean(enabled)));}catch{/* Browsing remains usable without storage. */}
}
export function qualificationPaintSignature(view) {
  return Object.values(view?.provinces||{}).filter(p=>p.owner&&p.politicalQualification)
    .map(p=>[p.id,p.politicalQualification.id,p.politicalQualification.secondaryColor||null])
    .sort((a,b)=>a[0]-b[0]).map(JSON.stringify).join('|');
}
export function qualificationSummary(view,enabled=false) {
  return enabled&&Object.values(view?.provinces||{}).some(p=>p.politicalQualification&&p.owner)
    ?'彩色条纹：分治或范围待核 · 详见省份说明':'';
}
// Only current display-policy wording is adapted; originals and evidence are retained.
export function qualificationDisplayText(text) {
  return String(text??'').replaceAll('彩色条纹不是1820整省主权确证','此处有界续接不是1820整省主权确证')
    .replaceAll('以彩色条纹延续1819方案','有界延续1819方案（彩色条纹可在图层中开启）');
}
