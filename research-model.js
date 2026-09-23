export const STATUS = {registered:'已登记 · 待研究',in_progress:'梳理中',complete:'全期审校通过',deferred:'暂缓研究',reference:'系统 / 动态占位'};
export function regionDescendants(regions, id) {
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const r of regions)if(ids.has(r.parent)&&!ids.has(r.id)){ids.add(r.id);changed=true;}}
  return ids;
}
export function regionPath(regions, id) {
  const byId=new Map(regions.map(r=>[r.id,r])),path=[],seen=new Set();
  while(id&&byId.has(id)&&!seen.has(id)){seen.add(id);const r=byId.get(id);path.unshift(r);id=r.parent;}
  return path;
}
export function countriesInRegion(index,id,namespace='all') {
  const regions=regionDescendants(index.regions,id);
  return index.countries.filter(c=>regions.has(c.region_id)&&(namespace==='all'||c.namespace===namespace));
}
export function progressSummary(countries) {
  const included=countries.filter(c=>c.scope==='included');
  const complete=included.filter(c=>c.status==='complete').length;
  return {total:countries.length,eligible:included.length,complete,
    started:included.filter(c=>c.status==='in_progress').length,registered:included.filter(c=>c.status==='registered').length,
    deferred:countries.filter(c=>c.scope==='deferred').length,reference:countries.filter(c=>c.scope==='reference').length,
    withRecords:included.filter(c=>c.recordIds.length).length,percent:included.length?complete/included.length*100:null};
}
export function recordIntervals(records) {
  const years=[...new Set([1444,...records.map(r=>r.year),1820])].sort((a,b)=>a-b);
  return years.slice(1).map((end,i)=>({start:years[i],end,gap:end-years[i]})).filter(i=>i.gap>1).sort((a,b)=>b.gap-a.gap);
}
// A website publication is another view of its original research record.
// Keep it when the original is not associated with this particular country.
export function distinctResearchRecords(records) {
  const ids=new Set(records.map(record=>record.id));
  return records.filter(record=>!record.originRecordId||!ids.has(record.originRecordId));
}
export function searchRegister(countries,query,status='all') {
  const term=query.trim().toLocaleLowerCase();
  return countries.filter(c=>(status==='all'||c.status===status)&&(!term||[c.id,c.tag,c.name,c.name_zh,...(c.searchAliases||[]),...(c.origin?.searchAliases||[])].some(v=>typeof v==='string'&&v.toLocaleLowerCase().includes(term))))
    .sort((a,b)=>(a.status==='in_progress'?-1:0)-(b.status==='in_progress'?-1:0)||(b.origin.firstPass?1:0)-(a.origin.firstPass?1:0)||a.id.localeCompare(b.id));
}
export function evidenceCount(origin,key) {
  return Math.max(Number(origin?.evidenceCounts?.[key])||0,(origin?.[key]?.length||0)+(Number(origin?.[key+'Omitted'])||0));
}
export function canonAssessment(country) {
  const assessment=country.origin?.canonAssessment;
  if(assessment)return assessment;
  return evidenceCount(country.origin,'activationEvidence')?{status:'unresolved',label:'正史待考',note:'已找到游戏生成机制；是否在正史中出现及其发生年代，仍需设定资料核对。',sourceIds:[]}:null;
}
export function mechanismSourceUrl(source,line) {
  if(typeof source!=='string'||!source||/[\\\\?#:\u0000-\u001f]/.test(source))return null;
  const parts=source.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))return null;
  const suffix=Number.isInteger(Number(line))&&Number(line)>0?'#L'+Number(line):'';
  return 'https://gitlab.com/anbennar/anbennar-eu4-dev/-/blob/new-master/'+parts.map(encodeURIComponent).join('/')+suffix;
}
export function groupCountryLinks(links,countryId) {
  const groups=new Map();
  for(const link of links){
    if(link.from_id!==countryId&&link.to_id!==countryId)continue;
    const id=link.from_id===countryId?link.to_id:link.from_id;
    if(!id||id===countryId)continue;
    if(!groups.has(id))groups.set(id,{id,relations:[],sourceIds:[]});
    const group=groups.get(id),relation={relation:link.relation,basis:link.basis};
    if(!group.relations.some(item=>item.relation===relation.relation&&item.basis===relation.basis))group.relations.push(relation);
    group.sourceIds=[...new Set([...group.sourceIds,...(link.sourceIds||[])])];
  }
  return [...groups.values()];
}
