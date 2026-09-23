// Reviewed continuity spans may resolve the display uncertainty of a political
// state without changing the evidence for its original acquisition or relations.
// This module consumes those spans; it never infers them from missing events.
const DIMENSIONS=new Set(['ownership','relationship']);
const SUPPORT_KINDS=new Set(['anchor-constrained-continuity','attested-interval-completion']);
const text=value=>typeof value==='string'&&value.trim().length>0;

function normalizedChain(chain,owner){
  if(!Array.isArray(chain))return null;
  const result=[],seen=new Set([owner]);let current=owner;
  for(const relation of chain){
    if(!relation||relation.subject!==current||!text(relation.overlord)||seen.has(relation.overlord))return null;
    result.push({subject:relation.subject,overlord:relation.overlord,type:relation.type??null});
    current=relation.overlord;seen.add(current);
  }
  return result;
}

function currentChain(province){
  const evidence=province.basis?.relationshipEvidence;
  if(!Array.isArray(evidence))return null;
  const relations=[];let independent=false,current=province.owner;
  for(const item of evidence){
    if(!item||independent||item.subject!==current)return null;
    if(item.status==='independent'){
      if(item.overlord)return null;
      independent=true;
    }else{
      relations.push(item);current=item.overlord;
    }
  }
  return normalizedChain(relations,province.owner);
}

function matchesSpan(span,province,year,mode,chain){
  if(!span||span.provinceId!==province.id||span.owner!==province.owner||span.mode!==mode)return false;
  if(!Number.isInteger(span.startYear)||!Number.isInteger(span.endYear)||span.startYear>year||span.endYear<year)return false;
  if(!SUPPORT_KINDS.has(span.kind)||!Number.isInteger(span.anchorYear)||!text(span.anchorRecordId)||!text(span.reason))return false;
  if(!Array.isArray(span.sourceIds)||!span.sourceIds.length||!span.sourceIds.every(text))return false;
  if(!Array.isArray(span.dimensions)||!span.dimensions.length||!span.dimensions.every(d=>DIMENSIONS.has(d)))return false;
  if(span.dimensions.includes('relationship')&&!Array.isArray(span.relationChain))return false;
  if(span.relationChain!==undefined){
    const expected=normalizedChain(span.relationChain,province.owner);
    if(!chain||!expected||JSON.stringify(chain)!==JSON.stringify(expected))return false;
  }
  // The compiler must split a reviewed span at an actual transition. This also
  // rejects an old A span after an intervening A -> B -> A restoration.
  const transitions=[];
  if(span.dimensions.includes('ownership'))transitions.push(province.basis?.ownershipBasis?.transitionYear);
  if(span.dimensions.includes('relationship'))transitions.push(...(province.basis?.relationshipEvidence||[]).map(item=>item.transitionYear));
  return !transitions.some(value=>Number.isInteger(value)&&value>span.startYear);
}

function copySupport(span){
  return {...span,dimensions:[...span.dimensions],sourceIds:[...span.sourceIds],
    ...(span.relationChain!==undefined?{relationChain:span.relationChain.map(item=>({...item}))}:{})};
}

/**
 * Apply already-reviewed, inclusive-year spans to one province's display basis.
 *
 * A span has provinceId, startYear, endYear, owner, dimensions, anchorYear,
 * anchorRecordId, sourceIds, kind, reason and mode. A relationship span also
 * requires the complete ordered relationChain; [] denotes independence.
 * `anchored` is a display classification, never a promotion of source evidence.
 */
export function applyTerritoryCertainty(province,year,evidenceMode,spans){
  const basis=province?.basis;
  if(!basis)return province;
  const originalCertainty=basis.originalCertainty??basis.certainty;
  const visible=province.owner&&!province.water&&!province.wasteland&&!province.excluded&&province.coverage!==false;
  const allowed=visible&&Number.isInteger(year)&&['reconstructed','attested'].includes(evidenceMode);
  const chain=allowed?currentChain(province):null;
  const support=allowed&&Array.isArray(spans)?spans.filter(span=>matchesSpan(span,province,year,evidenceMode,chain)):[];
  if(!support.length){
    if(!Object.hasOwn(basis,'certaintySupport')&&basis.certainty===originalCertainty)return province;
    const {certaintySupport,...remaining}=basis;
    return {...province,basis:{...remaining,certainty:originalCertainty}};
  }
  const unresolved=[];
  if(basis.ownershipBasis?.certainty==='hypothesis')unresolved.push('ownership');
  if(Array.isArray(basis.relationshipEvidence)&&basis.relationshipEvidence.some(item=>item?.certainty==='hypothesis'))unresolved.push('relationship');
  const covered=new Set(support.flatMap(span=>span.dimensions));
  // A legacy, unpartitioned hypothesis is not silently treated as ownership
  // alone: an explicit dimension breakdown is required before clearing dots.
  const complete=originalCertainty==='hypothesis'&&basis.ownershipBasis&&chain!==null
    &&unresolved.length>0&&unresolved.every(d=>covered.has(d));
  return {...province,basis:{...basis,originalCertainty,
    certainty:complete?'anchored':originalCertainty,certaintySupport:support.map(copySupport)}};
}
