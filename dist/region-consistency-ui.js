const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function loadRegionConsistency(actors){
  const section=document.getElementById('audit-regions');
  try{
    const response=await fetch('./data/region-consistency.json');if(!response.ok)throw new Error('Region audit unavailable');
    const data=await response.json(),name=tag=>tag?(actors[tag]?.nameZh||actors[tag]?.name||tag):'来源未指定控制者';
    const referenceNames={north_salahad_superregion:'北萨拉哈德',rahen_superregion:'拉亨',middle_serpentspine_superregion:'中蛇脊',west_serpentspine_superregion:'西蛇脊',deepwoods_portal_superregion:'深木门户'};
    const label=g=>data.groups[g]?.label||referenceNames[g]||g;
    const referenceCount=data.referenceProvinceCount??data.coveredProvinceCount-data.coreProvinceCount;
    section.innerHTML=`<h2>地区交界核验</h2><p class="subtle">${data.coreProvinceCount}个完整地区本土省份，加${referenceCount}个已逐省纳入的外区省份；${data.borderEdgeCount}组跨区接壤，逐年核对${data.jointBorderYears.toLocaleString()}次。${data.status==='passed'?'模型检查通过':'存在待修复问题'}；${data.unresolvedBoundaryProvinceIds.length}个边界省仍有历史衔接待证。</p><p class="subtle">${esc(data.policy)}</p><label for="audit-border">选择接壤省份</label><select id="audit-border">${data.boundaries.map((e,i)=>`<option value="${i}">${esc(label(e.groupA))}／${esc(label(e.groupB))} · ${e.a} ${esc(e.nameA)} ↔ ${e.b} ${esc(e.nameB)}</option>`).join('')}</select><div id="audit-border-detail"></div><details><summary>跨地区交接约束与范围</summary><p class="subtle">外区只表示已纳入的国家领土，不代表当地整个大区已研究完成。范围之外的${data.externalEdgeCount}组陆地邻接另作范围提示；条件门户不计作永久接壤。</p><ul>${data.stateContracts.map(c=>`<li>${c.startYear}—${c.endYear} · ${esc(c.title||c.id)}：${esc(c.reason)}</li>`).join('')}</ul></details>`;
    const select=document.getElementById('audit-border'),detail=document.getElementById('audit-border-detail');
    const show=()=>{
      const e=data.boundaries[Number(select.value)];if(!e)return;
      detail.innerHTML=`<p class="subtle"><a href="?province=${e.a}">${e.a} ${esc(e.nameA)}：逐省来源</a> ↔ <a href="?province=${e.b}">${e.b} ${esc(e.nameB)}：逐省来源</a>${e.blocked?' · 原MOD标注不可通行':''}</p><div class="audit-table"><table><thead><tr><th>年份</th><th>${esc(e.nameA)}</th><th>${esc(e.nameB)}</th></tr></thead><tbody>${e.intervals.map(i=>`<tr><td>${i.start}${i.start===i.end?'':'—'+i.end}</td><td>${esc(name(i.ownerA))}${i.overlordA?`<small>最终宗主：${esc(name(i.overlordA))}</small>`:''}</td><td>${esc(name(i.ownerB))}${i.overlordB?`<small>最终宗主：${esc(name(i.overlordB))}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`;
    };select.addEventListener('change',show);show();section.hidden=false;
  }catch(error){section.hidden=false;section.innerHTML='<h2>地区交界核验</h2><p>交界核验尚未载入，不能据此认定检查通过。</p>';console.error(error);}
}
