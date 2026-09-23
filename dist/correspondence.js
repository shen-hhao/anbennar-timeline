const statusNames={'raw-projection':'原始投影','previous-reviewed':'既有审阅','cartographic-candidate':'本次投票','remote-without-valid-land-match':'远海待核'};
const confidenceNames={'medium':'中等置信','low':'低置信','very-low':'极低置信','reconstructed':'强对应重建','hypothesis':'推测对应','setup':'来源开局'};
export const normalizeSearch=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase().trim();
export function countryText(tag,countries){const c=countries[tag];return tag?(c?.nameZh||c?.name||tag):'未得到归属';}
export function searchableRow(row,countries){
  const tags=[row.rawOwner,row.reviewedOwner,row.cartographicOwner,row.displayOwner,row.fullExtrapolationOwner].filter(Boolean);
  return normalizeSearch([row.provinceId,row.name,row.nameZh,...tags.flatMap(tag=>{const c=countries[tag]||{};return [tag,c.name,c.nameZh,c.eu4Tag,c.historyTag,c.historyActor];})].join(' '));
}
export function matchingRows(rows,query,status,countries){
  const terms=normalizeSearch(query).split(/\s+/).filter(Boolean);
  return rows.filter(row=>(status==='all'||status===row.status||status==='conflict'&&row.rawSourceConflict||status==='very-low'&&row.confidence==='very-low')&&terms.every(term=>searchableRow(row,countries).includes(term)));
}

