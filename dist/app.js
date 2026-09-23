import {qualifiedPixelColor,qualificationSummary,qualificationPaintSignature,qualificationDisplayText,loadQualificationPreference,saveQualificationPreference} from './political-qualification.js';
import {endpointReviewEntry} from './endpoint-review.js';
import { createPublicDisplay } from './public-display.js';
import { validateBookmarks, renderBookmarks } from './bookmarks.js';
import { buildReconstruction, eraAtYear, territorialChangesAtYear, stepChanges, countryRecords, provinceCoverageNote } from './reconstruction.js';
import { stepLocationProvinceIds } from './step-location.js';
import { eventsAtYear, eventYears, eventDateLabel as originalEventDateLabel, eventBoundaryTitle, supersededModelNote, displayRecordTitle as originalRecordTitle } from './records.js';
import { recordKindLabel, findDossier, searchDossiers, currentDossierCountry, countryHistoryTag, dossierCurrentMarkup } from './dossiers.js';
import { FIRST_YEAR, LAST_YEAR, validYear, visibleProvince, resolveColor, countryName, searchableCountries } from './model.js';
import { mapPoint, circularBounds, worldFrame, clippedCopies, frameContains, constrainCamera, adaptiveFitScale } from './viewport.js';
import { buildTypedBorderTiles, buildProvinceBorderTiles, traceBorderPaths, buildMaskTiles, tileVisible, BORDER_SEGMENT_STRIDE } from './map-renderer.js';
import { surfaceKind, surfaceColor, surfaceLabel, boundaryStyle } from './boundary-style.js';
import { selectionBoundaryWidth } from './boundary-scale.js';
import { createOverlayPainter } from './overlay-renderer.js';
import { changesAtYear, changePhase, changeColor, changeLabel, shouldHighlightChange } from './history.js';
import { evidenceCounts, classifyOverlay, annualChangeEvidence } from './evidence.js';
import { buildImperialView, imperialZoneLabel } from './imperial.js';
import { buildImperialTiles, paintImperialFill } from './imperial-renderer.js';
import { overlayBackground } from './overlay-background.js';
import { buildSubjectBorderTiles, paintSubjectBorders } from './subject-boundary-renderer.js';
import { attachSubjectClipPaths } from './subject-clip.js';
import { buildProvincePaintTiles } from './province-boundary-renderer.js';
import { provinceBoundaryStyle } from './province-boundary-style.js';
import { relativeLuminance } from './overlay-contrast.js';
import { renderSurfaceSize } from './render-quality.js';
import { initializeMapFullscreen } from './fullscreen.js';
import { buildEndpointView } from './endpoint.js';
import { buildRelationSemantics, relationSemanticsMarkup } from './relation-semantics.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { year: FIRST_YEAR, mode: 'original', evidence: 'reconstructed', selected: null, selectedChange: null, dossier:null, tab: 'country', hovered: null, searchIndex: -1 };
const layers = {hypothesis:true, projection:false, continued:false, changes:true, provinces:false, imperial:false, qualification:loadQualificationPreference()};
let atlas, names = {}, relations = {}, events = [], idPixels, ownerIndex, kinds, countryTags;
let history, chronology, eras, baseAtlas, baseRelations, eu4IdsImage, endpointBundlePromise;
let dossiers;
let bookmarks=[];
let publicView=createPublicDisplay(), publicEventObjects=new WeakSet(), publicStepObjects=new WeakSet();
function publicRecord(record,surface) {
  surface=surface||(publicEventObjects.has(record)?'events':publicStepObjects.has(record)?'steps':'records');
  return publicView.record(record,{surface});
}
function displayRecordTitle(record) { const p=publicRecord(record);return p.matchBasis==='unmatched-original-fallback'?originalRecordTitle(record):p.title; }
function eventDateLabel(record) { return publicRecord(record,'events').dateLabel; }
function publicCertaintyMarkup(p) {
  return `<p class="public-certainty">${escape([p.certaintyLabel,p.scopeLabel,p.sourceWindowLabel].filter(Boolean).join(' '))}</p>`;
}
function originalRecordDetails(record,p=publicRecord(record)) {
  const o=p.original;
  return `<details class="public-original"><summary>原记录与研究说明</summary>${o.title?`<p>${escape(o.title)}</p>`:''}${o.description?`<p>${escape(o.description)}</p>`:''}${o.geometryNote?`<p>${escape(o.geometryNote)}</p>`:''}${o.reasoning?`<p>${escape(o.reasoning)}</p>`:''}${(record.alternatives||[]).map(x=>`<p>${escape(x)}</p>`).join('')}${p.dateEvidence?.basis?`<p>${escape(typeof p.dateEvidence.basis==='string'?p.dateEvidence.basis:JSON.stringify(p.dateEvidence.basis,null,2))}</p>`:''}</details>`;
}
function publicModelNoteMarkup(record) {
  const raw=supersededModelNote(record,chronology.modelSupersessions,chronology.modelReviewNotes);
  if(!raw)return '';
  const index=(chronology.modelReviewNotes||[]).findIndex(r=>r.recordIds.some(id=>[record.id,record.originRecordId].includes(id)));
  const p=index>=0?publicView.notice(`western-chronology.json:/modelReviewNotes/${index}/note`,raw):{description:raw,original:raw,scopeLabel:''};
  return `<p class="dossier-hidden-note">${escape(p.description)}${p.scopeLabel?' '+escape(p.scopeLabel):''}</p>${p.description!==raw?`<details class="public-original"><summary>原版本说明</summary><p>${escape(raw)}</p></details>`:''}`;
}
function countryPublicIntro(country) {
  const p=publicView.country(country);
  return `<p class="dossier-intro">${escape(p.summary)}</p>${p.scopeLabel?`<p class="public-certainty">${escape(p.scopeLabel)}</p>`:''}${p.summary!==p.original.summary?`<details class="public-original"><summary>原摘要与研究说明</summary><p>${escape(p.original.summary)}</p></details>`:''}`;
}
let relationSemanticRegistry, relationSemanticView, endpointReviewRegistry;
function endpointReviewMarkup(province){
  const review=province?.endpointReview||endpointReviewEntry(endpointReviewRegistry,province?.id,state.year);
  return review?`<small class="endpoint-review-note">${escape(qualificationDisplayText(publicView.notice('haless-quality-endpoint-label:/'+review.decisionId,review.publicText).description))} <a href="./endpoint-review.html?province=${province.id}">逐省依据</a></small>`:'';
}
function countryEndpointReviewMarkup(country){
  if(![1819,1820].includes(state.year))return '';
  const entries=(endpointReviewRegistry?.entries||[]).filter(r=>country.provinceIds.includes(r.provinceId)||(state.year===1820?r.comparisonAfter?.owner:r.comparisonBefore?.owner)===country.tag);
  if(!entries.length)return '';
  const gaps=entries.filter(r=>['withhold-conflicted-projection','qualified-prior-stage-continuation'].includes(r.displayPolicy)),process=entries.filter(r=>/process|status-observation/.test(r.category));
  return `<section class="event-geography endpoint-review-context"><h2>端点对照及其限度</h2><p>本国涉及${entries.length}处已审对照${gaps.length?`；其中${gaps.length}处位置或来源冲突，1820底色仅作前阶段延续或待核表示，彩色条纹可自行开启，不确认整省主权`:''}${process.length?`；${process.length}处政治过程或宗属起点尚未定年`:''}。原始局势与图示范围分别保留。</p>${[...gaps,...process].filter((r,i,a)=>a.findIndex(x=>x.publicText===r.publicText)===i).map(r=>`<p>${escape(qualificationDisplayText(publicView.notice('haless-quality-endpoint-label:/'+r.decisionId,r.publicText).description))} ${[...gaps,...process].filter(x=>x.publicText===r.publicText).map(x=>`<a href="./endpoint-review.html?province=${x.provinceId}">${escape(x.name)} · ${x.provinceId}</a>`).join('、')}</p>`).join('')}<details><summary>查看全部${entries.length}处具体说明</summary>${entries.map(r=>`<p><a href="./endpoint-review.html?province=${r.provinceId}">${escape(r.name)} · ${r.provinceId}</a>：${escape(qualificationDisplayText(publicView.notice('haless-quality-endpoint-label:/'+r.decisionId,r.publicText).description))}</p>`).join('')}</details></section>`;
}
const administrationMarkup = (subject,kind) => relationSemanticsMarkup(relationSemanticView,subject,kind,tag=>countryName(atlas.countries[tag]||atlas.offmapActors?.[tag]||{name:tag}));
let imperialBaseline=null,imperialHistory=null,imperialRequest=null,imperialLoadFailed=false,imperialView=null,imperialTiles=null,imperialSignature=null;
let activeChanges=[], annualChanges=[], visibleAnnualChanges=[], overlayTiles=[], viewRequest=0, pendingView=Promise.resolve(), currentGeometry=null, currentSignature=null;
let borderTiles=[], provinceBorderTiles=null, selectionOffset={x:0,y:0};
let provinceSourceTiles=null,provincePaintSignature=null;
let subjectBorders=null,subjectBorderSignature=null;
let mapWidth = 0, mapHeight = 0, cssWidth = 0, cssHeight = 0;
let scale = 1, fitScale = 1, tx = 0, ty = 0, ready = false, drawPending = false, resizePending = false;
const MAX_SCALE=12, MIN_ZOOM=1, MAX_SURFACE_PIXELS=24_000_000;
let renderQuality=3, borderWeight=3, provinceBorderWeight=1;
const canvas = $('map'), context = canvas.getContext('2d');
const overlayPainter=createOverlayPainter();
const political = document.createElement('canvas'), geographic = document.createElement('canvas');
const selection = document.createElement('canvas');
let politicalImage, geographicalImage, lastPointer = null, searchMatches = [];
const pointers = new Map();
let drag = null, pinch = null, pointerMoved = false;
const dataUrl = file => new URL(`./data/${file}`, import.meta.url).href;
const flagMarkup = country => country.localPoliticalGroup ? '<span class="flag-pending">分散地方势力</span>' : country.flag ? `<img src="${dataUrl(country.flag)}" alt="${escape(countryName(country))}标识旗" title="${escape(country.flagNote||'模组中的国家标识；历史旗式与采用年代未定。')}" loading="lazy">` : '<span class="flag-pending">旗帜待核</span>';
const relationType = relation => ({ puppet:'傀儡国', vassal: '附庸国', march: '卫戍国', personal_union: '被联统国', tributary_state_anb: '朝贡国' }[relation.type] || (relation.typeLabel?publicView.notice('relation-type-label:/'+String(relation.typeLabel).replaceAll('~','~0').replaceAll('/','~1'),relation.typeLabel).description:relation.type));

