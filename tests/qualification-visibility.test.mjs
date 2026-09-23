import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
const dist=process.env.ATLAS_TEST_ROOT?path.resolve(process.env.ATLAS_TEST_ROOT):fileURLToPath(new URL('../dist/',import.meta.url));
const moduleAt=name=>import(pathToFileURL(path.join(dist,name)));
const {qualifiedPixelColor,qualificationSummary,qualificationPaintSignature,qualificationDisplayText,loadQualificationPreference,saveQualificationPreference}=await moduleAt('political-qualification.js');
const {buildReconstruction}=await moduleAt('reconstruction.js');
const {resolveColor,validYear,visibleProvince}=await moduleAt('model.js');
const {surfaceKind}=await moduleAt('boundary-style.js');

// Run the shipped handlers and RGBA fill, with only DOM/canvas boundaries mocked.
// These small fixture polities and years are orchestration cases, not history.
const source=readFileSync(path.join(dist,'app.js'),'utf8');
const html=readFileSync(path.join(dist,'index.html'),'utf8');
function section(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,`Missing actual application section: ${start}`);
 return source.slice(a,b);
}
function fixture(){
 const provinces=Object.fromEntries([1,2,3,4].map(id=>[id,{id,name:`Fixture${id}`,owner:id===4?null:id===2?'fixture:b':'fixture:a',water:id===4,wasteland:false,excluded:false,bounds:[(id-1)*10,0,id*10-1,0],center:[(id-1)*10+5,0],pixels:10}]));
 const countries={
  'fixture:a':{tag:'fixture:a',name:'Fixture A',color:[200,60,40],provinceIds:[1,3]},
  'fixture:b':{tag:'fixture:b',name:'Fixture B',color:[25,90,180],provinceIds:[2]}
 };
 const base={width:40,height:1,provinces,countries,stats:{countries:2,politicalProvinces:3}};
 const relations={'fixture:a':{subject:'fixture:a',overlord:'fixture:b',type:'vassal',control:'indirect'}};
 const chron={startYear:1445,endYear:1819,coverageProvinceIds:[1,2,3],actors:{},steps:[],politicalQualifications:[
  {id:'fixture-shared',provinceIds:[1],fromYear:1449,throughYear:1450,visibleText:'部分地区分治，内部边界未明。',secondaryDisplayRole:'concurrent-control',displaySecondaryOwner:'fixture:b'},
  {id:'fixture-local',provinceIds:[2],fromYear:1449,throughYear:1450,visibleText:'地方群体的概略范围，非统一国家。'}
 ]};
 return {base,relations,chron};
}
function harness(){
 const f=fixture(),nodes=new Map(),counts={paints:0,draws:0,mapBuilds:0,resizes:0,overlays:0};
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,hidden:true,textContent:'',checked:false,listeners:new Map(),attributes:new Map(),
   addEventListener(name,handler){this.listeners.set(name,handler);},setAttribute(name,value){this.attributes.set(name,value);}});
  return nodes.get(id);
 };
 const initial=buildReconstruction(f.base,f.relations,f.chron,1450,'reconstructed');
 const rgba=new Uint8ClampedArray(160);for(let i=0;i<40;i++)rgba.set([225,226,227,255],i*4);
 const c=vm.createContext({
  atlas:initial,baseAtlas:f.base,baseRelations:f.relations,chronology:f.chron,
  state:{year:1450,evidence:'reconstructed',mode:'original',selected:'fixture:a',selectedChange:null,tab:'country'},
  ready:true,resizePending:false,viewRequest:0,currentGeometry:'eu4',currentSignature:initial.signature,
  mapWidth:40,mapHeight:1,scale:2.75,tx:-34.5,ty:81.25,fitScale:.8,
  idPixels:Uint16Array.from({length:40},(_,i)=>Math.floor(i/10)+1),ownerIndex:null,kinds:null,countryTags:[],relations:initial.relations,
  geographicalImage:{data:rgba},politicalImage:{data:new Uint8ClampedArray(160)},
  political:{getContext:()=>({putImageData(){counts.paints++;}})},
  $:node,qualifiedPixelColor,qualificationSummary,qualificationPaintSignature,qualificationDisplayText,loadQualificationPreference,saveQualificationPreference,resolveColor,visibleProvince,surfaceKind,validYear,buildReconstruction,
  FIRST_YEAR:1444,LAST_YEAR:1820,eu4IdsImage:{},relationSemanticRegistry:{},endpointReviewRegistry:null,
  buildRelationSemantics:()=>({}),relationSemanticView:null,
  requestDraw(){counts.draws++;},renderLegendContent(){},syncOverlayLegendColors(){},
  buildOverlayLayers(){counts.overlays++;},buildProvinceLayer(){},buildImperialLayer(){},buildSubjectLayer(){},buildSelection(){},
  resize(){counts.resizes++;},decodeMap(){throw Error('Same EU4 geometry must not be decoded again');},
  events:[],history:{},activeChanges:[],annualChanges:[],
  changesAtYear:()=>[],territorialChangesAtYear:()=>[],eventsAtYear:()=>[],cancelGestures(){},closeSearch(){},hideTooltip(){},renderEvents(){},switchTab(){},
 });
 const declaration=source.match(/^const layers = .+;$/m)?.[0];assert.ok(declaration,'Read actual layer defaults');
 vm.runInContext(`${declaration}\nglobalThis.layers=layers;\n`+[
  section('function updateLookup()','function buildMapLayers()'),
  section('function recolor()','function buildSelection()'),
  section('function renderLegend(){','function renderLegendContent()'),
  section('async function applyYearView(','function requestYearView()'),
  section('function setYear(year)','function refreshYearUI()'),
  section('function setMode(mode)','function renderSearch()'),
  section('for(const name of Object.keys(layers))','function commitYearInput()'),
 ].join('\n'),c);
 c.buildMapLayers=()=>{counts.mapBuilds++;c.recolor();};
 c.refreshYearUI=()=>c.renderLegend();
 c.requestYearView=()=>{c.ready=false;c.pending=c.applyYearView(++c.viewRequest);};
 c.updateLookup();c.recolor();c.renderLegend();
 return {c,node,counts,fixture:f,pixel:x=>Array.from(c.politicalImage.data.slice(x*4,x*4+4)),
  toggle(value){const n=node('layer-qualification');n.checked=value;assert.equal(typeof n.listeners.get('change'),'function','Actual checkbox handler must be installed');n.listeners.get('change')({target:n});},
  async year(year){assert.equal(c.setYear(year),true);await c.pending;},
  async evidence(mode){c.state.evidence=mode;c.ready=false;await c.applyYearView(++c.viewRequest);},
 };
}
const camera=c=>[c.scale,c.tx,c.ty,c.fitScale];
const plain=value=>JSON.parse(JSON.stringify(value));

