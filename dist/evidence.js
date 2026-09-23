// Evidence is attached to each province, never inferred from its national colour.
export function territoryEvidence(province, year) {
  if (!province || province.water || province.wasteland || province.excluded || province.coverage === false) return 'unrecorded';
  if (!province.owner && province.ownerStatus !== 'explicit_none') return 'unrecorded';
  if (year === 1444) return 'setup';
  if (year === 1820 && !province.basis?.certainty) return 'setup';
  return province.basis?.certainty || 'continued';
}
export function evidenceCounts(atlas) {
  const counts = {setup:0, hypothesis:0, reconstructed:0, anchored:0, continued:0};
  for (const p of Object.values(atlas.provinces)) {
    const kind = territoryEvidence(p, atlas.year);
    if (kind in counts) counts[kind]++;
  }
  return counts;
}

const SPACING = 8 / 3;
const COLORS = Object.freeze({
  hypothesis:Object.freeze([124,75,9,.72]),
  reconstructed:Object.freeze([54,89,119,.38]),
  continued:Object.freeze([255,255,255,.72]),
  'attested-change':Object.freeze([57,65,73,170/255]),
  'inferred-change':Object.freeze([155,91,13,195/255]),
});
const PATTERNS = Object.freeze(Object.fromEntries(Object.entries({
  hypothesis:{motif:'triangular-dots',radius:.32,rowHeight:SPACING*Math.sqrt(3)/2},
  reconstructed:{motif:'single-hatch',lineWidth:.22},
  continued:{motif:'triangular-dots',radius:.32,rowHeight:SPACING*Math.sqrt(3)/2},
  'attested-change':{motif:'single-hatch',lineWidth:.36},
  'inferred-change':{motif:'double-hatch',lineWidth:.27,pairGap:.7},
}).map(([kind,shape])=>[kind,Object.freeze({
  ...shape,color:`rgba(${COLORS[kind].join(',')})`,spacing:SPACING,
})])));

// Dimensions are in original map units, independent of display resolution.
// Dots use alternating half-spacing row offsets. Hatch spacing and pairGap
// measure perpendicular distances; double hatches are continuous parallel lines.
export function evidencePattern(kind) {
  return Object.hasOwn(PATTERNS,kind) ? PATTERNS[kind] : null;
}

// A changeKind is supplied only for an already validated, current-year political
// change. Its overlay replaces persistent evidence instead of stacking on it.
// 0 none; 1 hypothesis; 2 source reconstruction; 3 continuation;
// 4 attested change; 5 inferred change.
export function classifyOverlay(province, year, layers = {}, changeKind = null) {
  const evidence = territoryEvidence(province, year);
  if (evidence === 'unrecorded') return 0;
  if (layers?.changes) {
    if (changeKind === 'hypothesis') return 5;
    if (changeKind === 'attested') return 4;
  }
  if (evidence === 'hypothesis' && layers?.hypothesis) return 1;
  if (['reconstructed','anchored'].includes(evidence) && layers?.projection) return 2;
  if (evidence === 'continued' && layers?.continued) return 3;
  return 0;
}

// Replay order matters: a later effective record replaces the earlier state.
// An explicit ownership observation can also confirm this year's inferred
// transfer without inventing an additional transfer of its own.
export function annualChangeEvidence(changes, provinces, year) {
  const result=new Map();
  for(const change of changes)for(const id of change.changedProvinceIds)result.set(id,{kind:change.evidenceKind==='hypothesis'?'hypothesis':'attested',recordId:change.id,sequence:change.sequence});
  for(const [id,change] of result){
    const basis=provinces[id]?.basis;
    const dimensions=[basis?.ownershipBasis,...(basis?.relationshipEvidence||[])].filter(Boolean);
    const current=dimensions.filter(item=>item.transitionYear===year);
    const unresolved=current.filter(item=>item.transitionEvidenceKind==='hypothesis');
    if(unresolved.length){
      const latest=unresolved.reduce((a,b)=>(a.sequence??-1)>(b.sequence??-1)?a:b);
      result.set(id,{...change,kind:'hypothesis',recordId:latest.transitionRecordId});
    }else{
      const confirmation=current.find(item=>item.transitionConfirmationRecordId);
      if(confirmation)result.set(id,{...change,kind:'attested',recordId:confirmation.transitionConfirmationRecordId});
    }
  }
  return result;
}

function patternContains(pattern, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (pattern.motif === 'triangular-dots') {
    const row = Math.round(y / pattern.rowHeight);
    const offset = ((row % 2 + 2) % 2) * pattern.spacing / 2;
    const column = Math.round((x - offset) / pattern.spacing);
    const dx = x - column * pattern.spacing - offset, dy = y - row * pattern.rowHeight;
    return dx * dx + dy * dy <= pattern.radius * pattern.radius;
  }
  const perpendicular = (x - y) / Math.SQRT2;
  const offsets = pattern.motif === 'double-hatch' ? [-pattern.pairGap/2,pattern.pairGap/2] : [0];
  return offsets.some(offset=>{
    const distance = perpendicular - offset;
    return Math.abs(distance - Math.round(distance / pattern.spacing) * pattern.spacing) <= pattern.lineWidth / 2;
  });
}

// Compatibility sampler for consumers that still need a single source pixel.
// The map renderer uses evidencePattern directly for resolution-independent marks.
export function evidencePixel(kind, x, y, options = {}) {
  const enabled = kind === 'hypothesis' ? options?.hypothesis
    : kind === 'reconstructed' ? options?.projection
    : kind === 'continued' ? options?.continued
    : kind === 'attested-change' || kind === 'inferred-change' ? options?.changes : false;
  const pattern = evidencePattern(kind);
  return enabled && pattern && patternContains(pattern,x,y) ? [...COLORS[kind]] : null;
}
export function majorChangeStyle(change) {
  const inferred = change.evidenceKind === 'hypothesis';
  const {color,...shape} = evidencePattern(inferred ? 'inferred-change' : 'attested-change');
  return inferred
    ? {...shape, kind:'hypothesis', color:[155,91,13], lineAlpha:195, fillAlpha:32}
    : {...shape, kind:'attested', color:[57,65,73], lineAlpha:170, fillAlpha:38};
}