async function json(file) {
  const response = await fetch(dataUrl(file));
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.json();
}
function imageFile(file) {
  return new Promise((resolve,reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`图片加载失败: ${file}`)); img.src = dataUrl(file); });
}
function hasPoliticalView() {return ready&&atlas?.year===state.year&&atlas.stats.politicalProvinces>0;}
async function loadEndpoint() {
  if(!endpointBundlePromise)endpointBundlePromise=Promise.all([json('endpoint-1820.json'),json('endpoint-country-identities.json')]).catch(error=>{endpointBundlePromise=null;throw error;});
  return endpointBundlePromise;
}
async function applyYearView(request) {
  const year=state.year,evidence=state.evidence;
  let view,idsImage,rawEndpointRelations=null;
  if(year===LAST_YEAR) {
    $('loading-text').textContent='正在读取 1820 开局的 EU4 省形映射…';
    const [endpoint,identities]=await loadEndpoint();
    rawEndpointRelations=endpoint.subjects||endpoint.relations||[];
    view=buildEndpointView(baseAtlas,endpoint,identities,evidence,{remoteExtrapolation:$('endpoint-remote').checked,reviewRegistry:endpointReviewRegistry});
    idsImage=eu4IdsImage;
  } else {
    view=buildReconstruction(baseAtlas,baseRelations,chronology,year,evidence);idsImage=eu4IdsImage;
  }
  if(request!==viewRequest)return;
  const geometryChanged=currentGeometry!==view.geometryKey,politicsChanged=currentSignature!==view.signature;
  const qualificationChanged=layers.qualification&&qualificationPaintSignature(atlas)!==qualificationPaintSignature(view);
  atlas=view;relations=view.relations;mapWidth=view.width;mapHeight=view.height;
  relationSemanticView=buildRelationSemantics(view,relationSemanticRegistry,rawEndpointRelations);
  if(geometryChanged)decodeMap(idsImage);else if(politicsChanged)updateLookup();
  currentGeometry=view.geometryKey;
  if(politicsChanged)buildMapLayers();else if(qualificationChanged)recolor();
  currentSignature=view.signature;
  ready=true;if(layers.imperial)buildImperialLayer(true);if(layers.provinces)buildProvinceLayer();if(state.mode==='subjects')buildSubjectLayer();buildSelection();buildOverlayLayers();
  $('loading').hidden=true;
  $('endpoint-options').hidden=year!==LAST_YEAR;
  $('endpoint-remote').disabled=evidence!=='reconstructed';
  refreshYearUI();
  if(geometryChanged||resizePending)resize();
  // A year change never reframes the map. Initial layout and real resizes
  // are handled above; focus controls remain explicit user actions.
  requestDraw();
}
function requestYearView() {
  const request=++viewRequest;
  ready=false;$('loading').hidden=false;$('loading-text').textContent='正在更新历史版图…';
  pendingView=new Promise(resolve=>requestAnimationFrame(resolve)).then(()=>request===viewRequest?applyYearView(request):undefined).catch(error=>{
    if(request!==viewRequest)return;
    console.error(error);$('loading-text').textContent='此年份地图加载失败，请重新选择年份或重新加载。';$('reload-button').hidden=false;
  });
}
function createEraMarkers() {
  $('era-track').innerHTML=eras.eras.map(era=>`<button class="era-segment" style="flex:${era.displayEnd-era.displayStart}" data-year="${era.displayStart}" data-era="${era.id}" title="${escape(era.nameZh)}：${era.displayStart===FIRST_YEAR?'1444年开局参照':`约${era.displayStart}年起的参考分期`}。时代仅为阅读参照，不能确定各地历史事件、疆界或转属日期。"><span>${escape(era.nameZh)}</span><small>${era.displayStart===FIRST_YEAR?'1444 起':`约 ${era.displayStart} 起`}</small></button>`).join('');
}
function focusCoverage() {
  if(!ready){const request=viewRequest;pendingView.then(()=>{if(ready&&request===viewRequest)focusCoverage();});return;}
  const countries=Object.values(atlas.countries);if(!countries.length)return;
  const [x0,x1]=circularBounds(countries.map(c=>c.bounds),mapWidth),y0=Math.min(...countries.map(c=>c.bounds[1])),y1=Math.max(...countries.map(c=>c.bounds[3]));
  scale=Math.min(3,Math.max(fitScale,Math.min((cssWidth-80)/(x1-x0),(cssHeight-100)/(y1-y0+1))));
  tx=cssWidth/2-(x0+x1)*.5*scale;ty=cssHeight/2-(y0+y1)*.5*scale;constrain();resetGestureOrigin();hideTooltip();requestDraw();
}
async function init() {
  try {
    const [mapData, chinese, subjectData, eventData, historyData, chronologyData, eraData, idsImage, dossierData] = await Promise.all([json('atlas.json'),json('names-zh.json'),json('subjects.json'),json('events.json'),json('history.json'),json('western-chronology.json'),json('eras.json'),imageFile('province-id.png'),json('country-histories.json')]);
    dossiers=dossierData;
    relationSemanticRegistry=await json('relation-semantics.json');
    endpointReviewRegistry=await json('endpoint-review.json');
    bookmarks=validateBookmarks(await json('bookmarks.json'),eventData);
    publicView=createPublicDisplay({copy:await json('public-copy.json'),steps:chronologyData.steps});
    publicEventObjects=new WeakSet(eventData);publicStepObjects=new WeakSet(chronologyData.steps);
    atlas = mapData; baseAtlas=mapData; eu4IdsImage=idsImage; chronology=chronologyData; eras=eraData; names = chinese; history=historyData; events = eventData.sort((a,b) => a.year-b.year);
    relations = Object.fromEntries(subjectData.filter(r => atlas.countries[r.subject] && atlas.countries[r.overlord]).map(r => [r.subject,r]));
    for (const country of Object.values(atlas.countries)) country.nameZh = chinese.countries[country.tag] || '';
    for (const province of Object.values(atlas.provinces)) province.nameZh = chinese.provinces[province.id] || '';
    baseRelations=relations;
    mapWidth = atlas.width; mapHeight = atlas.height;
    if (idsImage.naturalWidth !== mapWidth || idsImage.naturalHeight !== mapHeight) throw new Error('省份图与数据尺寸不一致');
    $('source-stats').textContent = `${baseAtlas.stats.countries} 个 EU4 开局国家 · ${baseAtlas.stats.politicalProvinces.toLocaleString()} 个有主省份。底图 ${mapWidth} × ${mapHeight}。`;
    createEventMarkers();createEraMarkers();renderDossier();
    const params=new URLSearchParams(location.search);
    $('endpoint-remote').checked=params.get('remote')==='1';
    setYear(params.has('year')&&validYear(params.get('year'))?Number(params.get('year')):FIRST_YEAR);
    await pendingView;
    if(params.has('country'))selectCountry(params.get('country'),{focus:true});
    if(params.has('dossier'))openDossier(params.get('dossier'));
    if(params.has('event'))focusEvent(params.get('event'));
    installWebTools();
    $('announcement').textContent = `地图已就绪。${state.year} 年，${atlas.coverage.title}，共 ${atlas.stats.countries} 个国家与地方政治主体。`;
  } catch (error) {
    console.error(error);
    $('loading-text').textContent = '地图资料未能加载，请确认本地服务和数据文件完整。';
    document.querySelector('.spinner').hidden = true;
    $('reload-button').hidden = false;
    $('map-status').textContent = '加载失败';
  }
}

