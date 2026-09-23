import {qualifyProvince} from './political-qualification.js';
import { FIRST_YEAR } from './model.js';
import { applyTerritoryCertainty } from './territory-certainty.js';

export function eraAtYear(eras, year) {
  return [...(eras?.eras || [])].reverse().find(era => year >= era.displayStart) || null;
}

export function stepChanges(step,evidence='reconstructed') {
  if(evidence==='confirmed'||(evidence==='attested'&&step.evidenceKind==='hypothesis'))return [];
  return step.changedProvinceIdsByEvidence?.[evidence] || step.changedProvinceIds || [];
}

// Importance and the retired `highlight` flag describe the record, not whether
// an actual provincial transition needs a current-year evidence pattern.
export function territorialStepChanges(step,evidence='reconstructed') {
  if(step.paint===false)return [];
  const changes=stepChanges(step,evidence);
  if(step.territorialChangeProvinceIdsByEvidence)return changes.filter(id=>step.territorialChangeProvinceIdsByEvidence[evidence]?.includes(id));
  if(step.renameActors?.length&&!step.updates?.length&&!step.relations?.length&&!step.removeRelations?.length)return [];
  return changes;
}

export function countryRecords(chronology, tag, year) {
  const aliases=new Set([tag]);
  for(const step of [...(chronology?.steps || [])].reverse()) {
    if(step.year>year)continue;
    for(const rename of step.renameActors || [])if(aliases.has(rename.to))aliases.add(rename.from);
  }
  return (chronology?.steps || []).filter(step=>step.year<=year&&step.affectedActors?.some(actor=>aliases.has(actor))).reverse();
}

export function provinceCoverageNote(province, view) {
  if(!province || province.water || province.wasteland)return null;
  if(province.politicalQualification)return province.politicalQualification.visibleText;
  if(province.coverageWithheld)return province.coverageWithheld.reason;
  if(province.remoteCorrespondence)return '未找到有效Vic3陆地对应。'+province.remoteCorrespondence.reasoning;
  if(province.sourceConflict)return '源文件给出了互相冲突的归属，暂不指定所有者。';
  if(view.sourceGeometry==='vic3'&&province.coverage===false)return '1820 开局尚未可靠映射到这块 EU4 省形，或当前资料模式隐藏其推定归属；空白不表示无主。';
  if(province.excludedReasons?.some(reason=>reason==='unreleased'||reason==='insyaa') || province.superregion==='insyaa_superregion')return '这片地区暂未纳入历史重建。';
  if(province.coverage===false || province.excludedReasons?.includes('outside_cannor_coverage'))return view.coverage?.type==='none'?'当前仅显示确证资料；这一年的推定归属已隐藏。':'这一年的归属尚未收录；空白不表示历史上无主。';
  if(!province.owner&&province.ownerStatus==='explicit_none')return '此阶段已记录原控制者撤出；居民、氏族权利及后续控制另行考证。';
  if(!province.owner)return '所用来源未指定国家控制者；这不表示无人居住。'+
    (province.populationSourceObservation?.culture==='flamemarked_gnoll'?'1444开局记载焰印豺狼人文化与本土居民；这不等于已有统一的焰印国家。':'');
  return null;
}

