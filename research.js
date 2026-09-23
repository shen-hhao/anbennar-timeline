import {createPublicDisplay} from './public-display.js';
import {createResearchPublicIndex,createResearchModelReviews} from './research-public-view.js';
import {supersededModelNote,displayRecordTitle} from './records.js';
import {STATUS,regionPath,countriesInRegion,progressSummary,recordIntervals,searchRegister,evidenceCount,canonAssessment,mechanismSourceUrl,groupCountryLinks,distinctResearchRecords} from './research-model.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let supersessions=[],modelReviews=[];

function modelNoteMarkup(record){
  const text=supersededModelNote(record,supersessions,modelReviews);if(!text)return '';
  const review=modelReviews.find(row=>(row.recordIds||[]).some(id=>[record.id,record.originRecordId].includes(id)));
  const displayText=text.startsWith('来源分歧：本记录保留PPT的Horutep读法')?'本条沿用地区年表关于荷鲁特普的记述；哈佐巴因条目另称死于冒险团之手。两份记载均涉及1689年的战败与政权解体，但对具体击杀者尚无一致结论。':text;
  return `<p class="subtle">${esc(displayText)}</p>${displayText!==text?`<details><summary>原模型说明</summary><p>${esc(text)}</p></details>`:''}${review?`<p class="subtle">${esc(review.publicScopeLabel)}</p><div class="source-links">${sourceLinks(review.sourceIds)}</div>${review.publicOriginal!==text?`<details><summary>原模型说明</summary><p>${esc(review.publicOriginal)}</p></details>`:''}`:''}`;
}