test('qualification layer is initially off in actual state and accessible checkbox markup',()=>{
 const h=harness();assert.equal(h.c.layers.qualification,false);
 const input=html.match(/<input\b[^>]*\bid="layer-qualification"[^>]*>/g)||[];
 assert.equal(input.length,1);assert.doesNotMatch(input[0],/\bchecked\b/);
 assert.match(html,/<label\b[^>]*>[\s\S]*?<input\b[^>]*\bid="layer-qualification"[^>]*>[\s\S]*?<\/label>/);
 assert.equal(h.node('political-qualification-legend').hidden,true);
});

test('pixel helper has explicit disabled behavior without discarding qualifier data',()=>{
 const q=Object.freeze({id:'fixture',secondaryColor:Object.freeze([7,8,9])}),color=Object.freeze([80,120,160]);
 for(let x=0;x<20;x++)assert.deepEqual(qualifiedPixelColor(q,color,x,0,false),color);
 assert.deepEqual(qualifiedPixelColor(q,color,6,0,true),[7,8,9]);
 assert.deepEqual(qualifiedPixelColor(q,color,6,0),[7,8,9],'Legacy direct helper calls retain enabled default');
 assert.equal(q.id,'fixture');assert.deepEqual(color,[80,120,160]);
});

test('actual checkbox repaints both stripe styles and restores exactly the old base pixels',()=>{
 const h=harness(),off=Array.from(h.c.politicalImage.data),before=plain(h.c.atlas),indices=h.c.ownerIndex,signature=h.c.currentSignature,view=camera(h.c);
 const unqualified=h.pixel(26),water=h.pixel(36),paintCount=h.counts.paints;
 h.toggle(true);
 assert.notDeepEqual(h.pixel(6),off.slice(24,28),'Secondary polity stripe must reach actual RGBA');
 assert.notDeepEqual(h.pixel(16),off.slice(64,68),'Single-polity qualification must reach actual RGBA');
 assert.deepEqual(h.pixel(26),unqualified);assert.deepEqual(h.pixel(36),water);
 assert.ok(h.counts.paints>paintCount,'Checkbox must repaint cached political fill, not just overlays');
 h.toggle(false);assert.deepEqual(Array.from(h.c.politicalImage.data),off);
 assert.deepEqual(plain(h.c.atlas),before,'Visibility must not remove political qualifiers or rewrite owner/relations');
 assert.equal(h.c.ownerIndex,indices);assert.equal(h.c.currentSignature,signature);assert.deepEqual(camera(h.c),view);
 assert.equal(h.counts.mapBuilds,0,'Visibility is not a political geometry rebuild');
});

