// Observations are dated evidence, not a timeless attribute of a country TAG.
// A future endpoint can explain an open question, but never supplies today's value.
const fields=['cultures','religion'];
const refs=entry=>[...(entry.sourceRefs||[]),...(entry.source?[entry.source]:[])];
const values=(entry,field)=>field==='cultures'?(entry?.cultures||[]):entry?.religion?[entry.religion]:[];

export function createIdentityCatalog(eu4,vic3,history={}) {
  const observations=[];
  for(const [origin,data] of [['eu4',eu4],['vic3',vic3]])for(const [tag,country] of Object.entries(data?.countries||{})){
    if(origin==='eu4'&&country.activeAtStart!==true)continue;
    observations.push({...country,tag,year:data.year,origin,sourceRefs:refs(country)});
  }
  for(const entry of history.observations||[])observations.push({...entry,origin:entry.origin||(entry.tag?.startsWith('v3:')?'vic3':'eu4'),sourceRefs:refs(entry)});
  return {eu4,vic3,history,observations,sources:{...eu4?.sources,...vic3?.sources,...history.sources}};
}

function concept(catalog,origin,field,id){
  const entry=catalog[origin]?.[field]?.[id];
  return {id,name:entry?.name||id,nameZh:entry?.nameZh||'',species:entry?.species||[],speciesNote:entry?.speciesNote||'',sourceRefs:[...refs(entry||{}),...(entry?.speciesSource?[entry.speciesSource]:[])]};
}
function sameValue(a,b){return a.length===b.length&&[...a].sort().every((value,i)=>value===[...b].sort()[i]);}

export function countryIdentityAtYear(catalog,tag,year) {
  const aliases=new Set([tag]);
  // Links only contain audited same-polity counterparts, never general successors.
  for(const link of catalog.history.links||[])if(link.eu4===tag||link.vic3===tag){aliases.add(link.eu4);aliases.add(link.vic3);}
  const observations=catalog.observations.filter(o=>aliases.has(o.tag)).sort((a,b)=>a.year-b.year);
  const result={tag,year,fields:{},observations,transitions:[],sourceRefs:[]};
  for(const field of fields){
    const known=observations.filter(o=>values(o,field).length);
    const past=known.filter(o=>o.year<=year),latest=past.at(-1);
    const future=known.find(o=>o.year>year&&(!latest||!sameValue(values(latest,field),values(o,field))));
    const view={status:latest?(latest.year===year?'observed':'last-known'):'unknown',year:latest?.year,
      values:latest?values(latest,field).map(id=>concept(catalog,latest.origin,field==='religion'?'religions':'cultures',id)):[],
      note:latest?.note||latest?.notes||'',sourceRefs:latest?refs(latest):[]};
    if(future)view.next={year:future.year,values:values(future,field).map(id=>concept(catalog,future.origin,field==='religion'?'religions':'cultures',id)),sourceRefs:refs(future)};
    result.fields[field]=view;result.sourceRefs.push(...view.sourceRefs,...(view.next?.sourceRefs||[]),...view.values.flatMap(v=>v.sourceRefs));
  }
  result.transitions=(catalog.history.transitions||[]).filter(t=>aliases.has(t.tag)&&year>=t.earliest&&year<=t.latest);
  const current=observations.filter(o=>o.year===year).at(-1);
  result.cultureReligionContext=(current?.cultureReligionContext||[]).map(c=>concept(catalog,current.origin,'religions',c.religion));
  for(const c of current?.cultureReligionContext||[])result.sourceRefs.push(...refs(c));
  for(const t of result.transitions)result.sourceRefs.push(...refs(t));
  result.sourceRefs=[...new Set(result.sourceRefs)];
  return result;
}

export function identityName(value){return value.nameZh?`${value.nameZh} · ${value.name}`:value.name;}

export function cultureSpecies(cultures){
  const seen=new Set(),species=[];
  for(const culture of cultures)for(const value of culture.species||[]){
    if(!seen.has(value.id)){seen.add(value.id);species.push(value);}
  }
  return {values:species,incomplete:cultures.some(c=>!c.species?.length)};
}