export function buildReconstruction(base, relations, chronology, year, evidence = 'reconstructed') {
  if (year === FIRST_YEAR) return {...base,year,relations,geometryKey:'eu4',signature:'eu4:1444',coverage:{type:'setup',title:'开局版图',description:'1444.11.11 · EU4 开局文件'}};
  if (!chronology || year < chronology.startYear || year > chronology.endYear || evidence === 'confirmed') {
    return emptyView(base,year);
  }
  const withdrawals=(chronology.withdrawals || []).filter(w=>year>=w.startYear&&(w.endYear===undefined||year<=w.endYear)&&(!w.modes||w.modes.includes(evidence)));
  const included = new Set(chronology.coverageProvinceIds);
  for(const withdrawal of withdrawals)for(const id of withdrawal.provinceIds)included.delete(id);
  const owners = Object.fromEntries([...included].map(id => [id,base.provinces[id]?.owner || null]));
  const ownerStatuses=Object.fromEntries([...included].map(id=>[id,base.provinces[id]?.ownerStatus||(owners[id]?'state_owner':'source_unspecified')]));
  const settlementStates=Object.fromEntries([...included].map(id=>[id,base.provinces[id]?.settlementState||{status:'source_unspecified'}]));
  const settlementBases={};
  // A province's owner and its owner's diplomatic chain have independent
  // evidence. Confirming one must not silently confirm the other.
  const ownershipBases=Object.fromEntries([...included].map(id=>[id,{
    year:FIRST_YEAR,title:'1444 开局',certainty:'continued',evidenceKind:'attested',
    transitionYear:FIRST_YEAR,transitionEvidenceKind:'attested',
    ...(owners[id]?{recordId:`setup-${owners[id]}`,transitionRecordId:`setup-${owners[id]}`,observedOwner:owners[id]}:{}),
  }]));
  const ownershipObservations={};
  const actorMetadata={};
  const applied = chronology.steps.filter(step => step.year <= year && step.paint !== false && (evidence!=='attested'||step.evidenceKind!=='hypothesis'));
  let currentRelations = structuredClone(relations);
  let relationBases=Object.fromEntries(Object.entries(relations).map(([subject,relation])=>[subject,{
    year:FIRST_YEAR,title:'1444 开局关系',certainty:relation.certainty==='hypothesis'?'hypothesis':'continued',
    evidenceKind:relation.certainty==='hypothesis'?'hypothesis':'attested',recordId:`setup-${subject}`,status:'subject',
    transitionYear:FIRST_YEAR,transitionRecordId:`setup-${subject}`,transitionEvidenceKind:relation.certainty==='hypothesis'?'hypothesis':'attested',
  }]));
  const observation=(step,sequence,extra={})=>({
    year:step.year,sequence,title:step.title,sourceId:step.sourceId,recordId:step.id,notes:step.geometryNote,
    evidenceKind:step.evidenceKind==='hypothesis'?'hypothesis':'attested',
    certainty:step.evidenceKind==='hypothesis'?'hypothesis':'reconstructed',...extra,
  });
  const confirmsCurrentTransition=(previous,step,evidenceKind)=>previous?.transitionYear===step.year
    &&evidenceKind==='attested'&&step.confirmsTerritorialChange===true&&step.dateEvidence?.exactYear===step.year;
  const transitionEvidence=(previous,step,changed,evidenceKind)=>{
    if(changed)return {transitionYear:step.year,transitionRecordId:step.id,transitionEvidenceKind:evidenceKind};
    const retained=Object.fromEntries(['transitionYear','transitionRecordId','transitionEvidenceKind','transitionConfirmationRecordId'].filter(key=>previous?.[key]!==undefined).map(key=>[key,previous[key]]));
    // A location observed this year does not date the transfer. Only a
    // separately explicit exact-year change confirmation can upgrade that fact.
    return confirmsCurrentTransition(previous,step,evidenceKind)
      ?{...retained,transitionEvidenceKind:'attested',transitionConfirmationRecordId:step.id}:retained;
  };
  const relationshipEvidenceFor=owner=>{
    const result=[],seen=new Set();let tag=owner;
    while(currentRelations[tag]&&!seen.has(tag)){
      seen.add(tag);const relation=currentRelations[tag];
      result.push({...relationBases[tag],subject:tag,overlord:relation.overlord,type:relation.type,status:'subject'});
      tag=relation.overlord;
    }
    // A removed tie can mean either independence or an explicitly unresolved
    // successor relation. Preserve that distinction even without an edge.
    if(!currentRelations[tag]&&['independent','unknown'].includes(relationBases[tag]?.status))result.push({...relationBases[tag],subject:tag});
    return result;
  };
  const combinedCertainty=(ownership,relationshipEvidence)=>{
    const certainties=[ownership.certainty,...relationshipEvidence.map(item=>item.certainty)];
    return certainties.includes('hypothesis')?'hypothesis':certainties.includes('reconstructed')?'reconstructed':'continued';
  };
  const basis=Object.fromEntries([...included].map(id=>{
    const relationshipEvidence=relationshipEvidenceFor(owners[id]);
    return [id,{year:FIRST_YEAR,title:'1444 开局',certainty:combinedCertainty(ownershipBases[id],relationshipEvidence),ownershipBasis:ownershipBases[id],relationshipEvidence}];
  }));
  for (const step of applied) {
    const sequence=chronology.steps.indexOf(step);
    const identityChanges=stepChanges(step,evidence).filter(id=>!territorialStepChanges(step,evidence).includes(id));
    const touchedOwners=new Set(),identityObservations=new Map();
    const relationsBeforeStep={...currentRelations},relationBasesBeforeStep={...relationBases};
    for(const [tag,metadata] of Object.entries(step.actorUpdates||{}))actorMetadata[tag]={...actorMetadata[tag],...metadata};
    for (const update of step.updates || []) for (const id of update.provinceIds) {
      if(!included.has(id))continue;
      if(Object.hasOwn(update,'settlementState')){
        settlementStates[id]=update.settlementState;
        settlementBases[id]=observation(step,sequence,{dimension:'settlement'});
      }
      if(Object.hasOwn(update,'ownerStatus'))ownerStatuses[id]=update.ownerStatus;
      // Settlement completion is independently sourced and cannot clear or
      // recreate ownership. Initial tribal rights are never replayed here.
      if(!Object.hasOwn(update,'owner'))continue;
      if(update.owner===null&&(update.ownerStatus!=='explicit_none'||!update.reason))throw new Error(`Unqualified control withdrawal: ${step.id}/${id}`);
      if(!Object.hasOwn(update,'ownerStatus'))ownerStatuses[id]=update.owner?'state_owner':'explicit_none';
      const previousOwner=owners[id],identityOnly=identityChanges.includes(id)||(step.identityContinuations||[]).some(item=>item.from===previousOwner&&item.to===update.owner);
      touchedOwners.add(id);
      owners[id] = update.owner;
      if(identityOnly){
        identityObservations.set(id,observation(step,sequence,{from:previousOwner,to:update.owner}));
        if(!currentRelations[previousOwner]&&!currentRelations[update.owner]&&relationBases[previousOwner]?.status==='independent'&&!relationBases[update.owner])relationBases[update.owner]={...relationBases[previousOwner]};
        continue;
      }
      // Repeating the same owner as a hypothesis does not revoke an existing
      // attested location. An actual transfer always receives its own basis.
      if(previousOwner!==update.owner||step.evidenceKind!=='hypothesis'||ownershipBases[id].certainty!=='reconstructed'){
        const previous=ownershipBases[id],kind=step.evidenceKind==='hypothesis'?'hypothesis':'attested';
        const confirmsChange=confirmsCurrentTransition(previous,step,kind);
        ownershipBases[id]=observation(step,sequence,{observedOwner:update.owner,...transitionEvidence(previous,step,previousOwner!==update.owner,kind)});
        ownershipObservations[id]={year:step.year,sequence,evidenceKind:kind,recordId:step.id,...(confirmsChange?{confirmsChange:true}:{})};
      }
    }
    for(const [subject,withdrawal] of Object.entries(step.relationRemovalEvidence||{})){
      if(step.evidenceKind!=='hypothesis'||!step.removeRelations?.includes(subject)||step.relations?.some(r=>r.subject===subject)||withdrawal.status!=='unknown'||withdrawal.dateIsHistoricalFact!==false||!withdrawal.reason?.trim()||!Array.isArray(withdrawal.sourceIds)||!withdrawal.sourceIds.length||withdrawal.sourceIds.some(id=>!step.sourceIds?.includes(id))||Object.keys(withdrawal).some(k=>!['status','dateIsHistoricalFact','reason','sourceIds'].includes(k)))throw new Error(`Unqualified unknown relationship withdrawal: ${step.id}/${subject}`);
    }
    for (const subject of step.removeRelations || []) {
      const unresolved=step.relationRemovalEvidence?.[subject];
      const hadRelation=!!currentRelations[subject];
      delete currentRelations[subject];
      if(unresolved||hadRelation||step.evidenceKind!=='hypothesis'||relationBases[subject]?.certainty!=='reconstructed')relationBases[subject]=observation(step,sequence,{
        status:unresolved?'unknown':'independent',...transitionEvidence(relationBases[subject],step,hadRelation,step.evidenceKind==='hypothesis'?'hypothesis':'attested'),
        ...(unresolved?{relationshipWithdrawal:structuredClone(unresolved)}:{}),
      });
    }
    for (const relation of step.relations || []) {
      const previous=relationsBeforeStep[relation.subject],previousBasis=relationBasesBeforeStep[relation.subject];
      const sameRelation=previous?.overlord===relation.overlord&&previous?.type===relation.type;
      currentRelations[relation.subject]=relation;
      if(!sameRelation||step.evidenceKind!=='hypothesis'||previousBasis?.certainty!=='reconstructed'){
        const uncertain=step.evidenceKind==='hypothesis'||relation.certainty==='hypothesis';
        relationBases[relation.subject]=observation(step,sequence,{status:'subject',certainty:uncertain?'hypothesis':'reconstructed',evidenceKind:uncertain?'hypothesis':'attested',
          ...transitionEvidence(previousBasis,step,!sameRelation,uncertain?'hypothesis':'attested'),
        });
      }else relationBases[relation.subject]=previousBasis;
    }
    for (const rename of step.renameActors || []) {
      for(const id of included)if(owners[id]===rename.from){owners[id]=rename.to;touchedOwners.add(id);identityObservations.set(id,observation(step,sequence,{from:rename.from,to:rename.to}));}
      currentRelations=Object.fromEntries(Object.entries(currentRelations).map(([tag,r])=>[tag===rename.from?rename.to:tag,{...r,subject:r.subject===rename.from?rename.to:r.subject,overlord:r.overlord===rename.from?rename.to:r.overlord}]));
      relationBases=Object.fromEntries(Object.entries(relationBases).map(([tag,value])=>[tag===rename.from?rename.to:tag,value]));
    }
    // A party losing its last displayed province must not leave a stale tie
    // that can revive on a later, independently reconstructed reappearance.
    for(const tag of step.displayRelationClosuresByEvidence?.[evidence]||[]){
      if(currentRelations[tag])relationBases[tag]=observation(step,sequence,{status:'independent',derivedFromDisplayClosure:true,
        ...transitionEvidence(relationBasesBeforeStep[tag],step,!!relationsBeforeStep[tag],step.evidenceKind==='hypothesis'?'hypothesis':'attested'),
      });
      delete currentRelations[tag];
    }
    const changed=new Set(stepChanges(step,evidence));
    for(const id of included){
      const previous=basis[id],relationshipEvidence=relationshipEvidenceFor(owners[id]);
      const relationshipObservation=JSON.stringify(previous.relationshipEvidence)!==JSON.stringify(relationshipEvidence);
      if(!touchedOwners.has(id)&&!changed.has(id)&&!relationshipObservation)continue;
      // recordId remains the latest traceable state operation for continuity
      // audits; ownershipBasis retains the actual territorial source through
      // identity changes and relationship-only observations.
      basis[id]={...previous,year:step.year,title:step.title,sourceId:step.sourceId,recordId:step.id,notes:step.geometryNote,
        certainty:combinedCertainty(ownershipBases[id],relationshipEvidence),ownershipBasis:ownershipBases[id],relationshipEvidence,
        ...(ownershipObservations[id]?{ownershipObservation:ownershipObservations[id]}:{}),
        ...(identityObservations.has(id)?{identityBasis:identityObservations.get(id)}:{}),
      };
    }
  }
  const actors = {...base.countries,...chronology.actors};
  for(const [tag,metadata] of Object.entries(actorMetadata))if(actors[tag])actors[tag]={...actors[tag],...metadata};
  const provinces = {};
  const certaintyByProvince=new Map();
  for(const span of chronology.certaintySpans||[]){
    if(span.mode!==evidence||year<span.startYear||year>span.endYear)continue;
    if(!certaintyByProvince.has(span.provinceId))certaintyByProvince.set(span.provinceId,[]);
    certaintyByProvince.get(span.provinceId).push(span);
  }
  for (const [id, p] of Object.entries(base.provinces)) {
    const province={...p,owner:included.has(p.id)?owners[p.id]:null,controller:null,coverage:included.has(p.id),
      ownerStatus:included.has(p.id)?ownerStatuses[p.id]:'out_of_scope',coverageStatus:included.has(p.id)?'model_covered':'out_of_scope',
      settlementState:settlementStates[p.id]||p.settlementState,
      basis:basis[p.id]?{...basis[p.id],...(settlementBases[p.id]?{settlementBasis:settlementBases[p.id]}:{})}:null,
      ...(withdrawals.some(w=>w.displayAction==='withhold-unsupported-continuation'&&w.provinceIds.includes(p.id))?{coverageWithheld:withdrawals.find(w=>w.displayAction==='withhold-unsupported-continuation'&&w.provinceIds.includes(p.id))}:{})};
    provinces[id] = qualifyProvince(applyTerritoryCertainty(province,year,evidence,certaintyByProvince.get(p.id)||[]),chronology.politicalQualifications||[],actors,year,evidence);
  }
  const countries = groupCountries(provinces,actors);
  for(const country of Object.values(countries))if(base.countries[country.tag]?.provinceIds.some(id=>!included.has(id))) {
    country.coverageNote=[country.coverageNote,'本阶段只显示已纳入研究范围的领土，不代表这个国家的完整疆域。'].filter(Boolean).join(' ');
  }
  const offmapRelations={},offmapActors={};
  for(const owner of Object.keys(countries)){
    let tag=owner;const seen=new Set();
    while(currentRelations[tag]&&!seen.has(tag)){
      seen.add(tag);const r=currentRelations[tag];
      if(!countries[tag]||!countries[r.overlord]){
        offmapRelations[tag]={...r,visibility:'outside-map-coverage'};
        if(!countries[tag]&&actors[tag])offmapActors[tag]=actors[tag];
        if(!countries[r.overlord]&&actors[r.overlord])offmapActors[r.overlord]=actors[r.overlord];
      }
      tag=r.overlord;
    }
  }
  currentRelations = Object.fromEntries(Object.entries(currentRelations).filter(([tag,r]) => countries[tag] && countries[r.overlord]));
  return {...base,year,date:`${year}`,provinces,countries,relations:currentRelations,offmapRelations,offmapActors,geometryKey:'eu4',
    signature:`eu4:west:${applied.map(s=>s.id).join(':')}:withdraw:${withdrawals.map(w=>w.id).join(':')}`,
    stats:{...base.stats,countries:Object.keys(countries).length,politicalProvinces:Object.values(countries).reduce((n,c)=>n+c.provinceIds.length,0)},
    coverage:{type:'reconstructed',title:`${chronology.coverageTitle||'西坎诺'} · ${evidence==='attested'?'史料节点重建':'含推测延拓'}`,description:evidence==='attested'?'史料节点投影到 EU4 省形；其间沿用旧边界。隐藏了网站选年的推测方案，仍不代表精确历史国界。':'史料节点与明确标注的推测方案共同构成版图；空缺年代沿用最近边界。可按国家查看各段依据。',latestYear:applied.at(-1)?.year || FIRST_YEAR,stepIds:applied.map(s=>s.id),withdrawals:withdrawals.map(w=>w.reason)},
  };
}