test('actual legend disappears when disabled and gives a short non-counted explanation when enabled',()=>{
 const h=harness(),n=h.node('political-qualification-legend');h.toggle(true);
 assert.equal(n.hidden,false);assert.ok(n.textContent.trim());assert.doesNotMatch(n.textContent,/\d+\s*省/);
 assert.match(n.textContent,/条纹/);assert.match(n.textContent,/主权|边界|范围/);
 h.toggle(false);assert.equal(n.hidden,true);
});

test('same political signature across qualification boundaries still refreshes actual pixels',async()=>{
 const h=harness();h.toggle(true);const qualified=h.pixel(6),signature=h.c.currentSignature,indices=h.c.ownerIndex,view=camera(h.c);
 await h.year(1451);
 assert.equal(h.c.currentSignature,signature,'Fixture deliberately has unchanged political steps');
 assert.equal(h.c.ownerIndex,indices);assert.equal(h.c.layers.qualification,true);
 assert.equal(h.c.atlas.provinces[1].politicalQualification,undefined);
 assert.notDeepEqual(h.pixel(6),qualified,'Ended qualification must not remain baked into cached fill');
 assert.equal(h.node('political-qualification-legend').hidden,true);assert.deepEqual(camera(h.c),view);
 await h.year(1449);assert.deepEqual(h.pixel(6),qualified);assert.equal(h.node('political-qualification-legend').hidden,false);
 assert.equal(h.counts.resizes,0);assert.equal(h.counts.mapBuilds,0);
});

test('switching country/subject views preserves the checkbox and uses each actual base palette',()=>{
 const h=harness();h.toggle(true);assert.equal(h.c.setMode('subjects'),true);assert.equal(h.c.layers.qualification,true);
 h.toggle(false);
 const expected=resolveColor('fixture:a',h.c.atlas.countries,h.c.relations,'subjects');
 assert.deepEqual(h.pixel(6),[...expected,255]);assert.equal(h.c.state.mode,'subjects');
 assert.equal(h.c.setMode('original'),true);assert.equal(h.c.layers.qualification,false);
 assert.deepEqual(h.pixel(6),[...resolveColor('fixture:a',h.c.atlas.countries,h.c.relations,'original'),255]);
});

test('strict evidence filtering does not manufacture qualification and switching back preserves visibility choice',async()=>{
 const h=harness();h.toggle(true);await h.evidence('attested');
 assert.equal(h.c.layers.qualification,true);assert.equal(h.c.atlas.provinces[1].politicalQualification,undefined);
 assert.equal(h.node('political-qualification-legend').hidden,true);
 const strict=h.pixel(6);await h.evidence('reconstructed');assert.notDeepEqual(h.pixel(6),strict);
 h.toggle(false);await h.year(1449);assert.equal(h.c.layers.qualification,false);assert.equal(h.node('political-qualification-legend').hidden,true);
});