async function start(){
  const $=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=String(text);if(cls)node.className=cls;return node;};
  const json=async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`${url}：HTTP ${response.status}`);return response.json();};
  try{
    const [ledger,endpoint,identity]=await Promise.all([json('./data/endpoint-correspondence.json'),json('./data/endpoint-1820.json'),json('./data/endpoint-country-identities.json')]);
    if(ledger.schemaVersion!==1||!Array.isArray(ledger.rows)||ledger.rows.length!==4971||new Set(ledger.rows.map(r=>r.provinceId)).size!==4971)throw new Error('全图对应表版本或省份数量不匹配。');
    const countries=Object.fromEntries(Object.entries(endpoint.countries||{}).map(([tag,c])=>[tag,{...c,...identity.countries?.[tag]}]));
    const votes=new Map((endpoint.cartographicFill?.overrides||[]).map(r=>[r.provinceId,r]));
    const reviews=new Map((endpoint.reconstructionOverrides?.overrides||[]).map(r=>[r.provinceId,r]));
    const allRows=[...ledger.rows].sort((a,b)=>a.provinceId-b.provinceId),PAGE=50;
    let page=0,selected=null,filtered=allRows;
    const percent=n=>Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'未记录';
    const number=n=>Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:3}):'未记录';
    const polity=tag=>{const box=el('span',tag?countryText(tag,countries):'—',tag?'':'muted');if(tag)box.append(el('small',tag,'tag'));return box;};
    const badge=row=>el('span',statusNames[row.status]||row.status,`badge ${row.status==='previous-reviewed'?'review':row.status==='cartographic-candidate'?'vote':row.status==='remote-without-valid-land-match'?'remote':''}`);
    const summary=ledger.summary||{};
    for(const [value,label] of [[summary.eligibleLand,'有效 EU4 陆地'],[summary.existingPreserved,'保留既有对应'],[summary.defaultFills,'默认投票补色'],[summary.remoteOptional,'远海可选 · 极弱候选']]){const card=el('div',null,'metric');card.append(el('strong',number(value)),el('span',label));$('summary').append(card);}
    function updateURL(){const params=new URLSearchParams();if($('search').value)params.set('q',$('search').value);if($('filter').value!=='all')params.set('filter',$('filter').value);if(selected)params.set('province',selected);if($('remote').checked)params.set('remote','1');history.replaceState(null,'',`${location.pathname}${params.size?'?'+params:''}`);}
    function draw(){
      const remote=$('remote').checked;filtered=matchingRows(allRows,$('search').value,$('filter').value,countries);
      const pages=Math.max(1,Math.ceil(filtered.length/PAGE));page=Math.min(page,pages-1);$('rows').replaceChildren();
      for(const row of filtered.slice(page*PAGE,(page+1)*PAGE)){
        const tr=el('tr');if(row.provinceId===selected)tr.className='selected';
        const name=el('button',row.nameZh||row.name,'province-button');name.type='button';name.setAttribute('aria-expanded',String(row.provinceId===selected));
        name.append(el('small',`${row.provinceId} · ${row.nameZh?row.name:''}`));name.addEventListener('click',()=>{selected=row.provinceId;draw();showDetail();updateURL();if(matchMedia('(max-width:1100px)').matches)$('detail').scrollIntoView({behavior:'smooth',block:'start'});});
        const first=el('td');first.append(name);tr.append(first);
        for(const tag of [row.rawOwner,row.reviewedOwner,row.cartographicOwner,remote?row.fullExtrapolationOwner:row.displayOwner]){const td=el('td');td.append(polity(tag));tr.append(td);}
        const status=el('td');status.append(badge(row),el('small',confidenceNames[row.confidence]||row.confidence||'未定等级','muted'));if(row.rawSourceConflict)status.append(el('span','原始冲突','badge conflict'));tr.append(status);$('rows').append(tr);
      }
      if(!filtered.length){const tr=el('tr'),td=el('td','没有匹配项。可尝试省份 ID、英文名或 v3:TAG。','muted');td.colSpan=6;tr.append(td);$('rows').append(tr);}
      $('count').textContent=`${filtered.length.toLocaleString()} / ${allRows.length.toLocaleString()} 处对应`;
      $('page').textContent=`第 ${page+1} / ${pages} 页`;$('previous').disabled=page===0;$('next').disabled=page>=pages-1;
      $('display-policy').textContent=remote?'当前预览含远海极弱候选':'当前显示默认对应 · 远海保留待核';
    }
    function showDetail(){
      const row=allRows.find(r=>r.provinceId===selected);if(!row)return;
      const d=$('detail');d.className='detail';d.replaceChildren();const vote=votes.get(row.provinceId),review=reviews.get(row.provinceId),raw=endpoint.provinces?.[row.provinceId];
      const top=el('div',null,'detail-top'),close=el('button','收起','detail-close');close.type='button';close.addEventListener('click',()=>{selected=null;d.className='detail empty';d.replaceChildren(el('p','选择省份，查看对应依据。'));draw();updateURL();});top.append(badge(row),close);d.append(top,el('h2',row.nameZh||row.name),el('p',`${row.provinceId} · ${row.name}`,'subtitle'));
      const facts=el('dl',null,'fact-grid');
      for(const [label,value] of [['原始归属',countryText(row.rawOwner,countries)],['既有审阅',row.reviewedOwner?countryText(row.reviewedOwner,countries):'无单独审阅覆盖'],['投票候选',row.cartographicOwner?countryText(row.cartographicOwner,countries):'未使用本次投票'],['默认显示',countryText(row.displayOwner,countries)],['远海启用后',countryText(row.fullExtrapolationOwner,countries)],['置信等级',confidenceNames[row.confidence]||row.confidence||'未记录']])facts.append(el('dt',label),el('dd',value));d.append(facts);
      if(row.rawSourceConflict)d.append(el('p','原始投影记录存在来源冲突。后续审阅或补色没有改写该原始观察。','warning conflict-note'));
      if(row.status==='remote-without-valid-land-match')d.append(el('p','本省所有样本均未命中有有效归属的 Vic3 陆地。默认显示待核；最近国家只作为可关闭的极弱候选。','warning'));
      for(const warning of vote?.warnings||[])d.append(el('p',warning,'warning'));
      if(vote){
        d.append(el('h3','样本与备选票'));
        const stats=el('dl',null,'fact-grid');for(const [label,value] of [['实际陆地命中',`${number(vote.directAssignedSamples)} / ${number(vote.sampleCount)}`],['赢家票份额',percent(vote.weightedWinnerShare)],['近岸 p95',`${number(vote.shoreDistanceP95)} 个 Vic3 像素`],['最近地名锚距',`${number(vote.nearestAnchorDistance)} 个 EU4 像素`],['配准离散',`${number(vote.localDisplacementSpread)} 个 Vic3 像素`]])stats.append(el('dt',label),el('dd',value));d.append(stats);
        const ranked=Object.entries(vote.weightedVotes||{}).filter(([,n])=>Number.isFinite(n)&&n>=0).sort((a,b)=>b[1]-a[1]),sum=ranked.reduce((s,[,n])=>s+n,0);
        for(const [tag,n] of ranked){const line=el('div',null,'vote-row'),label=el('div',null,'vote-label');label.append(el('span',`${countryText(tag,countries)} · ${tag}`),el('span',sum?percent(n/sum):'未记录'));const bar=el('div',null,'bar'),fill=el('span');fill.style.width=`${sum?Math.max(0,Math.min(100,n/sum*100)):0}%`;bar.append(fill);line.append(label,bar,el('small',`加权票 ${number(n)} · 直接命中 ${number(vote.directOwnerVotes?.[tag]||0)}`,'muted'));d.append(line);}
        d.append(el('p',vote.reasoning||'投票是跨底图显示假说，不代表确证国界。'));
        if(vote.anchorEu4ProvinceIds?.length)d.append(el('p',`配准参考省份 ID：${vote.anchorEu4ProvinceIds.join('、')}`,'muted'));
      }else if(review){d.append(el('h3','既有审阅依据'),el('p',review.title||'已审阅对应'),el('p',review.reasoning||review.notes||'完整审阅记录见下方原始字段。'));}
      d.append(el('h3','来源与原始记录'));
      const paths=vote?.sourcePaths||[],sources=el('ul',null,'source-list');
      for(const path of paths){const meta=endpoint.cartographicFill?.sourceManifest?.[path],li=el('li');let target=null;try{if(meta?.url&&['http:','https:'].includes(new URL(meta.url).protocol))target=meta.url;}catch{}if(target){const a=el('a',path);a.href=target;a.target='_blank';a.rel='noopener noreferrer';li.append(a);}else li.append(el('span',path));if(meta?.sha256)li.append(el('code',`SHA256 ${meta.sha256}`,'source-path'));sources.append(li);}
      if(paths.length)d.append(sources);
      d.append(el('p',`来源省 ID：${(row.sourceProvinceIds||[]).join('、')||'未记录'}`,'muted'));
      if(row.recordId)d.append(el('p',`记录 ID：${row.recordId}`,'muted'));
      const disclosure=el('details'),summary=el('summary','查看保留的原始投影字段');disclosure.append(summary,el('pre',JSON.stringify(raw||{},null,2)));d.append(disclosure);
      if(review){const reviewRaw=el('details');reviewRaw.append(el('summary','查看既有审阅完整字段'),el('pre',JSON.stringify(review,null,2)));d.append(reviewRaw);}
      const candidateRaw=vote?el('details'):null;if(candidateRaw){candidateRaw.append(el('summary','查看投票候选完整字段'),el('pre',JSON.stringify(vote,null,2)));d.append(candidateRaw);}
    }
    const params=new URLSearchParams(location.search);$('search').value=params.get('q')||'';if([...$('filter').options].some(o=>o.value===params.get('filter')))$('filter').value=params.get('filter');$('remote').checked=params.get('remote')==='1';const target=Number(params.get('province'));if(allRows.some(r=>r.provinceId===target)){selected=target;if(!params.has('q'))$('search').value=String(target);}
    $('search').addEventListener('input',()=>{page=0;draw();updateURL();});$('filter').addEventListener('change',()=>{page=0;draw();updateURL();});$('remote').addEventListener('change',()=>{draw();if(selected)showDetail();updateURL();});$('previous').addEventListener('click',()=>{page--;draw();});$('next').addEventListener('click',()=>{page++;draw();});
    $('loading').hidden=true;$('app').hidden=false;draw();if(selected)showDetail();
  }catch(error){$('loading').className='error';$('loading').textContent=`对应表暂时无法读取：${error.message} 请确认本站数据已完整发布后刷新。`;}
}
if(typeof document!=='undefined')start();