let index,region='halann',selected=null,page=0;
const pageSize=30;
const kindLabels={setup:'官方开局',hypothesis:'推测方案',attested:'史料节点 · 范围推定',context:'背景记载'};
function mapLink(country,record){
  const year=record?.year??(country.namespace==='v3'?1820:1444);
  const endpoint=year===1820?index.links.find(l=>l.from_id===country.id&&l.relation==='endpoint_reference'):null;
  const target=endpoint?index.countries.find(c=>c.id===endpoint.to_id):country;
  const p=new URLSearchParams({year,country:(target||country).tag});
  if(country.origin.dossierTag)p.set('dossier',country.origin.dossierTag);
  return `./?${p}`;
}
function sourceLinks(ids){return [...new Set(ids||[])].map(id=>index.sources[id]).filter(Boolean).map(s=>s.url&&/^https?:\/\//.test(s.url)?`<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title||s.path)} ↗</a>`:`<span>${esc(s.title||s.path)} · 本地研究依据</span>`).join('');}
function renderReconstruction(country){
  const a=country.annotation?.reconstruction||country.origin.reconstructionAssessment;if(!a)return '';
  return `<section class="canon-notes"><h2>连续推演已审查</h2><p>${esc(a.summary)}</p><p class="subtle">${esc(a.classification||'已审推演')} · 推测仍按推测显示；全期史实审校另行计数。</p><p><a href="./continuity.html?country=${encodeURIComponent(country.id)}">查看阶段裁决与逐省连续依据 →</a></p><details><summary>推理范围与不确定性</summary><ul>${(a.uncertainties||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul><div class="source-links">${sourceLinks(a.sourceIds)}</div></details></section>`;
}
const canonLabels={attested:'正史存在已确认',unresolved:'正史待考',non_polity:'非历史政权'};
const relationLabels={shared_dossier:'同一研究专题',endpoint_reference:'1820 终点对应',same_historical_polity:'同一历史政权',cross_game_representation:'跨游戏对应',same_entity:'同一实体',successor:'继承关系',predecessor:'前身关系'};
function canonLabel(assessment){return assessment?.label||canonLabels[assessment?.status]||'正史待考';}
function renderEndpointProjection(country){
  const mapping=country.origin.endpointProjection;if(!mapping)return '';
  const count=mapping.provinceIds?.length||0;
  return `<section class="canon-notes"><h2>1820 底图对应</h2><p>Vic3 开局登记 ${mapping.sourceProvinceCount} 个源省形；当前映射 ${count} 个 EU4 省份。</p><p>${count?'已生成跨图映射，边界仍待逐国审校。':'尚无可分配的 EU4 地块；来源国家保留登记。'} ${esc(mapping.note||'')}</p>${mapping.eu4Tag?`<p>EU4 身份／标识对应：${esc(mapping.eu4Tag)}</p>`:''}${mapping.flagNote?`<p>${esc(mapping.flagNote)}</p>`:''}<p class="subtle">映射覆盖率与历史研究完成率分别计算。来源未明和底图无法表达的国家不会强行分配邻国领土。</p><div class="source-links"><a href="${mapLink(country,{year:1820})}">查看 1820 地图 →</a>${sourceLinks(mapping.sourceIds)}</div></section>`;
}
function countryEvidenceLabel(country){
  const assessment=canonAssessment(country),hasActivation=evidenceCount(country.origin,'activationEvidence')>0;
  return assessment?`${hasActivation?'生成线索 · ':''}${canonLabel(assessment)}`:'';
}
function renderResearchNotes(country){
  const assessment=canonAssessment(country),notes=[...new Map([...(country.origin.researchNotes||[]),...(country.researchNotes||[]),...(country.annotation?.researchNotes||[])].map(note=>[note.id,note])).values()];
  if(!assessment&&!notes.length)return '';
  const replaced=new Set(notes.map(note=>note.supersedesNoteId).filter(Boolean));
  const render=note=>`<article><h3>${esc(note.title||'研究补充')}</h3><p>${esc(note.description)}</p><div class="source-links">${sourceLinks(note.sourceIds)}</div></article>`;
  const current=notes.filter(note=>!replaced.has(note.id)),archived=notes.filter(note=>replaced.has(note.id));
  return `<div class="canon-notes">${assessment?`<div class="canon-assessment"><strong>${esc(canonLabel(assessment))}</strong>${assessment.note&&assessment.note!==country.origin.summary?`<p>${esc(assessment.note)}</p>`:''}<p class="subtle">正史存在的判断不代表成立年代、存续区间或领土边界已经确证。</p><div class="source-links">${sourceLinks(assessment.sourceIds)}</div></div>`:''}${notes.length?`<div class="research-note-list"><h2>研究补充与未定年资料</h2>${current.map(render).join('')}${archived.length?`<details><summary>已替代的旧解释（${archived.length}项，仅供追溯）</summary>${archived.map(render).join('')}</details>`:''}</div>`:''}</div>`;
}
function mechanismSource(source,line,hash){
  const url=mechanismSourceUrl(source,line),label=`${source||'源文件待核'}${line?' · 第 '+line+' 行':''}`;
  return `${url?`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`:`<span>${esc(label)}</span>`}${hash?`<span class="source-hash" title="${esc(hash)}">本地 SHA256 ${esc(hash.slice(0,12))}…</span>`:''}`;
}
function mechanismEvidenceItem(item,hashes){
  const operationLabels={change_tag:'变更 TAG',release:'释放国家',create_vassal:'建立附庸关系',create_march:'建立卫戍关系',create_country:'创建国家',cede_province:'领土移交'};
  const parameter=item.scriptedEffect?`<p class="mechanism-trace">参数调用 <code>${esc(item.scriptedEffect)}</code>${item.parameter?` · <code>${esc(item.parameter)} = ${esc(item.parameterValue)}</code>`:''}</p>`:'';
  const caution=['release','create_vassal','create_march'].includes(item.operation)?'<p class="subtle">此效果也可能作用于已存在的国家，不单独证明新国家成立。</p>':'';
  return `<li><strong>${esc(operationLabels[item.operation]||'脚本效果')} <code>${esc(item.operation)}</code></strong><div class="mechanism-source">${mechanismSource(item.source,item.line,hashes[item.source])}</div>${parameter}${item.terminalEffectSource?`<div class="mechanism-source terminal-source"><span>追踪终点：</span>${mechanismSource(item.terminalEffectSource,item.terminalEffectLine,hashes[item.terminalEffectSource])}</div>`:''}${caution}</li>`;
}
function renderMechanisms(country){
  const origin=country.origin,activation=origin.activationEvidence||[],transfers=origin.territoryTransferEvidence||[],activationCount=evidenceCount(origin,'activationEvidence'),transferCount=evidenceCount(origin,'territoryTransferEvidence');
  if(!activationCount&&!transferCount&&!origin.activationAuditNote)return '';
  const hashes=origin.activationSourceHashes||{};
  function evidenceList(items,key,total){const omitted=Math.max(Number(origin[key+'Omitted'])||0,total-items.length);return `${items.length?`<ul class="mechanism-evidence">${items.map(item=>mechanismEvidenceItem(item,hashes)).join('')}</ul>`:'<p class="subtle">当前快照未列出具体线索。</p>'}${omitted?`<p class="subtle">另有 ${omitted} 条未展开于此快照。</p>`:''}`;}
  return `<details class="mechanism-details"><summary>游戏生成机制线索 <span>${activationCount} 条生成 · ${transferCount} 条领土移交</span></summary><div class="mechanism-content"><p class="subtle">这些是可发生的游戏脚本效果，不是已发生的历史节点；数量不计入沿革，也不会自动通过审校。</p>${origin.activationAuditNote?`<p class="subtle">${esc(origin.activationAuditNote)}</p>`:''}<p class="subtle">文件链接指向未固定版本的开发分支 new-master；行号与哈希对应本次本地扫描，线上文件可能变化。</p><h3>生成与身份变化</h3>${evidenceList(activation,'activationEvidence',activationCount)}${transferCount?`<h3>领土移交</h3><p class="subtle">cede_province 只表示领土移交，不是国家生成证据。</p>${evidenceList(transfers,'territoryTransferEvidence',transferCount)}`:''}</div></details>`;
}
function progressBar(s){return `<div class="progress-bar" role="img" aria-label="${s.complete} 项全期审校通过，${s.started} 项梳理中，${s.registered} 项待研究"><span class="complete" style="width:${s.eligible?s.complete/s.eligible*100:0}%"></span><span class="started" style="width:${s.eligible?s.started/s.eligible*100:0}%"></span></div>`;}
function updateURL(){const p=new URLSearchParams({region,source:$('source-filter').value});if(selected)p.set('country',selected);history.pushState(null,'','#'+p);}
function readURL(){const p=new URLSearchParams(location.hash.slice(1));region=index.regions.some(r=>r.id===p.get('region'))?p.get('region'):'halann';selected=index.countries.some(c=>c.id===p.get('country'))?p.get('country'):null;$('source-filter').value=['eu4','v3','hist'].includes(p.get('source'))?p.get('source'):'all';}
function render(){
  $('register-view').hidden=Boolean(selected);$('country-detail').hidden=!selected;
  if(selected){renderDetail();return;}
  $('breadcrumbs').innerHTML=regionPath(index.regions,region).map((r,i)=>`${i?'<span aria-hidden="true"> / </span>':''}<button data-region="${esc(r.id)}" ${r.id===region?'aria-current="location"':''}>${esc(r.name)}</button>`).join('');
  const countries=countriesInRegion(index,region,$('source-filter').value),s=progressSummary(countries);
  const reconstructed=countries.filter(c=>c.annotation?.reconstruction?.status==='verified-model').length;
  $('reconstruction-summary').innerHTML=reconstructed?`本范围 <strong>${reconstructed}</strong> 个主体已完成连续推演核验；<a href="./continuity.html">查看年度版图与依据 →</a>。下方史实审校进度保留尚未确证的历史问题。`:'';
  $('progress-summary').innerHTML=`<div class="completion"><span>全期审校通过</span><strong>${s.percent===null?'—':s.percent.toFixed(1)}<small>${s.percent===null?'':'%'}</small></strong>${progressBar(s)}<p>${s.complete} / ${s.eligible} 项研究条目<span class="bar-key"></span>深灰为梳理中</p></div><div><strong>${s.started}</strong><span>梳理中</span><small>包括已收录的推测节点</small></div><div><strong>${s.registered}</strong><span>已登记 · 待研究</span><small>${s.withRecords} 项已有节点记录</small></div><div><strong>${s.total}</strong><span>来源条目</span><small>暂缓 ${s.deferred} · 系统 ${s.reference}</small></div>`;
  const children=index.regions.filter(r=>r.parent===region).map(r=>({...r,stats:progressSummary(countriesInRegion(index,r.id,$('source-filter').value))})).filter(r=>r.kind!=='source-region'||r.stats.total>0);
  $('region-section').hidden=!children.length;
  const direct=countries.filter(c=>c.region_id===region).length;
  $('region-context').textContent=direct?`${direct} 条直接归档于本层，其余可继续深入`:'点击地区查看子区域与国家';
  $('region-list').innerHTML=children.sort((a,b)=>b.stats.started-a.stats.started||b.stats.eligible-a.stats.eligible).map(r=>`<button class="region-card" data-region="${esc(r.id)}"><span>${esc(r.name)} <span aria-hidden="true">↗</span></span><small>${r.stats.total} 条登记 · ${r.stats.started} 项梳理中</small>${progressBar(r.stats)}<small>全期审校 ${r.stats.complete} / ${r.stats.eligible}${r.stats.deferred?' · 暂缓 '+r.stats.deferred:''}</small></button>`).join('');
  renderTable(countries);
}
function renderTable(countries=countriesInRegion(index,region,$('source-filter').value)){
  const matches=searchRegister(countries,$('register-search').value,$('status-filter').value);page=Math.min(page,Math.max(0,Math.ceil(matches.length/pageSize)-1));
  $('country-count').textContent=`${matches.length} 条匹配`;
  $('country-rows').innerHTML=matches.slice(page*pageSize,(page+1)*pageSize).map(c=>`<tr><td><button class="country-link" data-country="${esc(c.id)}">${esc(c.name_zh||c.name)}<small>${esc(c.name)} · ${esc(c.id)}</small></button>${countryEvidenceLabel(c)?`<small class="country-evidence-label">${esc(countryEvidenceLabel(c))}</small>`:''}</td><td><span class="status ${c.status}">${STATUS[c.status]}</span>${c.origin.firstPass?'<small>已有专题梳理</small>':''}</td><td>${distinctResearchRecords(c.recordIds.map(id=>index.records[id]).filter(Boolean)).length}</td><td>${c.issues.filter(i=>i.status==='open').length}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">此范围暂无匹配条目。可返回上一级或调整筛选。</td></tr>';
  $('previous-page').disabled=page===0;$('next-page').disabled=(page+1)*pageSize>=matches.length;$('page-number').textContent=`${page+1} / ${Math.max(1,Math.ceil(matches.length/pageSize))}`;
}
function renderDetail(){
  const c=index.countries.find(c=>c.id===selected),records=distinctResearchRecords(c.recordIds.map(id=>index.records[id]).filter(Boolean)),intervals=recordIntervals(records),links=groupCountryLinks(index.links,c.id);
  const open=c.issues.filter(i=>i.status==='open');
  const years=[...new Set(records.map(r=>r.year))].sort((a,b)=>a-b);
  $('country-detail').innerHTML=`<button class="back" data-back>← 返回地区目录</button><div class="detail-title"><div><p class="eyebrow">${esc(c.id)} · ${esc(regionPath(index.regions,c.region_id).map(r=>r.name).join(' / '))}</p><h1>${esc(c.name_zh||c.name)}</h1><p>${esc(c.name)}</p></div><span class="status ${c.status}">${STATUS[c.status]}</span></div>
    ${c.origin.summary||!canonAssessment(c)?`<p class="detail-summary">${esc(c.origin.summary||'已登记官方定义。是否在本时间段出现、如何成立及终结，仍需逐项考证。')}</p>`:''}
    ${c.origin.flagNote?`<section class="flag-source-note"><h2>来源标识旗</h2><p>${esc(c.origin.flagNote)}</p></section>`:''}
    ${renderResearchNotes(c)}${renderEndpointProjection(c)}${renderReconstruction(c)}
    ${c.publicNoticeQualifications?.length?`<p class="subtle public-notice-qualifications">${c.publicNoticeQualifications.map(esc).join(' ')}</p>`:''}${c.publicNoticeSourceIds?.length?`<details><summary>公众说明的补充来源（${c.publicNoticeSourceIds.length}）</summary><div class="source-links">${sourceLinks(c.publicNoticeSourceIds)}</div></details>`:''}
    <div class="detail-meta"><p>归档依据：${esc(c.origin.placementBasis)}${c.origin.anchorProvinceId?' · EU4 省份 '+c.origin.anchorProvinceId:''}${c.origin.capitalState?' · '+esc(c.origin.capitalState):''}</p><p>登记地区用于整理资料，不代表该国全部领土或历史存在范围。</p><p>存在期审校：${c.annotation?.existenceFrom!=null||c.annotation?.existenceTo!=null?`${esc(c.annotation.existenceFrom??'起点待考')}—${esc(c.annotation.existenceTo??'终点待考')}`:'尚未核定完整起止'}</p>${c.annotation?.note?(c.annotation?.researchNotes?.length?`<details><summary>研究汇总原文（含旧解释，当前裁决见下方资料）</summary><p>${esc(c.annotation.note)}</p></details>`:`<p>${esc(c.annotation.note)}</p><div class="source-links">${sourceLinks(c.annotation.sourceIds)}</div>`):''}${c.origin.holdsImperialTerritory1444?'<p>1444 文件中持有帝国省份；这一信息不能单独确认该国的帝国成员资格。</p>':''}</div>
    ${c.origin.geographicRegions?.length?`<p class="subtle">Vic3 官方地理分组：${esc(c.origin.geographicRegions.join(' / '))}</p><div class="source-links">${sourceLinks(c.origin.geographySourceIds)}</div>`:''}
    ${renderMechanisms(c)}
    <section><div class="section-heading"><h2>审校清单</h2><span>通过 ${c.reviews.filter(r=>r.status==='verified').length} / ${Object.keys(index.criteria).length} 项 · 未决 ${open.length} 项</span></div><div class="review-grid">${Object.entries(index.criteria).map(([key,label])=>{const r=c.reviews.find(r=>r.criterion===key);return `<article><strong>${esc(label)}</strong><span class="review-state ${r?.status}">${{verified:'已核验',in_progress:'梳理中',pending:'待审校'}[r?.status]||'待审校'}</span><p>${esc(r?.note)}</p><div class="source-links">${sourceLinks(r?.sourceIds)}</div></article>`;}).join('')}</div></section>
    <section><div class="section-heading"><h2>年代记录分布</h2><span>${records.length} 条 · ${records.filter(r=>r.kind==='hypothesis').length} 条推测</span></div><div class="record-strip" role="img" aria-label="已收录年份：${years.join('、')||'暂无'}；空白表示未收录，不是历史稳定">${years.map(y=>`<a href="${mapLink(c,{year:y})}" style="left:${(y-1444)/376*100}%" title="查看 ${y} 年地图" aria-label="查看 ${y} 年地图"></a>`).join('')}</div><div class="strip-labels"><span>1444</span><span>1530</span><span>1620</span><span>1710</span><span>1820</span></div><p class="subtle">这条线显示记录密度，不是已确证的连续历史。最大节点间隔：${intervals.slice(0,3).map(i=>`${i.start}—${i.end}（${i.gap} 年）`).join('；')||'暂无'}。前后段也计入资料缺口，不据此推断国家存续。</p></section>
    <section><div class="section-heading"><h2>待核问题</h2><span>${open.length} 项未解决</span></div><ul class="issue-list">${open.map(i=>`<li>${esc(i.text)}<small>${esc(i.id)}</small></li>`).join('')||'<li>没有登记未决问题；仍以审校清单为准。</li>'}</ul>${c.issues.some(i=>i.status==='resolved')?`<details><summary>已处理的问题</summary><ul>${c.issues.filter(i=>i.status==='resolved').map(i=>`<li>${esc(i.text)}<p>${esc(i.resolution)}</p>${sourceLinks(i.sourceIds)}</li>`).join('')}</ul></details>`:''}</section>
    <section><div class="section-heading"><h2>已收录的沿革</h2><a href="${mapLink(c)}">打开地图 →</a></div><div class="research-records">${records.map(r=>`<article><time>${esc(r.publicDateLabel)}</time><div><span class="status ${r.kind==='hypothesis'?'hypothesis':''}">${r.mapAction==='none'&&r.kind==='attested'?'来源记载 · 文字资料':kindLabels[r.kind]||esc(r.kind)}</span><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p>${modelNoteMarkup(r)}<p class="subtle">${esc(r.publicScopeLabel)}</p><details><summary>原记录与研究说明</summary><p>${esc(r.publicOriginal?.title)}</p><p>${esc(r.publicOriginal?.description)}</p>${r.publicOriginal?.geometryNote?`<p>${esc(r.publicOriginal.geometryNote)}</p>`:''}</details><div class="source-links"><a href="${mapLink(c,r)}">查看 ${r.year} 年地图 →</a>${sourceLinks(r.sourceIds)}</div></div></article>`).join('')||'<p class="subtle">尚未录入历史节点。官方定义只证明此 TAG 被定义，不证明其在任意年份必然存在。</p>'}</div></section>
    ${c.publicOriginalFields?.length?`<details><summary>原说明与研究依据</summary>${[...new Set(c.publicOriginalFields.map(x=>x.original))].map(text=>`<p>${esc(text)}</p>`).join('')}</details>`:''}
    ${links.length?`<section><h2>相关来源条目</h2><p class="subtle">保留各游戏和重建条目的独立身份，以下对应不会自动合并领土。同一对条目合并显示，保留不同的关系依据。</p><div class="linked-countries">${links.map(link=>{const related=index.countries.find(item=>item.id===link.id);return `<article><button data-country="${esc(link.id)}">${esc(related?.name_zh||related?.name||link.id)}<small>${esc(link.id)}</small></button>${link.relations.map(relation=>`<p><small>${esc(relationLabels[relation.relation]||relation.relation||'来源关联')}${relation.basis?' · '+esc(relation.basis):''}</small></p>`).join('')}<div class="source-links">${sourceLinks(link.sourceIds)}</div></article>`;}).join('')}</div></section>`:''}`;
}
document.addEventListener('click',e=>{const r=e.target.closest('[data-region]'),c=e.target.closest('[data-country]');if(r){region=r.dataset.region;selected=null;page=0;$('register-search').value='';updateURL();render();}else if(c){selected=c.dataset.country;updateURL();render();window.scrollTo(0,0);}else if(e.target.closest('[data-back]')){selected=null;updateURL();render();window.scrollTo(0,0);}});
$('source-filter').addEventListener('change',()=>{page=0;updateURL();render();});
for(const id of ['register-search','status-filter'])$(id).addEventListener(id==='register-search'?'input':'change',()=>{page=0;renderTable();});
$('previous-page').addEventListener('click',()=>{page--;renderTable();});$('next-page').addEventListener('click',()=>{page++;renderTable();});
window.addEventListener('popstate',()=>{readURL();page=0;render();});
try{const response=await fetch(new URL('./data/research-index.json',import.meta.url));if(!response.ok)throw new Error('资料快照加载失败');index=await response.json();const historyResponse=await fetch(new URL('./data/western-chronology.json',import.meta.url));if(!historyResponse.ok)throw new Error('模型版本资料加载失败');const chronology=await historyResponse.json();const copyResponse=await fetch(new URL('./data/public-copy.json',import.meta.url));if(!copyResponse.ok)throw new Error('公众文案未能加载');const publicView=createPublicDisplay({copy:await copyResponse.json(),steps:chronology.steps});index=createResearchPublicIndex(index,publicView);supersessions=chronology.modelSupersessions||[];modelReviews=createResearchModelReviews(chronology.modelReviewNotes||[],publicView);readURL();$('register-loading').hidden=true;$('completion-policy').textContent=index.policy.completion;$('inventory-policy').textContent=index.policy.coverage;$('register-updated').textContent='资料快照更新：'+index.metadata.updatedAt;render();}catch(error){$('register-loading').textContent='资料库未能加载，请确认本地数据完整后刷新。';console.error(error);}
