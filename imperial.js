// The imperial institution is separate from provincial ownership and map colour.
// Membership and legal claims are dated independently of the holder of the crown.
export function imperialRulerAtYear(history,baseline,year){
  if(year===1444&&baseline?.emperor)return {...baseline.emperor,countryTag:baseline.emperor.tag,sourceIds:[baseline.emperor.source].filter(Boolean)};
  return history?.rulers?.find(r=>year>=r.start&&year<r.endExclusive)||null;
}
const land=p=>p&&!p.water&&!p.wasteland&&!p.excluded;
const allowed=(entry,evidence)=>entry.certainty!=='hypothesis'||evidence==='reconstructed';

export function buildImperialView(atlas,baseline,history,year,evidence='reconstructed'){
  const regime=history.regimes?.find(r=>year>=r.start&&year<r.endExclusive)||{type:'empire'};
  const ruler=imperialRulerAtYear(history,baseline,year);
  const view={year,regime,ruler,available:false,classes:{},counts:{controlled:0,direct:0,claims:0,unknown:0,outsideLegal:0,members:0},notes:regime.notes?[regime.notes]:[],sourceIds:[...(regime.sourceIds||[])],memberTags:[]};
  if(evidence==='confirmed'&&year!==1444&&year!==1820){view.notes.push('当前仅显示开局确证资料；中间年代帝国疆域重建已隐藏。');return view;}
  const legal=new Set(),members=new Set(),direct=new Set();
  const isRepublic=regime.type==='republic';
  if(atlas.imperialCentralTag||atlas.geometryKey==='vic3'||isRepublic){
    const central=atlas.imperialCentralTag||(atlas.geometryKey==='vic3'?'v3:A01':'hist:anbennar');
    direct.add(central);members.add(central);
    // At the modern endpoint only explicitly recorded subject relationships
    // extend the central state's control; former princes are not auto-annexed.
    let changed=true;
    while(changed){changed=false;for(const relation of Object.values(atlas.relations||{})){
      if(relation.control==='tributary'||/^tributary(?:_|$)/.test(relation.type||''))continue;
      if(members.has(relation.overlord)&&!members.has(relation.subject)){members.add(relation.subject);changed=true;}
    }}
    view.notes.push('共和时期显示当前已收录的中央与附属领土；不沿用旧帝国成员名册。境外法理／宣称尚未完成重建。');
    if(year!==1820)view.notes.push('本时期按已收录地区显示中央及附属领土；含推测模式采用已审推演，未标亮的范围外地区不表示已确认脱离安本纳尔。');
  }else{
    for(const id of baseline.legalProvinceIds||[])legal.add(id);
    for(const tag of baseline.memberTags||[])members.add(tag);
    for(const step of history.jurisdictionSteps||[]){
      if(step.year>year||!allowed(step,evidence))continue;
      for(const tag of step.joinTags||[])members.add(tag);
      for(const tag of step.leaveTags||[])members.delete(tag);
      for(const id of step.addProvinceIds||[])legal.add(id);
      for(const id of step.removeProvinceIds||[])legal.delete(id);
      if(step.notes)view.notes.push(step.notes);
      view.sourceIds.push(...(step.sourceIds||[]));
    }
    for(const tag of ruler?.directCountryTags||[ruler?.countryTag].filter(Boolean)){direct.add(tag);members.add(tag);}
    // A sourced shared ruler may hold an external kingdom without thereby
    // extending the Empire's de jure boundary or annexing its local territory.
    const graph={...atlas.relations,...atlas.offmapRelations};
    let expanded=true;const crownDependants=new Set(direct);
    while(expanded){expanded=false;for(const relation of Object.values(graph)){
      if(relation.control==='tributary'||/^tributary(?:_|$)/.test(relation.type||''))continue;
      if(direct.has(relation.overlord)&&relation.sharedSovereign&&!direct.has(relation.subject)){
        direct.add(relation.subject);expanded=true;
      }
      if(crownDependants.has(relation.overlord)&&!crownDependants.has(relation.subject)){
        crownDependants.add(relation.subject);members.add(relation.subject);expanded=true;
      }
    }}
    if([...direct].some(tag=>!ruler?.directCountryTags?.includes(tag)))view.notes.push('皇域与西部帝室领按已记载的共享君主关系显示；这不将东部全境自动计入帝国法理范围，也不取消地方主体。');
    if(year>1444)view.notes.push('帝国法理范围以 1444 标记为基准，应用已核变化；未核部分暂沿用。实控依据当前地图的政权归属，含其重建与推测。');
  }
  const controllingTags=new Set();
  for(const p of Object.values(atlas.provinces)){
    if(!land(p))continue;
    const inLegal=legal.has(p.id),known=p.coverage!==false&&!p.sourceConflict;
    const controller=known?(p.controller||p.owner):null;
    let kind=0;
    if(controller&&direct.has(controller))kind=2;
    else if(controller&&members.has(controller))kind=1;
    else if(inLegal)kind=controller?3:4;
    if(!kind)continue;
    view.classes[p.id]=kind;
    if(kind<=2){view.counts.controlled++;controllingTags.add(controller);if(!inLegal&&!isRepublic&&atlas.geometryKey!=='vic3')view.counts.outsideLegal++;}
    if(kind===2)view.counts.direct++;
    if(kind===3)view.counts.claims++;
    if(kind===4)view.counts.unknown++;
  }
  view.counts.members=controllingTags.size;view.memberTags=[...members];view.available=Object.keys(view.classes).length>0;
  if(!isRepublic&&ruler&&!view.counts.direct)view.notes.push('皇帝所属政权的直接领地尚未在当前地图中完整对应，不以全部诸侯领土替代。');
  view.sourceIds.push(...(ruler?.sourceIds||[]));view.sourceIds=[...new Set(view.sourceIds)];
  return view;
}

export function imperialZoneLabel(kind,isRepublic=false){return ({1:isRepublic?'中央附属领土':'帝国成员控制领土',2:isRepublic?'安本纳尔中央领土':'皇帝本国直接领土',3:'境外控制的帝国法理／已核宣称',4:'帝国法理范围 · 当年控制待核'})[kind]||'';}