function decodeMap(image) {
  const decoder = document.createElement('canvas'); decoder.width = mapWidth; decoder.height = mapHeight;
  const dc = decoder.getContext('2d', { willReadFrequently: true }); dc.drawImage(image,0,0);
  const rgba = dc.getImageData(0,0,mapWidth,mapHeight).data;
  idPixels = new Uint16Array(mapWidth*mapHeight);
  for(let pixel=0,channel=0;pixel<idPixels.length;pixel++,channel+=4) idPixels[pixel] = rgba[channel]+256*rgba[channel+1];
  decoder.width = decoder.height = 1;
  updateLookup();
}
function updateLookup() {
  const maxId = Math.max(...Object.keys(atlas.provinces).map(Number));
  ownerIndex = new Uint16Array(maxId+1); kinds = new Uint8Array(maxId+1);kinds.fill(3);
  countryTags = [''].concat(Object.keys(atlas.countries));
  const countryIndex = Object.fromEntries(countryTags.map((tag,index) => [tag,index]));
  for (const province of Object.values(atlas.provinces)) {
    kinds[province.id] = surfaceKind(province,atlas.countries);
    if(visibleProvince(province)) ownerIndex[province.id] = countryIndex[province.owner] || 0;
  }
}
function buildMapLayers() {
  subjectBorders=null;subjectBorderSignature=null;
  provinceBorderTiles=null;provinceSourceTiles=null;provincePaintSignature=null;
  for(const layer of [political,geographic]) { layer.width = mapWidth; layer.height = mapHeight; }
  politicalImage = new ImageData(mapWidth,mapHeight); geographicalImage = new ImageData(mapWidth,mapHeight);
  const geo = geographicalImage.data;
  for(let i=0,p=0;i<idPixels.length;i++,p+=4) {
    const id = idPixels[i], kind = kinds[id];
    const color = surfaceColor(kind);
    geo[p]=color[0];geo[p+1]=color[1];geo[p+2]=color[2];geo[p+3]=255;
  }
  borderTiles=buildTypedBorderTiles(idPixels,ownerIndex,kinds,mapWidth,mapHeight).tiles.map(tile=>{
    const path=new Path2D();
    for(const points of traceBorderPaths(tile.segments)){
      path.moveTo(points[0],points[1]);
      for(let i=2;i<points.length;i+=2)path.lineTo(points[i],points[i+1]);
    }
    return {...tile,path,selectionPath:null};
  });
  canvas.dataset.boundaryKinds=[...new Set(borderTiles.map(tile=>tile.kind))].sort().join(',');
  geographic.getContext('2d').putImageData(geographicalImage,0,0);
  recolor();
}
function buildProvinceLayer() {
  if(!ready||!layers.provinces)return;
  if(provinceSourceTiles===null)provinceSourceTiles=buildProvinceBorderTiles(idPixels,ownerIndex,mapWidth,mapHeight).tiles;
  const imperial=layers.imperial&&imperialView?.available;
  const signature=imperial?imperialSignature:'normal';
  if(provinceBorderTiles!==null&&provincePaintSignature===signature)return;
  provinceBorderTiles=buildProvincePaintTiles(provinceSourceTiles,countryTags,imperial?imperialView.classes:{});
  provincePaintSignature=signature;
}
function buildSubjectLayer(){
  if(!ready||state.mode!=='subjects')return;
  const signature=JSON.stringify(Object.values(relations).map(r=>[r.subject,r.overlord,r.type,r.control]));
  if(subjectBorders&&subjectBorderSignature===signature)return;
  const built=buildSubjectBorderTiles(borderTiles,countryTags,relations,{worldWidth:mapWidth});
  subjectBorders={...built,tiles:attachSubjectClipPaths(built.tiles,idPixels,ownerIndex,mapWidth,mapHeight)};
  subjectBorderSignature=signature;
}
function loadImperialData(){
  if(imperialRequest)return;
  imperialLoadFailed=false;
  imperialRequest=Promise.all([json('imperial-baseline.json'),json('imperial-history.json')]).then(([baseline,history])=>{
    imperialBaseline=baseline;imperialHistory=history;buildImperialLayer();renderLegend();requestDraw();
  }).catch(error=>{console.warn('帝国资料加载失败',error);imperialLoadFailed=true;imperialRequest=null;renderImperialInfo();});
}
function buildImperialLayer(deferOverlay=false){
  if(!layers.imperial){renderImperialInfo();if(layers.provinces)buildProvinceLayer();return;}
  if(!ready)return;
  if(!imperialBaseline||!imperialHistory){if(!imperialLoadFailed)loadImperialData();renderImperialInfo();return;}
  imperialView=buildImperialView(atlas,imperialBaseline,imperialHistory,state.year,state.evidence);
  const signature=atlas.geometryKey+':'+Object.entries(imperialView.classes).map(([id,kind])=>`${id}=${kind}`).join(',');
  if(signature!==imperialSignature){
    const classes=new Uint8Array(ownerIndex.length);
    for(const [id,kind] of Object.entries(imperialView.classes))classes[id]=kind;
    imperialTiles=imperialView.available?buildImperialTiles(idPixels,classes,mapWidth,mapHeight):null;
    imperialSignature=signature;
  }
  renderImperialInfo();if(!deferOverlay){if(layers.provinces)buildProvinceLayer();buildOverlayLayers();}
}
function renderImperialInfo(){
  $('imperial-summary').hidden=!layers.imperial;$('imperial-details').hidden=!layers.imperial;$('imperial-map-legend').hidden=!layers.imperial;
  if(!layers.imperial)return;
  if(!imperialView){
    $('imperial-summary').textContent=imperialLoadFailed?'帝国资料加载失败':'正在读取帝国资料…';
    $('imperial-details').innerHTML=imperialLoadFailed?'<button class="text-button" data-retry-imperial>重新读取帝国资料</button>':'<p>帝国资料首次开启时读取。</p>';return;
  }
  const view=imperialView,ruler=view.ruler,rep=view.regime.type==='republic';
  $('imperial-map-legend').innerHTML=view.available?`<span><i class="imperial-swatch members"></i>${rep?'中央与附属':'帝国实控'}</span><span><i class="imperial-swatch direct"></i>${rep?'中央直属':'皇帝本国'}</span><span><i class="imperial-swatch claims"></i>境外宣称（保留政治底色）</span><span><i class="imperial-swatch unknown"></i>控制待核</span>`:'';
  const person=ruler?(ruler.nameZh||ruler.person||ruler.name||'姓名待核'):(rep?'无在位皇帝':'当年皇帝待核');
  const rulerCountry=ruler?.countryTag&&atlas.countries[ruler.countryTag];
  $('imperial-summary').textContent=`${state.year} · ${rep?(view.regime.label||'安本纳尔共和国'):'帝国皇帝'} · ${person}`;
  const sources={...imperialBaseline.sources,...imperialHistory.sources};
  const links=view.sourceIds.map(id=>sources[id]).filter(Boolean).map(source=>/^https?:\/\//.test(source.url||'')?`<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)} ↗</a>`:`<span>${escape(source.title||source.path||'MOD 源记录')}</span>`).join('');
  $('imperial-details').innerHTML=`<p class="imperial-ruler"><strong>${escape(person)}</strong>${rulerCountry?`<br>${escape(countryName(rulerCountry))}`:''}${ruler?.person&&ruler.nameZh?`<br><small>${escape(ruler.person)}</small>`:''}</p><div class="imperial-key"><span><i class="imperial-swatch members"></i>${rep?'中央与附属':'成员控制'} ${view.counts.controlled} 省</span><span><i class="imperial-swatch direct"></i>${rep?'中央直属':'皇帝本国'} ${view.counts.direct} 省（含于实控）</span><span><i class="imperial-swatch claims"></i>境外法理／宣称 ${rep?'待核':view.counts.claims+' 省'}</span>${view.counts.unknown?`<span><i class="imperial-swatch unknown"></i>控制待核 ${view.counts.unknown} 省</span>`:''}</div>${view.counts.outsideLegal?`<p>实控中含 ${view.counts.outsideLegal} 省诸侯境外领地，不自动扩大帝国法理范围。</p>`:''}${!view.available?'<p>当前没有可显示的帝国范围。</p>':''}${view.notes.slice(-5).map(note=>`<p>${escape(Array.isArray(note)?note.join(' '):note)}</p>`).join('')}<p>实控统一采用安本纳尔白色，皇帝本国采用达梅里亚青色；境外宣称保留当前国家或宗主模式的政治底色，只叠加横短线，控制待核用灰底十字。横短线与十字随地图缩放，低缩放保留可读性下限。各国边界与点击身份保留。宣称只收录已有依据的部分，不合并所有任务目标。</p><details><summary>帝国图层来源</summary><div class="imperial-sources">${links}</div></details>`;
}
function recolor() {
  if (!atlas || !politicalImage) return;
  const palette = countryTags.map(tag => tag ? resolveColor(tag,atlas.countries,relations,state.mode) : null);
  const data=politicalImage.data, geo=geographicalImage.data;
  data.set(geo);
  for(let i=0,p=0;i<idPixels.length;i++,p+=4) {
    const owner=ownerIndex[idPixels[i]];
    if(owner) {const color=qualifiedPixelColor(atlas.provinces[idPixels[i]].politicalQualification,palette[owner],i%mapWidth,Math.floor(i/mapWidth),layers.qualification);for(let channel=0;channel<3;channel++)data[p+channel]=color[channel];}
  }
  political.getContext('2d').putImageData(politicalImage,0,0);
  requestDraw();
}
function buildSelection() {
  selection.width=selection.height=1;selectionOffset={x:0,y:0};
  for(const tile of borderTiles)tile.selectionPath=null;
  requestDraw();
  if(!state.selected||!atlas.countries[state.selected]){state.selected=null;return;}
  const sc=selection.getContext('2d');
  const country=atlas.countries[state.selected], bounds=country.bounds;
  const minX=Math.max(0,bounds[0]-2),minY=Math.max(0,bounds[1]-2),w=Math.min(mapWidth-minX,bounds[2]-minX+3),h=Math.min(mapHeight-minY,bounds[3]-minY+3);
  selection.width=w;selection.height=h;selectionOffset={x:minX,y:minY};
  const patch=new ImageData(w,h);
  const index=countryTags.indexOf(state.selected);
  for(const tile of borderTiles){
    const s=tile.segments;let path=null;
    for(let i=0;i<s.length;i+=BORDER_SEGMENT_STRIDE){
      if(s[i+4]!==index&&s[i+5]!==index)continue;
      path ||= new Path2D();path.moveTo(s[i],s[i+1]);path.lineTo(s[i+2],s[i+3]);
    }
    tile.selectionPath=path;
  }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const pos=(minY+y)*mapWidth+minX+x;
    if(ownerIndex[idPixels[pos]] !== index) continue;
    const p=(y*w+x)*4;
    patch.data[p]=255;patch.data[p+1]=255;patch.data[p+2]=255;patch.data[p+3]=35;
  }
  sc.putImageData(patch,0,0);requestDraw();
}
function requestDraw() { if(drawPending) return;drawPending=true;requestAnimationFrame(() => {drawPending=false;draw();}); }
function draw() {
  if(!ready||!cssWidth||!cssHeight)return;
  const ratio=canvas.width/cssWidth;
  context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,cssWidth,cssHeight);
  context.fillStyle='#f1f2f3';context.fillRect(0,0,cssWidth,cssHeight);
  const frame=currentFrame(),copies=clippedCopies(tx,mapWidth*scale,frame);
  const provinceStyles=new Map();
  // The clipped window contains at most one circumference, even while panning.
  context.save();context.beginPath();context.rect(frame.x,frame.y,frame.width,frame.height);context.clip();
  context.fillStyle='#fafbfc';context.fillRect(frame.x,frame.y,frame.width,frame.height);
  context.save();context.translate(tx,ty);context.scale(scale,scale);context.imageSmoothingEnabled=scale<1;
  for (const copy of copies) {
    const x=copy*mapWidth;
    context.drawImage(hasPoliticalView()?political:geographic,x,0);
    if(hasPoliticalView()&&state.selected&&!(layers.imperial&&imperialView?.available))context.drawImage(selection,x+selectionOffset.x,selectionOffset.y);
    const bounds={x:(frame.x-tx)/scale-x,y:(frame.y-ty)/scale,width:frame.width/scale,height:frame.height/scale};
    context.save();context.translate(x,0);
    if(layers.imperial&&imperialView?.available&&imperialTiles){
      paintImperialFill(context,imperialTiles,bounds,scale,ratio,mapWidth);
      if(state.selected)context.drawImage(selection,selectionOffset.x,selectionOffset.y);
    }
    if(hasPoliticalView())for(const tile of overlayTiles)if(tileVisible(tile,bounds)){
      const background=overlayBackground(tile,atlas.countries,relations,state.mode,{imperial:layers.imperial&&imperialView?.available,selected:state.selected});
      overlayPainter.fill(context,{...tile,background},scale,ratio,mapWidth);
    }
    if(layers.provinces&&hasPoliticalView()){
      context.setLineDash([]);context.lineCap='butt';context.lineJoin='round';
      for(const tile of provinceBorderTiles||[])if(tileVisible(tile,bounds,2)){
        const key=`${tile.owner}:${tile.imperialKinds.join(',')}`;
        let style=provinceStyles.get(key);
        if(!style){
          const backgrounds=tile.imperialKinds.map(imperialKind=>overlayBackground({owner:tile.owner,imperialKind},atlas.countries,relations,state.mode,{imperial:layers.imperial&&imperialView?.available,selected:state.selected}));
          // Both sides are light map fills; use the darker side at a claim edge.
          const background=backgrounds.reduce((a,b)=>relativeLuminance(a)<relativeLuminance(b)?a:b);
          style=provinceBoundaryStyle(background,scale,provinceBorderWeight);provinceStyles.set(key,style);
        }
        context.strokeStyle=style.color;context.lineWidth=style.width/scale;context.stroke(tile.path);
      }
    }
    // Inset relation marks are clipped to their owner and painted first.
    // The complete ordinary border network always remains above them.
    if(state.mode==='subjects'&&subjectBorders)paintSubjectBorders(context,subjectBorders.tiles,bounds,scale,borderWeight);
    for(const tile of borderTiles)if(tileVisible(tile,bounds,2)){
      const style=boundaryStyle(tile.kind,scale,borderWeight,state.mode);
      const path=tile.path;
      context.setLineDash(style.dash.map(length=>length/scale));
      context.lineJoin='round';context.lineCap=style.dash.length?'butt':'round';
      if(style.casing){context.strokeStyle=style.casing;context.lineWidth=style.casingWidth/scale;context.stroke(path);}
      context.strokeStyle=style.color;context.lineWidth=style.width/scale;context.stroke(path);
    }
    context.setLineDash([]);
    if(hasPoliticalView()&&state.selected){context.strokeStyle='#16191df0';context.lineWidth=selectionBoundaryWidth(scale,borderWeight)/scale;
      for(const tile of borderTiles)if(tile.selectionPath&&tileVisible(tile,bounds,2))context.stroke(tile.selectionPath);
    }
    context.restore();
  }
  context.restore();
  if(state.selected&&hasPoliticalView()) drawSelectedLabel();
  context.restore();
  const frameElement=$('world-frame');
  Object.assign(frameElement.style,{left:frame.x+'px',top:frame.y+'px',width:frame.width+'px',height:frame.height+'px'});
  frameElement.hidden=frame.width>=cssWidth&&frame.height>=cssHeight;
  canvas.dataset.renderScale=(canvas.width/cssWidth).toFixed(2);
  canvas.dataset.worldPeriod=(mapWidth*scale).toFixed(4);
  canvas.dataset.borderWeight=String(borderWeight);
  canvas.dataset.qualificationStripes=String(layers.qualification);
  canvas.dataset.provinceBorders=String(!!layers.provinces);
  canvas.dataset.provinceBorderWeight=String(provinceBorderWeight);
  canvas.dataset.imperialLayer=String(!!layers.imperial);
  $('zoom-label').textContent=`${Math.round(scale/fitScale*100)}%`;
  $('zoom-in').disabled=scale>=MAX_SCALE-1e-9;$('zoom-out').disabled=scale<=fitScale*MIN_ZOOM+1e-9;
}
function currentFrame(){return worldFrame(cssWidth,cssHeight,mapWidth,mapHeight,scale);}
function drawSelectedLabel() {
  const c=atlas.countries[state.selected];
  if(!c)return;
  for(const copy of clippedCopies(tx,mapWidth*scale,currentFrame())) drawLabel(c,copy);
}
function drawLabel(c,copy) {
  const x=(c.center[0]+copy*mapWidth)*scale+tx,y=c.center[1]*scale+ty;
  const frame=currentFrame();
  if(!frameContains(x,y,frame)||y<frame.y+35||y>frame.y+frame.height-12)return;
  const title=countryName(c);context.font='500 13px "Segoe UI","Microsoft YaHei",sans-serif';
  const textWidth=context.measureText(title).width;const boxX=Math.max(8,Math.min(cssWidth-textWidth-28,x-textWidth/2-10));
  context.fillStyle='#ffffffed';context.strokeStyle='#b9b9b9';context.lineWidth=1;
  context.beginPath();context.roundRect(boxX,y-35,textWidth+20,27,5);context.fill();context.stroke();
  context.fillStyle='#333';context.textAlign='left';context.textBaseline='middle';context.fillText(title,boxX+10,y-21);
}
function resize() {
  // Keep the old viewport and camera together while a year is loading. Apply
  // the latest stage size once its map is ready, even when geometry is reused.
  if(!ready){resizePending=true;return;}
  resizePending=false;
  const rect=$('map-stage').getBoundingClientRect(),oldWidth=cssWidth,oldHeight=cssHeight;
  const oldFit=fitScale,oldScale=scale;
  const centerX=(oldWidth/2-tx)/oldScale,centerY=(oldHeight/2-ty)/oldScale;
  cssWidth=rect.width;cssHeight=rect.height;
  const surface=renderSurfaceSize(cssWidth,cssHeight,renderQuality,MAX_SURFACE_PIXELS);
  canvas.width=surface.width;canvas.height=surface.height;
  canvas.dataset.renderQuality=String(surface.requestedQuality);canvas.dataset.qualityLimited=String(surface.limited);
  $('render-quality-note').textContent=surface.limited
    ? `当前约 ${surface.ratio.toFixed(2)}×（已达画布精度上限）。提高线条与纹理清晰度，省份轮廓不变。`
    : `当前 ${surface.requestedQuality}× · 提高线条与纹理清晰度，省份轮廓不变。`;
  fitScale=adaptiveFitScale(cssWidth,cssHeight,mapWidth,mapHeight);
  if(oldWidth&&oldHeight) {
    scale=Math.abs(oldScale/oldFit-1)<1e-4?fitScale:Math.max(oldScale,fitScale*MIN_ZOOM);
    tx=cssWidth/2-centerX*scale;ty=cssHeight/2-centerY*scale;constrain();
  } else fit();
  resetGestureOrigin();hideTooltip();requestDraw();
}
function fit() {if(!ready)return;scale=fitScale;tx=(cssWidth-mapWidth*scale)/2;ty=(cssHeight-mapHeight*scale)/2;resetGestureOrigin();hideTooltip();requestDraw();}
function constrain() {
  ({tx,ty}=constrainCamera(tx,ty,scale,mapWidth,mapHeight,cssWidth,cssHeight));
}
function zoom(factor,x=cssWidth/2,y=cssHeight/2) {
  if(!ready)return;
  const next=Math.min(MAX_SCALE,Math.max(fitScale*MIN_ZOOM,scale*factor));
  tx=x-(x-tx)*next/scale;ty=y-(y-ty)*next/scale;scale=next;constrain();resetGestureOrigin();hideTooltip();requestDraw();
}
function resetGestureOrigin() {
  if(pointers.size===1) {drag={...[...pointers.values()][0],tx,ty};pointerMoved=true;}
  else if(pointers.size===2) {const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale,x:(a.x+b.x)/2,y:(a.y+b.y)/2,tx,ty};pointerMoved=true;}
}
function focusCountry(tag) {
  const country=atlas.countries[tag];if(!country)return;
  const [,y0,,y1]=country.bounds;
  const [x0,x1]=circularBounds(country.provinceIds.map(id=>atlas.provinces[id].bounds),mapWidth);
  scale=Math.min(9,Math.max(fitScale,Math.min((cssWidth-140)/(x1-x0),(cssHeight-125)/(y1-y0+1))));
  tx=cssWidth/2-(x0+x1)*.5*scale;ty=cssHeight/2-(y0+y1)*.5*scale;constrain();resetGestureOrigin();hideTooltip();requestDraw();
}
function buildOverlayLayers() {
  if(!ready||!atlas||!idPixels||!ownerIndex)return;
  visibleAnnualChanges=annualChanges.filter(c=>shouldHighlightChange(c,state.year,state.evidence));
  const changesById=annualChangeEvidence(visibleAnnualChanges,atlas.provinces,state.year);
  const classById=new Uint16Array(ownerIndex.length),groups=[null],groupIndex=new Map();
  for(const province of Object.values(atlas.provinces))if(ownerIndex[province.id]||province.ownerStatus==='explicit_none'){
    const kind=classifyOverlay(province,state.year,layers,changesById.get(province.id)?.kind);if(!kind)continue;
    const imperialKind=layers.imperial&&imperialView?.available?(imperialView.classes[province.id]||0):0;
    const key=`${kind}:${province.owner}:${imperialKind}`;
    if(!groupIndex.has(key)){groupIndex.set(key,groups.length);groups.push({kind,owner:province.owner,imperialKind});}
    classById[province.id]=groupIndex.get(key);
  }
  overlayTiles=classById.some(Boolean)?buildMaskTiles(idPixels,classById,mapWidth,mapHeight,{maxClass:groups.length-1}).tiles.map(tile=>{
    const path=new Path2D(),r=tile.rects;
    for(let i=0;i<r.length;i+=4)path.rect(r[i],r[i+1],r[i+2],r[i+3]);
    return {...tile,...groups[tile.kind],path};
  }):[];
  canvas.dataset.overlayKinds=[...new Set(overlayTiles.map(tile=>tile.kind))].sort().join(',');
  requestDraw();
}
function pickChange(x,y) {
  if(!ready)return null;
  const province=pick(x,y);
  if(!layers.changes)return null;
  const record=annualChangeEvidence(visibleAnnualChanges,atlas.provinces,state.year).get(province?.id);
  return record?chronology.steps.find(step=>step.id===record.recordId)||null:null;
}
function selectChange(id,{focus=false}={}) {
  if(!ready){const request=viewRequest;pendingView.then(()=>{if(ready&&request===viewRequest)selectChange(id,{focus});});return true;}
  const change=activeChanges.find(c=>c.id===id)||chronology.steps.find(c=>c.id===id&&c.year===state.year);if(!change)return false;
  state.selected=null;state.selectedChange=id;buildSelection();renderCountry();switchTab('country');
  document.querySelector('.sidebar-scroll').scrollTop=0;
  if(focus)focusChanges(id);else requestDraw();
  $('announcement').textContent=change.title?publicRecord(change).ariaLabel:`${change.nameZh}。${changeLabel(change,history,state.year)}。`;
  return true;
}
function focusChanges(id) {
  if(!ready){const request=viewRequest;pendingView.then(()=>{if(ready&&request===viewRequest)focusChanges(id);});return;}
  const step=chronology.steps.find(c=>c.id===id);
  const changes=id?activeChanges.filter(c=>c.id===id):activeChanges;
  const provinces=step?stepLocationProvinceIds(step,stepChanges(step,state.evidence)).map(id=>atlas.provinces[id]).filter(Boolean):changes.map(c=>currentGeometry==='eu4'?atlas.provinces[c.anchorProvinceId]:Object.values(atlas.provinces).find(p=>p.sourceRGB?.toLowerCase()===`x${c.vic3ProvinceRGB}`)).filter(Boolean);
  if(!provinces.length)return;
  const [x0,x1]=circularBounds(provinces.map(p=>p.bounds),mapWidth),y0=Math.min(...provinces.map(p=>p.bounds[1])),y1=Math.max(...provinces.map(p=>p.bounds[3]));
  scale=Math.min(id?4:2.5,Math.max(fitScale,Math.min((cssWidth-100)/(x1-x0+80),(cssHeight-110)/(y1-y0+80))));
  tx=cssWidth/2-(x0+x1)*.5*scale;ty=cssHeight/2-(y0+y1)*.5*scale;constrain();resetGestureOrigin();hideTooltip();requestDraw();
}
function focusEvent(id) {
  if(!ready){const request=viewRequest;pendingView.then(()=>{if(ready&&request===viewRequest)focusEvent(id);});return;}
  const event=eventsAtYear(events,state.year).find(event=>event.id===id);if(!event)return;
  const provinces=(event.locationAnchors || []).map(anchor=>currentGeometry==='eu4'?atlas.provinces[anchor.eu4ProvinceId]:Object.values(atlas.provinces).find(p=>p.sourceRGB?.toLowerCase()===anchor.vic3RGB?.toLowerCase())).filter(p=>p?.bounds);
  if(!provinces.length)return;
  const [x0,x1]=circularBounds(provinces.map(p=>p.bounds),mapWidth),y0=Math.min(...provinces.map(p=>p.bounds[1])),y1=Math.max(...provinces.map(p=>p.bounds[3]));
  scale=Math.min(4,Math.max(fitScale,Math.min((cssWidth-100)/(x1-x0+100),(cssHeight-110)/(y1-y0+100))));
  tx=cssWidth/2-(x0+x1)*.5*scale;ty=cssHeight/2-(y0+y1)*.5*scale;constrain();resetGestureOrigin();hideTooltip();requestDraw();
  $('announcement').textContent=`${publicRecord(event,'events').ariaLabel}。仅定位相关地点，不表示已确认割让范围。`;
}
function point(event) {const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
function pick(x,y) {
  if(!ready||!frameContains(x,y,currentFrame()))return null;
  const p=mapPoint(x,y,tx,ty,scale,mapWidth,mapHeight);
  return p ? atlas.provinces[idPixels[p.y*mapWidth+p.x]]||null : null;
}
function hover(p) {
  lastPointer=p;const province=pick(p.x,p.y);
  state.hovered=province?.id||null;
  const change=pickChange(p.x,p.y);
  const imperialLabel=layers.imperial&&imperialView?.available?imperialZoneLabel(imperialView.classes[province?.id],imperialView.regime.type==='republic'):'';
  const imperialMarkup=imperialLabel?`<small>${escape(imperialLabel)}</small>`:'';
  if(change){showTooltip(`<strong>${escape(displayRecordTitle(change))}</strong><small>${escape(publicRecord(change).dateLabel)} · ${escape(publicRecord(change).certaintyLabel)}</small>${imperialMarkup}`,p);return;}
  if(province?.endpointReview?.displayPolicy==='withhold-conflicted-projection'&&!province.endpointReview.comparisonActive){
    showTooltip(`<strong>${escape(province.nameZh||province.name)}</strong><small>位置或来源冲突待核</small>${endpointReviewMarkup(province)}${imperialMarkup}`,p,false);$('hover-location').textContent=`${province.nameZh||province.name} · 位置或来源冲突待核`;return;
  }
  if(!hasPoliticalView()||!visibleProvince(province)) {
    const note=provinceCoverageNote(province,atlas);
    if(province){const label=surfaceLabel(kinds[province.id]);showTooltip(`<strong>${escape(province.nameZh||province.name)}</strong><small>${escape(label)}</small>${note?`<small>${escape(qualificationDisplayText(note))}</small>`:''}${endpointReviewMarkup(province)}${imperialMarkup}`,p,false);$('hover-location').textContent=label;return;}
    hideTooltip();return;
  }
  const country=atlas.countries[province.owner];if(!country){hideTooltip();return;}
  const name=province.nameZh||province.name;
  showTooltip(`<strong>${escape(countryName(country))}</strong><small>${escape(country.name)} · ${escape(name)}</small>${province.politicalQualification?`<small class="political-qualification-note">${escape(qualificationDisplayText(publicView.notice('haless-quality-endpoint-label:/'+province.politicalQualification.id,province.politicalQualification.visibleText).description))}</small>`:''}${province.basis?`<small>最近归属依据 ${province.basis.year} · ${province.basis.certainty==='anchored'?'锚点约束的连续段':province.basis.certainty==='hypothesis'?'推测方案':province.basis.certainty==='continued'?'开局边界延续':province.basis.year<state.year?'史料节点延续':'史料节点投影'}</small>`:''}${province.cartographicFill?`<small>跨图投票 · ${escape(province.cartographicFill.confidenceBand)} · 得票 ${(province.cartographicFill.weightedWinnerShare*100).toFixed(1)}% · ${province.cartographicFill.shoreDistanceP95} 源像素</small>`:''}${province.originalSourceConflict?'<small>原始归属冲突仍未解决</small>':''}${administrationMarkup(province.owner,'compact')}${endpointReviewMarkup(province)}${imperialMarkup}`,p);
  $('hover-location').textContent=`${name} · ${countryName(country)}`;
}
function showTooltip(markup,p,interactive=true) {
  $('map-tooltip').innerHTML=markup;
  $('map-tooltip').hidden=false;
  const tooltipWidth=$('map-tooltip').offsetWidth,tooltipHeight=$('map-tooltip').offsetHeight;
  $('map-tooltip').style.left=`${Math.max(8,Math.min(cssWidth-tooltipWidth-8,p.x+17))}px`;
  $('map-tooltip').style.top=`${Math.max(8,Math.min(cssHeight-tooltipHeight-8,p.y+17))}px`;
  canvas.style.cursor=interactive?'pointer':'';
}
function hideTooltip() {$('map-tooltip').hidden=true;canvas.style.cursor='';$('hover-location').textContent='左右循环拖动 · 滚轮缩放 · 点击国家';}
function selectCountry(tag,{focus=false}={}) {
  if(!atlas.countries[tag]&&state.year===LAST_YEAR){
    const matches=Object.values(atlas.countries).filter(country=>country.eu4Tag===tag||country.historyTag===tag);
    if(matches.length===1)tag=matches[0].tag;
  }
  if(!hasPoliticalView()||!atlas.countries[tag]){
    const missing=atlas.projectionSummary?.unmappedCountries.find(country=>country.tag===tag);
    if(missing){
      state.selected=null;state.selectedChange=null;buildSelection();renderCountry();switchTab('country');closeSearch();
      const name=missing.nameZh||missing.name||tag;
      $('country-panel').insertAdjacentHTML('afterbegin',`<article class="country-unavailable" role="status"><p class="eyebrow">1820 · ${escape(tag)}</p><h2>${escape(name)}</h2><p>当前没有可定位的 EU4 版图。</p><p>${escape(missing.reason)}</p><a href="./research.html#country=${encodeURIComponent(tag)}">查看该国资料与待核原因 →</a></article>`);
      document.querySelector('.sidebar-scroll').scrollTop=0;
      $('announcement').textContent=`${name}：当前没有可定位的 EU4 版图。${missing.reason}`;
    }
    return false;
  }
  state.selected=tag;state.selectedChange=null;buildSelection();renderCountry();switchTab('country');closeSearch();
  document.querySelector('.sidebar-scroll').scrollTop=0;
  $('country-search').value='';if(focus)focusCountry(tag);
  $('announcement').textContent=`已选择 ${countryName(atlas.countries[tag])}，${atlas.countries[tag].provinceIds.length} 个省份。`;
  return true;
}
function renderCountry() {
  renderLegend();
  const panel=$('country-panel');
  if(state.selectedChange) {panel.innerHTML=renderHistoryDetail();return;}
  if(!hasPoliticalView()) {panel.innerHTML=`<div class="country-unavailable"><p class="eyebrow">${state.year} 年</p><h2>${state.year===LAST_YEAR?'当前模式隐藏跨图推定版图':'这一年的归属尚未收录'}</h2><p>当前资料模式未显示这一年的政治版图。可切换资料模式查看重建，并在“国家沿革”阅读各国记录。</p><button class="text-button" data-baseline>返回 1444 年开局 →</button></div>`;return;}
  if(!state.selected) {
    const tags=state.year===1820?['v3:A03','v3:A04','v3:A06','v3:A01','v3:A02','v3:A14']:['A01','A13','A06','A02','A80','A30'];
    panel.innerHTML=`<div class="empty-detail"><p class="eyebrow">${escape(atlas.coverage.title)}</p><h1>${state.year}<span>年</span></h1><p>${escape(qualificationDisplayText(atlas.coverage.description))}</p><div class="atlas-stats"><div class="stat"><strong>${atlas.stats.countries}</strong><small>收录政治主体</small></div><div class="stat"><strong>${atlas.stats.politicalProvinces.toLocaleString()}</strong><small>有主省份</small></div></div>${state.year!==FIRST_YEAR?'<button class="history-focus" data-focus-coverage>定位已收录地区</button>':''}<div class="section-rule"></div><h2>主要国家</h2><div class="featured-countries">${tags.filter(tag=>atlas.countries[tag]).map(tag=>countryRow(atlas.countries[tag])).join('')}</div><p class="subtle-note">${atlas.coverage.withdrawals?.length?escape(atlas.coverage.withdrawals.join(' ')):''}${state.year===1820?'领土数量按 EU4 省份统计；跨底图边界需逐国审校。国旗的同国对应、革命变体与待核状态在各国详情中注明。':state.year===FIRST_YEAR?'开局归属取自 1444 年 11 月 11 日省份历史。':'节点之间沿用最近状态；推测方案使用明示的观察年份。国家沿革中可逐项查看，或切换资料模式比较。'}</p>${endpointSummaryMarkup()}</div>`;return;
  }
  const country=atlas.countries[state.selected],relation=relations[state.selected]||atlas.offmapRelations?.[state.selected];
  const relationCountryName=other=>{const name=countryName(other);return other.tag!==country.tag&&name===countryName(country)?`${name}（${other.name||other.tag}）`:name;};
  const subjects=Object.values(relations).filter(r=>r.overlord===state.selected).sort((a,b)=>countryName(atlas.countries[a.subject]).localeCompare(countryName(atlas.countries[b.subject]),'zh-CN'));
  const capital=atlas.provinces[country.capital];
  const capitalName=capital?.owner===country.tag&&!capital.excluded?(capital.nameZh||capital.name):'待核对';
  const capitalIsReference=state.year<1820&&Boolean(country.scenarioPoliticalLayer);
  const color=country.color.map(v=>v.toString(16).padStart(2,'0')).join('');
  const otherName=country.nameZh?country.name:'中文名称待补充';
  const unresolvedRelation=country.provinceIds.flatMap(id=>atlas.provinces[id].basis?.relationshipEvidence||[]).find(r=>r.subject===country.tag&&r.status==='unknown');
  const relationMarkup=relation?`<dt>宗主国</dt><dd>${atlas.countries[relation.overlord]?`<button class="inline-country" data-country="${relation.overlord}">${escape(relationCountryName(atlas.countries[relation.overlord]))}</button>`:`${escape(relationCountryName(atlas.offmapActors?.[relation.overlord]||{name:relation.overlord}))}<br><small>宗主领土位于当前研究范围之外；保留关系记录，不据此判定独立。</small>`}</dd><dt>附属类型</dt><dd>${escape(relationType(relation))}${relationType(relation)!==relation.typeLabel?`<br><small>${escape(publicView.notice('relation-type-label:/'+String(relation.typeLabel).replaceAll('~','~0').replaceAll('/','~1'),relation.typeLabel).description)}</small>`:''}</dd>`:unresolvedRelation?`<dt>附属关系</dt><dd>后继关系待考<br><small>${escape(unresolvedRelation.relationshipWithdrawal.reason)}</small></dd>`:`<dt>附属关系</dt><dd>${country.localPoliticalGroup?'未设统一附属关系':'未列为附属国'}</dd>`;
  panel.innerHTML=`<article class="country-detail"><p class="eyebrow">${state.year===1444?'1444.11.11':state.year===1820?'1820.1.1':state.year} · ${country.localPoliticalGroup?'地方势力档案':'国家档案'}</p><div class="country-heading">${flagMarkup(country)}<button data-clear-country aria-label="取消国家选择">×</button></div><h1>${escape(countryName(country))}</h1><p class="country-english">${escape(otherName)}</p><span class="tag-badge"><i class="color-dot" style="background:#${color}"></i>${escape(country.tag)}${country.eu4Tag?` · EU4 ${escape(country.eu4Tag)}`:''}</span><dl class="detail-table"><dt>${country.capitalLabel?escape(country.capitalLabel):capitalIsReference?'后期资料定位':state.year===1820?'首都定位':'首都'}</dt><dd>${country.localPoliticalGroup?'未设统一首都':escape(capitalName)}${capitalIsReference?'<br><small>用于定位，不证明本阶段已有统一首都或同一政治组织。</small>':''}${country.capitalBasis?`<br><small>${escape(country.capitalBasis)}${!country.capital&&country.capitalStateName?` · ${escape(country.capitalStateName)}`:''}</small>`:''}</dd><dt>收录领土</dt><dd>${country.provinceIds.length} 个省份${state.year===1820?'（EU4 省形）':''}</dd>${relationMarkup}${administrationMarkup(state.selected,'detail')}<dt>地图依据</dt><dd>${escape(atlas.coverage.title)}</dd>${country.recordYears?.length?`<dt>归属节点</dt><dd>${country.recordYears.join('、')}<br><small>${state.year===1820?'开局观察时点，不代表本年发生全部边界变化':'各省最近依据；其后为推定延续'}</small></dd>`:''}</dl>${country.provinceIds.some(id=>atlas.provinces[id].politicalQualification)?`<section class="event-geography"><h2>图示范围与限度</h2>${[...new Set(country.provinceIds.map(id=>{const q=atlas.provinces[id].politicalQualification;return q?qualificationDisplayText(publicView.notice('haless-quality-endpoint-label:/'+q.id,q.visibleText).description):null;}).filter(Boolean))].map(text=>`<p>${escape(text)}</p>`).join('')}</section>`:''}${subjects.length?`<div class="section-rule"></div><h2>附属国家 <small>(${subjects.length})</small></h2>${subjects.map(r=>`<div class="relation-item"><button class="inline-country" data-country="${r.subject}">${escape(relationCountryName(atlas.countries[r.subject]))}</button><small>${escape(relationType(r))}</small>${administrationMarkup(r.subject,'compact')}</div>`).join('')}`:''}<div class="detail-actions"><button data-focus-country="${country.tag}">${country.localPoliticalGroup?'定位这组地方势力':'定位这个国家'}</button></div><p class="source-line">${state.year===1820?'Vic3 开局归属 · EU4 原始底图':state.year===1444?'EU4 Anbennar · 国家与省份历史':'已记载节点 + 最近状态延续'}</p>${state.year!==1444?`<p class="subtle-note">${escape(qualificationDisplayText(atlas.coverage.description))}${country.localPoliticalGroup?' 地方势力集合不设置统一旗帜。':country.flagNote?'':country.flag?' 显示旗帜用作模组中的国家标识；历史旗式与采用年代未定。':' 尚未采用可核验的对应旗帜，旗帜来源仍待核。'}</p>`:''}${relation&&!relation.visibility?`<p class="subtle-note">宗主模式与宗主同色，特殊附属通过并排边框区分。关系来自所示阶段的资料；未模拟游戏动态外交。</p>`:''}</article>`;
  if(state.year===1820||state.year===1819)panel.querySelector('article').insertAdjacentHTML('beforeend',`<p class="event-geography"><a href="./endpoint-observations.html?country=${encodeURIComponent(country.tag)}">查看阳洲原批逐省对照与关联事件 →</a></p>`);
  if([1819,1820].includes(state.year))panel.querySelector('article').insertAdjacentHTML('beforeend',countryEndpointReviewMarkup(country));
  if(country.historicalStatus)panel.querySelector('article').insertAdjacentHTML('beforeend',`<p class="event-geography">${escape(country.historicalStatus)}</p>`);
  if(country.coverageNote)panel.querySelector('article').insertAdjacentHTML('beforeend',`<p class="event-geography">${escape(country.coverageNote)}</p>`);
  if(country.flagNote)panel.querySelector('article').insertAdjacentHTML('beforeend',`<p class="subtle-note">${escape(country.flagNote)}</p>`);
  const records=countryRecords(chronology,countryHistoryTag(country),state.year);
  const dossier=findDossier(dossiers,countryHistoryTag(country));
  const registryId=country.tag.includes(':')?country.tag:`eu4:${country.tag}`;
  panel.querySelector('article').insertAdjacentHTML('beforeend',`<p class="register-country-link"><a href="./research.html#country=${encodeURIComponent(registryId)}">查看研究进度与待核问题 →</a></p>`);
  if(country.basisCounts)panel.querySelector('article').insertAdjacentHTML('beforeend',`<p class="event-geography">当前 ${country.provinceIds.length} 省：开局延续 ${country.basisCounts.continued||0} · 史料节点重建 ${country.basisCounts.reconstructed||0} · 锚点约束 ${country.basisCounts.anchored||0} · 推测方案 ${country.basisCounts.hypothesis||0}。<br>锚点约束沿未转属的连续段支持归属，保留原推演与来源；取得年份和省界并非逐年确证。</p>`);
  const tracedProvinces=country.provinceIds.filter(id=>chronology.coverageProvinceIds.includes(id));
  if(tracedProvinces.length)panel.querySelector('article').insertAdjacentHTML('beforeend',`<details class="event-geography"><summary>逐省追溯领土变化与推理（${tracedProvinces.length}）</summary><p>每省可查看 1444—1820 连续归属、附属关系和来源；推测另有推理及备选解释。</p>${tracedProvinces.map(id=>`<p><a href="./continuity.html?province=${id}">${escape(atlas.provinces[id].nameZh||atlas.provinces[id].name)} · ${id} →</a>${atlas.provinces[id].endpointInference?(atlas.provinces[id].endpointInference.reviewType==='boundary-correspondence-correction'?' · 端点对应修正（推测）':' · 端点缺口推测'):''}</p>`).join('')}</details>`);
  if(dossier)panel.querySelector('article').insertAdjacentHTML('beforeend',`<div class="detail-actions"><button data-dossier="${escape(dossier.tag)}">按年份查看国家沿革 →</button></div>`);
  if(state.year===1820){const fills=country.provinceIds.map(id=>atlas.provinces[id]).filter(p=>p?.endpointInference?.kind==='cartographic-vote-fill');if(fills.length)panel.querySelector('article').insertAdjacentHTML('beforeend',`<details class="event-geography"><summary>跨图补色依据（${fills.length}省）</summary>${fills.map(p=>`<p><a href="./correspondence.html?province=${p.id}">${p.id} · ${escape(p.nameZh||p.name)}</a>：${escape(p.endpointInference.reasoning)}</p>`).join('')}</details>`);}
  if(records.length)panel.querySelector('article').insertAdjacentHTML('beforeend',`<div class="section-rule"></div><h2>已收录的变化</h2><div class="country-records">${records.map(record=>`<button data-record="${record.id}"><time>${escape(publicRecord(record).dateLabel)}</time><span>${escape(displayRecordTitle(record))}<small>${escape(publicRecord(record).certaintyLabel)}</small></span></button>`).join('')}</div>`);
}
function endpointSummaryMarkup(){
  const summary=atlas.projectionSummary;if(!summary)return '';
  return `${atlas.endpointReviewSummary?`<p class="event-geography">已审${atlas.endpointReviewSummary.reviewedEntries}处政治状态对照；${atlas.endpointReviewSummary.conflictedEntries}处位置或来源冲突单列待核。<a href="./endpoint-review.html">查看具体省份与理由 →</a></p>`:''}<p class="event-geography">1820 映射登记 ${summary.sourceCountries} 个来源国家；当前模式可显示 ${summary.mappedCountries} 个。映射生成不计作历史考据完成。</p>${summary.unmappedCountries.length?`<details><summary>${summary.unmappedCountries.length} 个未显示国家与待核原因</summary><ul>${summary.unmappedCountries.map(c=>`<li><a href="./research.html#country=${encodeURIComponent(c.tag)}">${escape(countryName(c))}</a>：${escape(c.reason)}</li>`).join('')}</ul></details>`:''}`;
}
function countryRow(country) {return `<button class="country-row" data-country="${country.tag}" data-focus="true">${flagMarkup(country)}<span class="country-row-title">${escape(countryName(country))}<small>${escape(country.name)}</small></span><span class="row-arrow" aria-hidden="true">›</span></button>`;}
function actorName(id) {const actor=history.actors[id];return actor?`${actor.nameZh} / ${actor.name}`:'待核对';}
function renderHistoryDetail() {
  const step=chronology.steps.find(c=>c.id===state.selectedChange);
  if(step){const date=step.dateEvidence;const dateLabel=date?.exactYear!=null?`${date.exactYear} 年`:date?.earliest&&date?.latest?`${date.earliest}—${date.latest} 年之间`:'具体年份待考';return `<article class="country-detail"><p class="eyebrow">${step.year} 年 · 历史节点</p><h1>${escape(displayRecordTitle(step))}</h1><span class="evidence-badge ${step.evidenceKind==='hypothesis'?'hypothesis':''}">${recordKindLabel(step.evidenceKind)}</span><p class="history-intro">${escape(publicRecord(step,'steps').description)}</p>${publicCertaintyMarkup(publicRecord(step,'steps'))}<dl class="detail-table"><dt>${step.evidenceKind==='hypothesis'?'推测选年窗口':'资料日期'}</dt><dd>${escape(publicRecord(step,'steps').dateLabel)}</dd><dt>地图节点</dt><dd>${step.year} 年${step.evidenceKind==='hypothesis'?'（网站选年）':date?.exactYear==null?'（观察时点）':''}</dd><dt>范围依据</dt><dd>EU4 官方省形投影 · 推定</dd></dl>${originalRecordDetails(step,publicRecord(step,'steps'))}<p class="subtle-note">${step.importance==='major'?'斜线仅在节点当年覆盖新增或改变归属的地块；推测变化用双斜线，次年恢复推测归属格点。':'这一节点不使用重大版图变化遮罩。'}</p><p class="subtle-note">仅定位相关地点，不代表已确认割地；不会改变当前资料模式或推测显示。</p><div class="detail-actions"><button data-focus-change="${step.id}">定位涉及地点</button></div><div class="history-sources">${recordLinks({sourceIds:step.sourceIds||[step.sourceId]})}</div></article>`;}
  const change=activeChanges.find(c=>c.id===state.selectedChange);
  if(!change) return `<div class="country-detail history-overview"><p class="eyebrow">${state.year} 年 · 坎诺历史地点</p><h1>黑火药战争前后</h1><p class="history-intro">已收录 ${activeChanges.length} 处归属变化。可从下方记录定位。仅在重大变化的范围核定后显示斜线，完整疆域仍待补充。</p><button class="history-focus" data-focus-changes>定位这组历史地点</button><div class="section-rule"></div>${activeChanges.map((c,i)=>`<button class="history-place" data-change="${c.id}" data-focus="true"><span>${escape(c.nameZh)}<small>${escape(c.name)}</small></span><span aria-hidden="true">›</span></button>`).join('')}<p class="subtle-note">${escape(history.timeNote)}</p></div>`;
  const endpoint=changePhase(change,state.year)==='endpoint',relation=history.relations[change.directActor];
  return `<article class="country-detail history-detail"><p class="eyebrow">${state.year} 年 · 地点档案</p><div class="history-heading"><h1>${escape(publicRecord(change,'history').title)}</h1><button data-clear-change aria-label="取消地点选择">×</button></div><p class="country-english">${escape(change.name)}</p><span class="evidence-badge ${change.conflict?'conflict':''}">${endpoint?change.conflict?'文件冲突待核':'开局关系已核':'变更年份待考'}</span><p class="history-intro">${escape(publicRecord(change,'history').description)}</p>${publicCertaintyMarkup(publicRecord(change,'history'))}${originalRecordDetails(change,publicRecord(change,'history'))}<dl class="detail-table"><dt>发生时间</dt><dd>1810—1820 之间<br><small>截至 1820 的结果；非具体年份</small></dd><dt>此前势力</dt><dd>${escape(actorName(change.fromActor))}</dd><dt>政治去向</dt><dd>${escape(actorName(change.sphereActor))}</dd><dt>1820 政权</dt><dd>${escape(actorName(change.directActor))}</dd>${relation?`<dt>1820 附属</dt><dd>${escape(publicView.notice('relation-type-label:/'+String(relation.typeLabel).replaceAll('~','~0').replaceAll('/','~1'),relation.typeLabel).description)}<br>${escape(actorName(relation.overlord))}</dd>`:''}</dl><p class="event-geography">${escape(change.endpointNote)}</p><p class="event-geography">${escape(history.geometryNote)}</p><div class="detail-actions"><button data-focus-change="${change.id}">定位这个地点</button></div>${!endpoint?`<button class="text-button" data-change-endpoint="${change.id}">查看 1820 开局结果 →</button>`:''}<div class="history-sources">${change.sourceIds.map(id=>`<a href="${escape(history.sources[id].url)}" target="_blank" rel="noreferrer">${escape(history.sources[id].title)} ↗</a>`).join('')}</div><p class="subtle-note">国家模式采用源国色的浅色版本；宗主模式的全部附属与宗主同色。1820 采用已核对的同国 EU4 标识或 Vic3 纹章；逐国标注来源，不将显示用标识当作历史旗帜定论。</p></article>`;
}
function setYear(year) {
  if(!validYear(year)||!baseAtlas||!chronology)return false;
  cancelGestures();state.year=Number(year);state.selected=null;state.selectedChange=null;
  activeChanges=changesAtYear(history,state.year);annualChanges=territorialChangesAtYear(chronology,state.year,state.evidence);
  $('year-input').value=state.year;$('year-slider').value=state.year;
  $('fullscreen-year').textContent=`${state.year} 年`;
  closeSearch();hideTooltip();renderEvents();
  requestYearView();
  if(eventsAtYear(events,state.year).length&&state.year!==FIRST_YEAR&&state.tab!=='chronicle')switchTab('events');
  return true;
}
function refreshYearUI() {
  $('fullscreen-year').textContent=`${state.year} 年`;
  const known=hasPoliticalView(),baseline=state.year===FIRST_YEAR,matches=eventsAtYear(events,state.year);
  const era=eraAtYear(eras,state.year),reconstructed=atlas.coverage.type==='reconstructed';
  $('map-date-label').textContent=baseline?'1444.11.11':state.year===LAST_YEAR?'1820.1.1':`${state.year} 年`;
  $('map-status').textContent=atlas.coverage.title;
  $('map-notice').hidden=known;
  $('notice-title').textContent=`${state.year} 年 · ${state.evidence==='confirmed'?'仅开局确证':'版图尚未收录'}`;
  $('notice-text').textContent=state.evidence==='confirmed'&&state.year>1444?'此年版图含阶段推定或跨图映射；可切换“仅史料节点重建”或“含推测延拓”查看。历史记录仍可在右侧阅读。':'此年尚无完整政治版图，历史记录仍可在右侧阅读。';
  $('year-summary').textContent=`${bookmarks.find(b=>b.year===state.year)?.label||'逐年浏览'} · ${matches.length} 条资料记录${state.year===1820?' · 终点观察':''}`;
  refreshBookmarks();
  $('coverage-label').textContent=baseline?'1444 开局已收录':state.year===LAST_YEAR?'EU4 省形映射 · 边界待审校':reconstructed?`${chronology.coverageTitle||'西坎诺'} · ${state.evidence==='attested'?'史料节点':'含推测延拓'}`: '此年暂无确证版图';
  $('previous-year').disabled=state.year===FIRST_YEAR;$('next-year').disabled=state.year===LAST_YEAR;
  $('previous-event').disabled=!eventYears(events).some(year=>year<state.year);$('next-event').disabled=!eventYears(events).some(year=>year>state.year);
  $('country-search').disabled=!known;$('country-search').placeholder=known?'查找国家 · 中文 / English':'可从事件列表查看记录';
  $('country-search').value='';
  $('original-mode').disabled=!known;$('subject-mode').disabled=!known;
  $('evidence-mode').title='推测延拓含历史推测与较弱地理映射；仅史料节点隐藏这些方案。仅开局确证不显示 1820 跨图推定边界。';
  $('map-source-label').textContent=state.year===LAST_YEAR?'底图 · EU4 / 归属 · Vic3 映射':'底图 · EU4 Anbennar';
  $('era-label').textContent=era?`${era.nameZh} · 参考分期`:'';
  for(const button of document.querySelectorAll('[data-era]'))button.setAttribute('aria-current',String(button.dataset.era===era?.id));
  renderCountry();renderEvents();renderDossier();renderLegend();requestDraw();
  $('announcement').textContent=`${state.year} 年。${atlas.coverage.title}。${matches.length} 条资料记录，完整内容见事件面板。${state.year===1820?'终点观察，不代表本年发生全部变化。':''}`;
}
function renderEvents() {
  const matches=eventsAtYear(events,state.year);
  $('events-year').textContent=`${state.year} 年`;$('event-count').textContent=matches.length+activeChanges.length;
  const endpointIntro=state.year===1820?'<p class="interval-note"><a href="./endpoint-observations.html">阳洲 1819—1820逐省变化与依据 →</a> · 端点观察不代表变化发生于1820年。</p>':'';
  const renderEvent=event=>{const p=publicRecord(event,'events');return `<article class="event-card"><span class="event-type">${escape(p.dateLabel)}</span><h3>${escape(p.title)}</h3><p>${escape(p.description)}</p>${publicCertaintyMarkup(p)}${publicModelNoteMarkup(event)}${originalRecordDetails(event,p)}<div class="history-sources">${recordLinks(event)}</div>${event.detailsUrl?`<div class="event-geography"><a href="${escape(event.detailsUrl)}">逐省前后值与完整说明 →</a></div>`:''}${state.evidence!=='reconstructed'&&(event.kind==='hypothesis'||chronology.steps.some(step=>step.id===event.stepId&&step.evidenceKind==='hypothesis'))?'<p class="dossier-hidden-note">当前资料模式隐藏这项推测版图；记录仍可查阅。</p>':''}${event.stepId?`<button class="text-button" data-change="${event.stepId}" data-focus="true">定位与查看依据 →</button>`:event.locationAnchors?.length?`<button class="text-button" data-locate-event="${event.id}">定位相关地点 →</button>`:''}</article>`;};
  const observations=matches.filter(e=>e.recordRole==='endpoint_observation');
  const dated=matches.filter(e=>e.recordRole!=='endpoint_observation').map(renderEvent).join('')+(observations.length?`<details><summary>端点逐省观察与标识对照 · ${observations.length} 条</summary>${observations.map(renderEvent).join('')}</details>`:'');
  const changes=activeChanges.length?`<div class="interval-note">下列变化发生于 1810—1820 之间，未确认在 ${state.year} 年发生。${state.year===1820?'1820 仅为已知结果的观察时点。':''}<button class="text-button" data-focus-changes>定位这组历史地点 →</button></div>${activeChanges.map((c,i)=>`<article class="event-card"><span class="event-type">${state.year===1820?'1820 开局结果':'1810—1820 · 年份待考'}</span><h3>${i+1}. ${escape(c.nameZh)}的归属变化</h3><p>${escape(publicRecord(c,'history').description)}</p>${publicCertaintyMarkup(publicRecord(c,'history'))}${originalRecordDetails(c,publicRecord(c,'history'))}<button class="text-button" data-change="${c.id}" data-focus="true">定位与查看依据 →</button>${c.conflict?'<div class="event-geography">源文件归属冲突，暂不指定直接所有者。</div>':''}</article>`).join('')}`:'';
  $('event-list').innerHTML=endpointIntro+dated+changes||`<div class="events-empty"><p>尚未收录这一年的重大事件。这不表示当年没有发生变化。</p><button class="text-button" data-next-record>前往邻近记录年份 →</button></div>`;
}
function createEventMarkers() {
  $('bookmark-buttons').innerHTML=renderBookmarks(bookmarks,state.year,escape);
  $('bookmark-select').innerHTML='<option value="">选择精选时点</option>'+bookmarks.map(b=>`<option value="${escape(b.bookmarkId)}">${b.year} · ${escape(b.label)}</option>`).join('');
}
function refreshBookmarks() {
  const current=bookmarks.find(b=>b.year===state.year);
  $('bookmark-select').value=current?.bookmarkId||'';
  $('bookmark-description').textContent=current?.description||'逐年浏览：各项记载、推定阶段和端点观察分别保留日期与范围限定。';
  for(const button of document.querySelectorAll('[data-bookmark]')){
    if(button.dataset.bookmark===current?.bookmarkId)button.setAttribute('aria-current','date');else button.removeAttribute('aria-current');
  }
}
function navigateBookmark(id) {
  const bookmark=bookmarks.find(b=>b.bookmarkId===id);if(!bookmark)return;
  setYear(bookmark.year);switchTab('events');
}

function switchTab(tab) {
  if(state.tab!==tab)document.querySelector('.sidebar-scroll').scrollTop=0;
  state.tab=tab;
  for(const name of ['country','events','chronicle']){$(`${name}-tab`).setAttribute('aria-selected',String(name===tab));$(`${name}-tab`).tabIndex=name===tab?0:-1;$(`${name}-panel`).hidden=name!==tab;}
}

function renderDossier() {
  if(!dossiers)return;
  const country=findDossier(dossiers,state.dossier);
  $('dossier-filters').hidden=Boolean(country);
  if(!country){
    const matches=searchDossiers(dossiers,$('dossier-search').value,$('dossier-group').value);
    $('dossier-content').innerHTML=`<p class="dossier-count">${matches.length} 个档案 · ${matches.filter(c=>c.reviewLevel==='reviewed').length} 个已作专题梳理</p><p class="dossier-intro">先选国家，再沿记录查看它的变化。开局档案仍待考证；暂时延续旧边界不代表历史上没有变化。</p><div class="dossier-list">${matches.map(c=>`<button data-dossier="${escape(c.tag)}">${flagMarkup(c)}<span>${escape(countryName(c))}<small>${escape(c.name)}</small><small>${c.reviewLevel==='reviewed'?'专题梳理':'开局档案 · 待考证'} · ${c.records.length} 条${c.imperialAtStart?' · 开局持有帝国省份':''}</small></span><span aria-hidden="true">›</span></button>`).join('')||'<p>没有匹配的国家。</p>'}</div>`;
    return;
  }
  const previous=country.records.filter(r=>r.year<state.year).at(-1),next=country.records.find(r=>r.year>state.year);
  $('dossier-content').innerHTML=`<article class="dossier-detail"><button class="text-button" data-dossier-back>← 全部国家</button><p class="eyebrow">国家沿革 · ${country.reviewLevel==='reviewed'?'专题梳理':'待逐国考证'}</p><h1>${escape(countryName(country))}</h1><p class="country-english">${escape(country.name)}</p><p class="dossier-flag">${flagMarkup(country)}</p>${country.flagNote?`<p class="subtle-note flag-source-note">${escape(country.flagNote)}</p>`:''}${countryPublicIntro(country)}${dossierAssessments(country)}${dossierCurrentMarkup(country,atlas)}<div class="dossier-navigation"><button data-dossier-record="${escape(previous?.id||'')}" ${previous?'':'disabled'}>← 此国上一节点</button><button data-dossier-record="${escape(next?.id||'')}" ${next?'':'disabled'}>此国下一节点 →</button></div><div class="dossier-records">${country.records.map(record=>`<article class="dossier-record" data-dossier-entry="${escape(record.id)}" ${record.year===state.year?'aria-current="date"':''}><div><time>${escape(publicRecord(record,'records').dateLabel)}</time><span class="evidence-badge ${record.kind==='hypothesis'?'hypothesis':''}">${recordKindLabel(record.kind,record)}</span></div><h2>${escape(displayRecordTitle(record))}</h2><p>${escape(publicRecord(record,'records').description)}</p>${publicCertaintyMarkup(publicRecord(record,'records'))}${originalRecordDetails(record,publicRecord(record,'records'))}${publicModelNoteMarkup(record)}${record.kind==='hypothesis'&&state.evidence!=='reconstructed'?'<p class="dossier-hidden-note">当前资料模式隐藏这项推测版图。</p>':''}<div class="dossier-record-links"><button class="text-button" data-dossier-record="${escape(record.id)}">查看 ${record.year} 年地图 →</button>${recordLinks(record)}</div></article>`).join('')}</div>${country.questions.length?`<div class="dossier-questions"><h2>仍待核对</h2><ul>${publicView.country(country).questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ul></div>`:''}</article>`;
}
function dossierAssessments(country) {
  const entries=[...(country.reconstructionAssessment?[['primary',country.reconstructionAssessment]]:[]),...Object.entries(country.aliasReconstructionAssessments||{})];
  return entries.map(([layer,a])=>{const p=publicView.assessment(country.tag,layer,a);return `<div class="event-geography"><strong>${layer==='primary'?'连续推演及其限度':'关联政体 · '+escape(a.name||a.countryId)}</strong><p>${escape(p.summary)}</p>${p.scopeLabel?`<p class="public-certainty">${escape(p.scopeLabel)}</p>`:''}${p.summary!==p.original.summary?`<details class="public-original"><summary>原评估与研究说明</summary><p>${escape(p.original.summary)}</p></details>`:''}<a href="./continuity.html?country=${encodeURIComponent(a.countryId)}">查看推理及逐省连续依据 →</a></div>`;}).join('');
}
function recordLinks(record) {
  const sources=publicRecord(record).sourceIds.map(id=>dossiers?.sources[id]||chronology?.sources?.[id]).filter(Boolean);
  if(record.sourceUrl)sources.push({url:record.sourceUrl,title:record.sourceTitle});
  return [...new Map(sources.map(source=>[source.url||source.path||source.title,source])).values()].map(source=>source.url?`<a href="${escape(source.url)}" target="_blank" rel="noreferrer">${escape(source.title)} ↗</a>`:`<span>${escape(source.title)} · 本地研究依据</span>`).join('');
}
function openDossier(tag) {
  const country=findDossier(dossiers,tag);if(!country)return;
  state.dossier=country.tag;renderDossier();switchTab('chronicle');document.querySelector('.sidebar-scroll').scrollTop=0;
}
async function navigateDossierRecord(id) {
  const country=findDossier(dossiers,state.dossier),record=country?.records.find(r=>r.id===id);if(!record)return;
  switchTab('chronicle');setYear(record.year);const request=viewRequest;await pendingView;
  if(request!==viewRequest||state.dossier!==country.tag)return;
  const active=currentDossierCountry(country,atlas);
  if(active){state.selected=active.tag;buildSelection();renderCountry();}
  renderDossier();
  const current=$('dossier-content').querySelector(`[data-dossier-entry="${CSS.escape(id)}"]`);current?.scrollIntoView({block:'nearest'});
}
function syncOverlayLegendColors(){
  const selectors={1:'.hypothesis-dots',2:'.projection-lines',3:'.continued-dots',4:'.attested-change',5:'.hypothesis-change'};
  for(const [kind,selector] of Object.entries(selectors)){
    for(const node of document.querySelectorAll('.legend-swatch'+selector)){
      node.style.setProperty('--pattern-color','#383838');node.style.setProperty('--pattern-bg','#f3f3f3');
      node.title='黑白图例只表示纹理形状；地图纹理按每处实际底色计算补色与对比度';
    }
  }
}
function renderLegend(){renderLegendContent();syncOverlayLegendColors();const summary=ready?qualificationSummary(atlas,layers.qualification):'';const node=$('political-qualification-legend');node.textContent=summary;node.hidden=!summary;}
function renderLegendContent() {
  if(ready){const counts=evidenceCounts(atlas);$('layer-counts').textContent=`本年已显示：开局 ${counts.setup} · 推测 ${counts.hypothesis} · 史料投影 ${counts.reconstructed} · 锚点约束 ${counts.anchored} · 旧界延续 ${counts.continued} 省。`;
    if(['reconstructed','endpoint-projection'].includes(atlas.coverage.type)){
      const keys=[];
      if(overlayTiles.some(t=>t.kind===1))keys.push('<span class="legend-swatch hypothesis-dots"></span>三角格点：推测归属');
      if(layers.projection&&(counts.reconstructed||counts.anchored))keys.push('<span class="legend-swatch projection-lines"></span>细斜纹：史料边界投影／锚点约束');
      if(layers.continued&&counts.continued)keys.push('<span class="legend-swatch continued-dots"></span>空心点：旧界延续');
      if(overlayTiles.some(t=>t.kind===4))keys.push('<span class="legend-swatch attested-change"></span>单斜线：本年史料变化');
      if(overlayTiles.some(t=>t.kind===5))keys.push('<span class="legend-swatch hypothesis-change"></span>双斜线：本年推测变化');
      $('map-legend').innerHTML=keys.join(' ')||'省份边界含重建或跨图推定；图层可单独开启';return;
    }
  }
  if(activeChanges.length&&!hasPoliticalView()) {$('map-legend').innerHTML='变更范围未核定 · 详见事件记录';return;}
  if(layers.imperial&&imperialView?.available){$('map-legend').textContent='帝国区域填色 · 国家身份与边界保留';return;}
  if(hasPoliticalView()&&state.year!==FIRST_YEAR){$('map-legend').innerHTML=`${atlas.coverage.type==='reconstructed'?(state.evidence==='attested'?'史料节点 · 空档延续旧界':'含推测延拓 · 空档延续旧界'):'坎诺以外及未核归属不着国家色'}${overlayTiles.some(t=>t.kind>=4)?'<span class="legend-divider"></span><span class="legend-swatch attested-change"></span>本年版图变化':''}`;return;}
  $('map-legend').innerHTML=!hasPoliticalView()?'<span class="legend-swatch empty"></span>地理轮廓 · 暂无政治归属':state.mode==='subjects'?'附属与宗主同色 · 特殊关系见边框图例':'<span class="legend-swatch empty"></span>未指定国家与荒地不着国家色<span class="legend-divider"></span>隐厦暂未收录';
}
function setMode(mode) {
  if(!['original','subjects'].includes(mode)||!ready)return false;
  state.mode=mode;$('original-mode').setAttribute('aria-pressed',String(mode==='original'));$('subject-mode').setAttribute('aria-pressed',String(mode==='subjects'));
  if(mode==='subjects')buildSubjectLayer();recolor();renderLegend();return true;
}
function renderSearch() {
  if(!ready||!hasPoliticalView())return;
  const query=$('country-search').value;searchMatches=searchableCountries(atlas.countries,query).slice(0,25);state.searchIndex=-1;$('country-search').removeAttribute('aria-activedescendant');
  $('search-results').innerHTML=searchMatches.length?searchMatches.map((c,i)=>`<button class="search-result" id="result-${i}" role="option" aria-selected="false" data-search-country="${c.tag}">${flagMarkup(c)}<span>${escape(countryName(c))}<small>${escape(c.name)} · ${c.tag}</small></span></button>`).join(''):'<div class="search-empty">没有找到匹配的国家</div>';
  $('search-results').hidden=false;$('country-search').setAttribute('aria-expanded','true');
}
function closeSearch() {$('search-results').hidden=true;$('country-search').setAttribute('aria-expanded','false');$('country-search').removeAttribute('aria-activedescendant');state.searchIndex=-1;}
function jumpRecord(direction) {
  const choices=eventYears(events).filter(year=>direction>0?year>state.year:year<state.year);
  const year=direction>0?choices[0]:choices.at(-1);if(year){setYear(year);switchTab('events');}
}

canvas.addEventListener('wheel',event=>{
  event.preventDefault();const p=point(event);if(!frameContains(p.x,p.y,currentFrame()))return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?cssHeight:1);
  zoom(Math.exp(-Math.max(-800,Math.min(800,delta))*.0018),p.x,p.y);
},{passive:false});
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||!ready||pointers.size>=2)return;
  const p=point(event);if(!frameContains(p.x,p.y,currentFrame()))return;
  canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,p);
  if(pointers.size===1){drag={...p,tx,ty};pointerMoved=false;}
  else if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale,x:(a.x+b.x)/2,y:(a.y+b.y)/2,tx,ty};pointerMoved=true;}
  hideTooltip();canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove',event=>{
  const p=point(event);
  if(!pointers.has(event.pointerId)){if(event.pointerType!=='touch')hover(p);return;}
  pointers.set(event.pointerId,p);
  if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;scale=Math.max(fitScale*MIN_ZOOM,Math.min(MAX_SCALE,pinch.scale*distance/Math.max(pinch.distance,1)));tx=cx-(pinch.x-pinch.tx)*scale/pinch.scale;ty=cy-(pinch.y-pinch.ty)*scale/pinch.scale;constrain();requestDraw();}
  else if(drag){const dx=p.x-drag.x,dy=p.y-drag.y;if(Math.hypot(dx,dy)>4)pointerMoved=true;tx=drag.tx+dx;ty=drag.ty+dy;constrain();requestDraw();}
});
function endPointer(event,cancelled=false) {
  if(!pointers.has(event.pointerId))return;
  const p=point(event);pointers.delete(event.pointerId);
  if(!pointers.size){if(!cancelled&&!pointerMoved&&frameContains(p.x,p.y,currentFrame())){const change=pickChange(p.x,p.y);if(change)selectChange(change.id);else if(hasPoliticalView()){const province=pick(p.x,p.y);if(visibleProvince(province))selectCountry(province.owner);else{state.selected=null;state.selectedChange=null;buildSelection();renderCountry();}}else{state.selectedChange=null;renderCountry();requestDraw();}}drag=null;pinch=null;canvas.classList.remove('dragging');}
  else{const remaining=[...pointers.values()][0];drag={...remaining,tx,ty};pinch=null;pointerMoved=true;}
}
canvas.addEventListener('pointerup',event=>endPointer(event));canvas.addEventListener('pointercancel',event=>endPointer(event,true));canvas.addEventListener('pointerleave',hideTooltip);
canvas.addEventListener('lostpointercapture',event=>endPointer(event,true));
function cancelGestures(){
  const ids=[...pointers.keys()];pointers.clear();drag=null;pinch=null;pointerMoved=true;
  for(const id of ids)if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
  canvas.classList.remove('dragging');hideTooltip();
}
window.addEventListener('blur',cancelGestures);window.addEventListener('pagehide',cancelGestures);
canvas.addEventListener('keydown',event=>{
  if(!ready)return;let handled=true;
  if(event.key==='+'||event.key==='=')zoom(1.4);else if(event.key==='-')zoom(1/1.4);else if(event.key==='Home')fit();else if(event.key==='ArrowLeft')tx+=65;else if(event.key==='ArrowRight')tx-=65;else if(event.key==='ArrowUp')ty+=65;else if(event.key==='ArrowDown')ty-=65;else handled=false;
  if(handled){event.preventDefault();constrain();resetGestureOrigin();hideTooltip();requestDraw();}
});
$('zoom-in').addEventListener('click',()=>zoom(1.5));$('zoom-out').addEventListener('click',()=>zoom(1/1.5));$('fit-map').addEventListener('click',fit);
$('render-quality').addEventListener('change',event=>{const value=Number(event.target.value);if([1,2,3].includes(value)){renderQuality=value;resize();}});
$('border-weight').addEventListener('change',event=>{borderWeight=Number(event.target.value);requestDraw();});
$('province-border-weight').addEventListener('change',event=>{const value=Number(event.target.value);if([1,2,3].includes(value)){provinceBorderWeight=value;requestDraw();}});
$('original-mode').addEventListener('click',()=>setMode('original'));$('subject-mode').addEventListener('click',()=>setMode('subjects'));
$('endpoint-remote').addEventListener('change',()=>{const url=new URL(location.href);if($('endpoint-remote').checked)url.searchParams.set('remote','1');else url.searchParams.delete('remote');window.history.replaceState(null,'',url);if(state.year===LAST_YEAR)requestYearView();});
$('evidence-mode').addEventListener('change',event=>{state.evidence=event.target.value;setYear(state.year);renderLegend();requestDraw();$('announcement').textContent='已更新资料模式。本年变化以斜线标示：推测双线，史料单线。';});
for(const name of Object.keys(layers)){
  $(`layer-${name}`).checked=layers[name];
  $(`layer-${name}`).addEventListener('change',event=>{
    layers[name]=event.target.checked;
    if(name==='qualification'){saveQualificationPreference(layers.qualification);recolor();}
    else if(name==='provinces')buildProvinceLayer();
    else if(name==='imperial')buildImperialLayer();
    else buildOverlayLayers();
    renderLegend();requestDraw();
  });
}
function commitYearInput() {
  const value=Number($('year-input').value);
  if(value===state.year)return;
  if(!setYear(value)){$('year-input').value=state.year;$('announcement').textContent='请输入 1444 至 1820 之间的整数年份。';}
}
$('year-input').addEventListener('change',commitYearInput);
$('year-input').addEventListener('blur',commitYearInput);
$('year-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitYearInput();}});
$('year-input').addEventListener('input',()=>{const value=$('year-input').value;if(/^\d{4}$/.test(value)&&validYear(value)&&Number(value)!==state.year)setYear(Number(value));});
$('year-slider').addEventListener('input',event=>setYear(Number(event.target.value)));
$('bookmark-select').addEventListener('change',event=>navigateBookmark(event.target.value));
$('previous-year').addEventListener('click',()=>setYear(state.year-1));$('next-year').addEventListener('click',()=>setYear(state.year+1));
$('previous-event').addEventListener('click',()=>jumpRecord(-1));$('next-event').addEventListener('click',()=>jumpRecord(1));
$('back-to-baseline').addEventListener('click',()=>{setYear(FIRST_YEAR);switchTab('country');});
for(const tab of ['country','events','chronicle'])$(`${tab}-tab`).addEventListener('click',()=>switchTab(tab));
document.querySelector('.sidebar-tabs').addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const tabs=['country','events','chronicle'];switchTab(tabs[(tabs.indexOf(state.tab)+(event.key==='ArrowRight'?1:2))%3]);$(`${state.tab}-tab`).focus();}});
$('country-search').addEventListener('input',renderSearch);$('country-search').addEventListener('focus',renderSearch);
$('country-search').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeSearch();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();if($('search-results').hidden)renderSearch();if(!searchMatches.length)return;
    state.searchIndex=state.searchIndex<0?(event.key==='ArrowDown'?0:searchMatches.length-1):(state.searchIndex+(event.key==='ArrowDown'?1:-1)+searchMatches.length)%searchMatches.length;
    for(let i=0;i<searchMatches.length;i++)$(`result-${i}`).setAttribute('aria-selected',String(i===state.searchIndex));
    const selected=$(`result-${state.searchIndex}`);$('country-search').setAttribute('aria-activedescendant',selected.id);selected.scrollIntoView({block:'nearest'});
  } else if(event.key==='Enter'&&!$('search-results').hidden&&searchMatches.length){event.preventDefault();selectCountry(searchMatches[Math.max(0,state.searchIndex)].tag,{focus:true});canvas.focus({preventScroll:true});}
});
document.addEventListener('click',event=>{
  const target=event.target.closest('button');
  if(target?.dataset.bookmark)navigateBookmark(target.dataset.bookmark);
  else if(target?.hasAttribute('data-retry-imperial'))loadImperialData();
  else if(target?.dataset.dossier)openDossier(target.dataset.dossier);
  else if(target?.hasAttribute('data-dossier-back')){state.dossier=null;renderDossier();document.querySelector('.sidebar-scroll').scrollTop=0;}
  else if(target?.hasAttribute('data-dossier-focus')){const country=currentDossierCountry(findDossier(dossiers,state.dossier),atlas);if(country)focusCountry(country.tag);}
  else if(target?.dataset.dossierRecord)navigateDossierRecord(target.dataset.dossierRecord);
  else if(target?.dataset.record){const record=chronology.steps.find(step=>step.id===target.dataset.record);if(record){setYear(record.year);selectChange(record.id);}}
  else if(target?.dataset.change)selectChange(target.dataset.change,{focus:target.dataset.focus==='true'});
  else if(target?.dataset.locateEvent)focusEvent(target.dataset.locateEvent);
  else if(target?.dataset.focusChange)focusChanges(target.dataset.focusChange);
  else if(target?.hasAttribute('data-focus-changes'))focusChanges();
  else if(target?.hasAttribute('data-focus-coverage'))focusCoverage();
  else if(target?.hasAttribute('data-clear-change')){state.selectedChange=null;renderCountry();requestDraw();}
  else if(target?.dataset.changeEndpoint){const id=target.dataset.changeEndpoint;setYear(LAST_YEAR);selectChange(id);}
  else if(target?.dataset.searchCountry)selectCountry(target.dataset.searchCountry,{focus:true});
  else if(target?.dataset.country)selectCountry(target.dataset.country,{focus:target.dataset.focus==='true'});
  else if(target?.dataset.focusCountry)focusCountry(target.dataset.focusCountry);
  else if(target?.hasAttribute('data-clear-country')){state.selected=null;buildSelection();renderCountry();}
  else if(target?.hasAttribute('data-baseline')){setYear(FIRST_YEAR);switchTab('country');}
  else if(target?.dataset.year){setYear(Number(target.dataset.year));switchTab('events');}
  else if(target?.hasAttribute('data-next-record'))jumpRecord(eventYears(events).some(year=>year>state.year)?1:-1);
  if(!event.target.closest('.search-wrap'))closeSearch();
});
$('sources-button').addEventListener('click',()=>$('sources-dialog').showModal());$('close-sources').addEventListener('click',()=>$('sources-dialog').close());
$('sources-dialog').addEventListener('click',event=>{if(event.target===$('sources-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('dossier-search').addEventListener('input',renderDossier);
$('dossier-group').addEventListener('change',renderDossier);
$('reload-button').addEventListener('click',()=>location.reload());
new ResizeObserver(resize).observe($('map-stage'));
initializeMapFullscreen({document});

function installWebTools() {
  const registry=document.modelContext;if(!registry?.registerTool)return;
  const controller=new AbortController();window.addEventListener('pagehide',()=>controller.abort(),{once:true});
  const tools=[
    {name:'navigate_atlas_year',description:'选择 1444—1820 的年份并更新地图与事件。1444 有开局快照；1445—1819 提供有标注的坎诺、布勒瓦尔、阳洲、东洲与蛇脊的分期重建；1820 将 Vic3 开局归属映射到同一 EU4 底图，边界推定可分层查看。',inputSchema:{type:'object',properties:{year:{type:'integer',minimum:1444,maximum:1820}},required:['year'],additionalProperties:false},execute:async input=>{if(!input||!validYear(input.year))throw new Error('年份应为 1444—1820 的整数');setYear(input.year);await pendingView;return {year:state.year,politicalSnapshot:hasPoliticalView(),historicalPlaces:activeChanges.map(c=>({id:c.id,name:c.nameZh,phase:changePhase(c,state.year)})),events:eventsAtYear(events,state.year).map(e=>displayRecordTitle(e))};}},
    {name:'select_atlas_country',description:'在当前所选年份按国家 TAG 选择并定位国家；1820 使用 v3: 前缀的 TAG，打开与点击地图相同的详情。',inputSchema:{type:'object',properties:{tag:{type:'string'}},required:['tag'],additionalProperties:false},execute:async input=>{if(!input||typeof input.tag!=='string'||!selectCountry(input.tag,{focus:true}))throw new Error('该国家在当前年份没有可用版图');await new Promise(requestAnimationFrame);const c=atlas.countries[state.selected];return {year:state.year,tag:c.tag,name:countryName(c),provinces:c.provinceIds.length};}}
  ];
  for(const tool of tools){try{Promise.resolve(registry.registerTool({...tool,annotations:{readOnlyHint:false,untrustedContentHint:false}},{signal:controller.signal})).catch(()=>{});}catch{/* Optional browser API. */}}
}
init();