test('startup toggles are safe before canvas data exists',()=>{
 const h=harness();h.c.ready=false;h.c.atlas=undefined;h.c.politicalImage=null;
 assert.doesNotThrow(()=>{h.toggle(true);h.toggle(false);h.toggle(true);});
 assert.equal(h.c.layers.qualification,true);assert.equal(h.node('political-qualification-legend').hidden,true);
});

test('actual preference functions restore explicit true and tolerate unavailable storage',t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;});
 const stored=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)}});
 for(const value of [undefined,'false','yes','1','null','TRUE']){
  stored.clear();if(value!==undefined)stored.set('atlas:qualification-stripes',value);
  assert.equal(loadQualificationPreference(),false,'Only an explicit saved true enables the texture');
 }
 const h=harness();h.toggle(true);assert.equal(stored.get('atlas:qualification-stripes'),'true');
 const restored=harness();assert.equal(restored.c.layers.qualification,true);assert.equal(restored.node('layer-qualification').checked,true);
 restored.toggle(false);assert.equal(stored.get('atlas:qualification-stripes'),'false');assert.equal(harness().c.layers.qualification,false);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Storage blocked');}});
 assert.equal(loadQualificationPreference(),false);assert.doesNotThrow(()=>saveQualificationPreference(true));assert.doesNotThrow(()=>harness().toggle(true));
});

test('pending endpoint navigation honors the latest toggle without resetting camera or qualifiers',async()=>{
 const h=harness(),view=camera(h.c);let release;
 const endpointView={...structuredClone(h.c.atlas),year:1820,signature:'fixture-endpoint'};
 // The endpoint's already-rendered province data is an explicit orchestration fixture;
 // its projection itself belongs to the separate real-data endpoint tests.
 h.c.loadEndpoint=()=>new Promise(resolve=>{release=()=>resolve([{},{}]);});
 h.c.buildEndpointView=()=>structuredClone(endpointView);
 assert.equal(h.c.setYear(1820),true);const pending=h.c.pending;
 h.toggle(true);h.toggle(false);release();await pending;
 assert.equal(h.c.state.year,1820);assert.equal(h.c.atlas.year,1820);assert.equal(h.c.layers.qualification,false);
 assert.equal(h.node('political-qualification-legend').hidden,true);assert.deepEqual(camera(h.c),view);
 assert.deepEqual(h.pixel(6),[...resolveColor('fixture:a',h.c.atlas.countries,h.c.relations,'original'),255]);
 assert.ok(h.c.atlas.provinces[1].politicalQualification);h.toggle(true);assert.equal(h.node('political-qualification-legend').hidden,false);
});

test('display signature tracks actual stripe changes and ignores prose or object insertion order',()=>{
 const h=harness(),original=h.c.atlas,copy=structuredClone(original);
 copy.provinces=Object.fromEntries(Object.entries(copy.provinces).reverse());
 copy.provinces[1].politicalQualification.visibleText+=' 补充来源限定。';
 assert.equal(qualificationPaintSignature(original),qualificationPaintSignature(copy));
 copy.provinces[1].politicalQualification.secondaryColor=[1,2,3];
 assert.notEqual(qualificationPaintSignature(original),qualificationPaintSignature(copy));
 delete copy.provinces[1].politicalQualification;
 assert.notEqual(qualificationPaintSignature(original),qualificationPaintSignature(copy));
 assert.equal(qualificationSummary(original),'','Summary default matches the disabled layer');
 const text='彩色条纹不是1820整省主权确证；以彩色条纹延续1819方案。';
 const displayed=qualificationDisplayText(text);assert.match(displayed,/不是1820整省主权确证/);assert.match(displayed,/图层中开启/);assert.equal(text,'彩色条纹不是1820整省主权确证；以彩色条纹延续1819方案。');
});