function emptyView(base,year) {
  return {...base,year,countries:{},provinces:Object.fromEntries(Object.entries(base.provinces).map(([id,p])=>[id,{...p,owner:null,controller:null,coverage:false}])),relations:{},geometryKey:'eu4',signature:'eu4:empty',stats:{...base.stats,countries:0,politicalProvinces:0},coverage:{type:'none',title:'版图待重建',description:'此年份尚无已核定的政治版图。'}};
}

export function groupCountries(provinces, actors) {
  const countries = {};
  for (const province of Object.values(provinces)) {
    if (!province.owner || province.water || province.wasteland || province.excluded || !actors[province.owner]) continue;
    const c = countries[province.owner] ||= {...actors[province.owner],tag:province.owner,provinceIds:[],bounds:[Infinity,Infinity,-Infinity,-Infinity],pixels:0,center:province.center};
    c.provinceIds.push(province.id);
    for(let i=0;i<2;i++){c.bounds[i]=Math.min(c.bounds[i],province.bounds[i]);c.bounds[i+2]=Math.max(c.bounds[i+2],province.bounds[i+2]);}
    c.pixels += province.pixels || 0;
  }
  for (const c of Object.values(countries)) {
    const capital=provinces[c.capital];
    const representative=capital?.owner===c.tag?capital:provinces[c.provinceIds.reduce((a,b)=>(provinces[a].pixels||0)>(provinces[b].pixels||0)?a:b)];
    c.center=representative.center;
    c.recordYears=[...new Set(c.provinceIds.map(id=>provinces[id].basis?.year).filter(Boolean))].sort((a,b)=>a-b);
    c.basisCounts=c.provinceIds.reduce((counts,id)=>{const key=provinces[id].basis?.certainty||'continued';counts[key]=(counts[key]||0)+1;return counts;},{});
  }
  return countries;
}

export function territorialChangesAtYear(chronology, year, evidence='reconstructed') {
  return (chronology?.steps || []).filter(step=>step.year===year&&territorialStepChanges(step,evidence).length).map(step=>({
    id:step.id,name:step.title,nameZh:step.title,importance:step.importance,changeType:step.changeType,highlightYear:step.year,evidenceKind:step.evidenceKind,sequence:chronology.steps.indexOf(step),
    changedProvinceIds:territorialStepChanges(step,evidence),geometryCertainty:'reconstructed',sourceId:step.sourceId,anchorProvinceId:territorialStepChanges(step,evidence)[0],
  }));
}

// Kept for existing integrations; the policy no longer has a major-only gate.
export const majorChangesAtYear=territorialChangesAtYear;
