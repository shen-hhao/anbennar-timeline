import {createPublicDisplay} from './public-display.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={owner:'归属',relationship:'宗属',controlChain:'完整控制链',name:'英文名',nameZh:'中文名',color:'颜色',flagPixels:'旗帜图像',politicalStatus:'身份说明',capitalLocator:'首都定位'};
const name=s=>s.ownerNameZh||s.ownerName||'归属未知';
const canonical=tag=>tag?.replace(/^eu4:/,'');
let data,page=0,selected=null,publicView;
const publicRecord=r=>publicView.record(r,{surface:'events'});
const params=new URLSearchParams(location.search);
function states(row){return [row.before1819,row.default1820];}
function matchesCountry(row,tag){return states(row).some(s=>[s.owner,s.normalizedOwner,...[...s.chain,...s.normalizedFullPoliticalChain].flatMap(x=>[x.subject,x.overlord])].some(x=>canonical(x)===canonical(tag)));}
function filtered(){
  const q=$('query').value.toLocaleLowerCase().trim();
  return data.provinces.filter(r=>($('scope').value==='all'||r.sarhalGeographic)&&($('filter').value==='all'||$('filter').value==='political'&&r.politicalDifference||$('filter').value==='changed'&&r.changeDimensions.length||$('filter').value==='unknown'&&!r.rawAssignment.owner)&&(!params.get('country')||matchesCountry(r,params.get('country')))&&(!q||[r.provinceId,r.name,r.nameZh,...states(r).flatMap(s=>[s.owner,s.normalizedOwner,s.ownerName,s.ownerNameZh])].join(' ').toLocaleLowerCase().includes(q)));
}
function render(){
  if(!data)return;
  const rows=filtered();const pages=Math.max(1,Math.ceil(rows.length/30));page=Math.min(page,pages-1);
  $('count').textContent=`符合条件 ${rows.length} 省；其中 ${rows.filter(r=>r.politicalDifference).length} 省有政治状态差异。`;
  $('rows').innerHTML=rows.slice(page*30,page*30+30).map(r=>`<tr><td>${esc(r.nameZh||r.name)}<br><span class="tag">${r.provinceId} · ${esc(r.name)}</span></td><td>${esc(name(r.before1819))}</td><td>${esc(name(r.default1820))}${!r.rawAssignment.owner?'<br><span class="tag">原始归属未知</span>':''}</td><td>${r.changeDimensions.map(d=>esc(labels[d])).join('、')||'无可见状态差异'}</td><td><button data-province="${r.provinceId}">查看依据</button></td></tr>`).join('');
  $('page').textContent=`${page+1} / ${pages}`;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
}
function sourceMarkup(id){const s=data.sources[id];return !s?esc(id):s.url?`<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title||id)}</a>`:`${esc(s.title||id)} · 本地依据`;}
function stateMarkup(s,year){return `<div><h3>${year} · ${esc(name(s))}</h3><p class="tag">${esc(s.owner||'未知')} · 名称：${esc(s.ownerName)} / ${esc(s.ownerNameZh)}</p><p>宗属链：${s.chain.length?s.chain.map(x=>`${esc(x.subject)} → ${esc(x.overlord)} · ${esc(x.type)} / ${esc(x.control)}`).join('<br>'):'未列宗属关系'}</p><p>首都定位：${s.capital??'未定位'}（EU4 省号）</p>${s.flag?`<img src="./data/${esc(s.flag)}" alt="${year}显示旗帜" width="80" height="53" style="object-fit:contain">`:'<p>旗帜待核</p>'}<p class="tag">${esc(s.basis?.title||'固定端点原件')} · ${esc(s.basis?.recordId||'静态投影')}</p></div>`;}
function showProvince(id){
  const row=data.provinces.find(r=>r.provinceId===Number(id));if(!row)return;selected=row.provinceId;
  const records=row.eventIds.map(id=>data.records[id]);
  $('detail').hidden=false;$('detail').innerHTML=`<h2>${esc(row.nameZh||row.name)} · ${row.provinceId}</h2><div class="comparison">${stateMarkup(row.before1819,1819)}${stateMarkup(row.default1820,1820)}</div><p><a href="./?year=1819&country=${encodeURIComponent(row.before1819.owner||'')}">1819 国家地图</a> · <a href="./?year=1820&country=${encodeURIComponent(row.default1820.owner||'')}${row.eventIds.length?'&event='+encodeURIComponent(row.eventIds[0]):''}">1820 地图定位</a> · <a href="./continuity.html?province=${row.provinceId}">逐年旧事件与连续依据</a> · <a href="./endpoint-review.html?province=${row.provinceId}">当前端点审查</a></p><p>1820 原始投影：${esc(row.rawAssignment.owner||'归属未知')}。${row.displayInference?'原批另有独立显示推测，原始值保持不变。':''}</p><p>${row.namespaceSwitch?'EU4／Vic3 标签按现有跨表显示对应比较；这不新增国史同体断言。':''}${row.flagEncodingOnly?'旗帜尺寸及 RGBA 像素相同，仅文件编码或路径不同。':''}</p>${records.map(r=>`<article class="record" id="${esc(r.id)}"><h3>${esc(publicRecord(r).title)}</h3><p class="tag">${esc(r.type)} · ${esc(r.id)}</p><p>${esc(publicRecord(r).description)}</p><p class="tag">${esc([publicRecord(r).dateLabel,publicRecord(r).certaintyLabel,publicRecord(r).scopeLabel].filter(Boolean).join(" · "))}</p><details><summary>原记录与研究说明</summary><p>${esc(r.title)}</p><p>${esc(r.description)}</p></details><p></p><p>关联省份：${r.provinceIds.join('、')}</p><div class="sources">${r.sourceIds.map(sourceMarkup).join(' · ')}</div></article>`).join('')||'<p>本省未检出可见状态变化；没有补造历史转属事件。</p>'}<details><summary>逐省原始值、推测依据与旧事件 ID</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>`;
  $('detail').scrollIntoView({behavior:'smooth',block:'start'});
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-province]');if(button)showProvince(button.dataset.province);});
for(const id of ['query','scope','filter'])$(id).addEventListener('input',()=>{page=0;render();});
$('previous').addEventListener('click',()=>{page--;render();});$('next').addEventListener('click',()=>{page++;render();});
try{const response=await fetch('./data/sarhal-endpoint-observations.json');if(!response.ok)throw new Error(response.status);data=await response.json();const [copy,chronology]=await Promise.all(['public-copy','western-chronology'].map(async file=>{const r=await fetch(`./data/${file}.json`);if(!r.ok)throw Error(file);return r.json();}));publicView=createPublicDisplay({copy,steps:chronology.steps});if(params.has('country')||params.has('province')){$('scope').value='all';$('filter').value='all';}if(params.has('province'))$('query').value=params.get('province');render();if(params.has('province'))showProvince(params.get('province'));}catch(error){$('count').textContent='逐省资料读取失败，请刷新或检查本地服务。';console.error(error);}
