export const recordKindLabel = (kind, record) => {
  if(record?.mapAction==='none')return ({attested:'来源记载 · 文字资料',hypothesis:'推测资料',context:'背景记录'}[kind] || '文字研究记录');
  return ({setup:'开局文件',attested:'史料节点 · 范围重建',hypothesis:'推测方案 · 网站选年',context:'背景记录',endpoint:'1820 官方快照',alternative:'可选路线 · 未画入主线'}[kind] || '研究记录');
};

const displayDossier = country => country ? {...country, records: country.records || [], questions: country.questions || []} : null;

export function findDossier(catalog,tag) {
  const countries=catalog?.countries||[];
  return displayDossier(countries.find(country=>country.tag===tag)||countries.find(country=>country.aliases?.includes(tag)));
}

// Explicit historical lineage still outranks the audited cross-game display identity.
export function countryHistoryTag(country) {
  return country?.historyTag || country?.eu4Tag || country?.tag;
}

export function searchDossiers(catalog,query='',group='all') {
  const text=query.trim().toLocaleLowerCase();
  return (catalog?.countries||[]).filter(c=>(group!=='imperial'||c.imperialAtStart)&&(group!=='reviewed'||c.reviewLevel==='reviewed')&&(!text||`${c.nameZh} ${c.name} ${c.tag} ${(c.aliases||[]).join(' ')}`.toLocaleLowerCase().includes(text))).map(displayDossier);
}

// These are distinct existing dossiers with reviewed predecessor/claimant/name-restoration
// links. Shared aliases do not authorize claiming the other identity's territory.
const relatedIdentities = Object.freeze({R86:'Y26',Y26:'R86',Y66:'Y97',Y97:'Y66'});
function currentMatch(dossier,view) {
  const choose=(matches,basis)=>({country:matches.length===1?matches[0]:null,candidates:matches,basis,status:matches.length===1?'current-identity':'ambiguous-current-identity'});
  const absent={country:null,candidates:[],basis:null,status:'not-shown-in-current-view'};
  if(!dossier)return absent;
  const countries=Object.values(view?.countries||{});
  const direct=countries.filter(c=>c.tag===dossier.tag);
  if(direct.length)return choose(direct,'exact-current-tag');
  const lineage=countries.filter(c=>countryHistoryTag(c)===dossier.tag);
  if(lineage.length)return choose(lineage,'explicit-current-history-or-cross-game-tag');
  if(relatedIdentities[dossier.tag])return absent;
  const aliases=new Set(dossier.aliases||[]);
  const matches=countries.filter(c=>aliases.has(c.tag)||aliases.has(countryHistoryTag(c)));
  return matches.length?choose(matches,'existing-alias-display-route'):absent;
}

export function currentDossierCountry(dossier,view) {
  return currentMatch(dossier,view).country;
}

export function resolveDossierVisibility(dossier,view) {
  const match=currentMatch(dossier,view);
  const country=match.country;
  const result={...match,related:[],historicalExistenceEstablished:false};
  if(!dossier||country)return result;
  const relatedTag=relatedIdentities[dossier.tag];
  if(!relatedTag)return result;
  const matches=Object.values(view?.countries||{}).filter(c=>c.tag===relatedTag||countryHistoryTag(c)===relatedTag);
  const steps=new Set(view?.coverage?.stepIds||[]);
  let label='关联身份（当前视图）';
  let stepId=null;
  if(dossier.tag==='R86'){
    label='关联前身';stepId='hlc26-lingyuk-formation-1751';
  }else if(dossier.tag==='Y26'){
    label='关联后继身份';stepId='hlc26-lingyuk-formation-1751';
  }else if(dossier.tag==='Y97'&&steps.has('hlc26-baihon-three-way-split-1445')){
    label='分裂后的争位政权';stepId='hlc26-baihon-three-way-split-1445';
  }else if(dossier.tag==='Y66'&&steps.has('hlc26-baihon-restored-1534')){
    label='复称后的身份';stepId='hlc26-baihon-restored-1534';
  }else if(dossier.tag==='Y66'&&Number(view?.year)===1444){
    label='关联前身';stepId='hlc26-baihon-three-way-split-1445';
  }
  result.related=matches.map(c=>({country:c,dossierTag:relatedTag,label,modelStepId:stepId,stepApplied:stepId?steps.has(stepId):false,historicalIdentityMerged:false}));
  if(matches.length)result.status='related-identity-only';
  return result;
}

const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const displayName = country => country?.nameZh||country?.name||country?.tag||'';

export function dossierCurrentMarkup(dossier,view) {
  const result=resolveDossierVisibility(dossier,view);
  const current=result.country;
  const year=escapeHtml(view?.year??'');
  if(current)return `<div class="dossier-current">${year} 年 · 收录 ${current.provinceIds?.length||0} 省<button class="text-button" data-dossier-focus>定位国家</button></div>`;
  if(result.status==='ambiguous-current-identity')return `<div class="dossier-current">${year} 年 · 当前视图有多个关联身份，尚未确定唯一定位。<small>关联身份需要进一步核对；不会按目录顺序选择国家。</small></div>`;
  const related=result.related.map(r=>`<p class="dossier-related-identity">${escapeHtml(r.label)}：${escapeHtml(displayName(r.country))}（${escapeHtml(r.country.tag)}）<button class="text-button" data-dossier="${escapeHtml(r.dossierTag)}">查看${escapeHtml(displayName(r.country))}履历</button></p>`).join('');
  return `<div class="dossier-current">${year} 年 · 当前视图未以此身份收录可定位版图${related}<small>当前显示范围不等于历史存续结论；关联身份的版图与履历分别列示。</small></div>`;
}
