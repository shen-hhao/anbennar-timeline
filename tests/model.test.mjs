import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {FIRST_YEAR,LAST_YEAR,validYear,visibleProvince,resolveColor,resolveSourceColor,pastelColor,searchableCountries} from '../dist/model.js';
const load=name=>JSON.parse(readFileSync(new URL(`../dist/data/${name}`,import.meta.url),'utf8'));
const atlas=load('atlas.json'),subjects=load('subjects.json'),zh=load('names-zh.json');
const relations=Object.fromEntries(subjects.map(r=>[r.subject,r]));

test('year navigation accepts all 377 annual positions and rejects invalid dates',()=>{
  assert.equal(LAST_YEAR-FIRST_YEAR+1,377);
  for(let year=FIRST_YEAR;year<=LAST_YEAR;year++)assert.equal(validYear(year),true);
  for(const value of [1400,1821,1444.5,NaN,Infinity,''])assert.equal(validYear(value),false);
  assert.equal(validYear(1820),true);
});
test('core-only, empty, water, wasteland and excluded provinces cannot become political areas',()=>{
  assert.equal(visibleProvince({cores:['A01'],owner:null}),false);
  for(const key of ['water','wasteland','excluded'])assert.equal(visibleProvince({owner:'A01',[key]:true}),false);
  assert.equal(Object.values(atlas.provinces).filter(visibleProvince).length,atlas.stats.politicalProvinces);
  for(const p of Object.values(atlas.provinces).filter(visibleProvince))assert.ok(atlas.countries[p.owner]?.provinceIds.includes(p.id));
});
test('rendered colors use source-hue pastels while source metadata remains exact',()=>{
  for(const c of Object.values(atlas.countries)){
    const source=[...c.color];
    assert.deepEqual(resolveColor(c.tag,atlas.countries,relations,'original'),pastelColor(source));
    assert.deepEqual(resolveSourceColor(c.tag,atlas.countries,relations,'original'),source);
    assert.deepEqual(resolveColor(c.tag,atlas.countries,relations,'original','source'),source);
    assert.deepEqual(c.color,source);
  }
  assert.equal(relations.A03.overlord,'A01');
  assert.deepEqual(resolveColor('A03',atlas.countries,relations,'subjects'),pastelColor(atlas.countries.A01.color));
  assert.notEqual(atlas.countries.A03.tag,atlas.countries.A01.tag);
  assert.equal(relations.A30,undefined,'Wex is an ally, not a Lorent subject');
  assert.deepEqual(resolveColor('A30',atlas.countries,relations,'subjects'),pastelColor(atlas.countries.A30.color));
});
test('all subject types use the exact overlord fill, including union and Satrapy',()=>{
  assert.equal(relations.A14.type,'personal_union');assert.equal(relations.A14.overlord,'A04');
  const unionColor=resolveColor('A14',atlas.countries,relations,'subjects');
  assert.deepEqual(unionColor,resolveColor('A04',atlas.countries,relations,'subjects'));
  assert.equal(relations.U10.type,'tributary_state');assert.equal(relations.U10.typeLabel,'Satrapy');
  assert.equal(subjects.filter(r=>r.startDate==='1444.11.11').length,24);
  for(const relation of subjects){
    assert.deepEqual(resolveColor(relation.subject,atlas.countries,relations,'subjects'),resolveColor(relation.overlord,atlas.countries,relations,'subjects'));
  }
});
test('invalid cyclic or missing-overlord relations fail back to original color',()=>{
  const countries={A:{color:[10,20,30]},B:{color:[40,50,60]}};
  assert.deepEqual(resolveColor('A',countries,{A:{overlord:'B',control:'direct'},B:{overlord:'A',control:'direct'}},'subjects'),pastelColor([10,20,30]));
  assert.deepEqual(resolveColor('A',countries,{A:{overlord:'X'}},'subjects'),pastelColor([10,20,30]));
});
test('mixed-control nested subjects inherit one root color without compounding tints',()=>{
  const countries={A:{color:[110,30,180]},B:{color:[30,50,10]},C:{color:[220,210,70]}};
  const relationships={C:{overlord:'B',control:'tributary'},B:{overlord:'A',control:'autonomous'}};
  assert.deepEqual(resolveColor('C',countries,relationships,'subjects'),resolveColor('A',countries,relationships,'subjects'));
  assert.deepEqual(resolveColor('C',countries,relationships,'subjects','source'),countries.A.color);
});
test('pastel transformation stays bounded and preserves distinct hue families',()=>{
  const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255],[0,255,255],[128,70,30]];
  const converted=colors.map(pastelColor);
  assert.equal(new Set(converted.map(value=>value.join(','))).size,colors.length);
  for(const [index,color] of converted.entries()){
    assert.ok(color.every(value=>Number.isInteger(value)&&value>=0&&value<=255));
    const linear=color.map(value=>value/255<=.04045?value/255/12.92:((value/255+.055)/1.055)**2.4);
    assert.ok(.2126*linear[0]+.7152*linear[1]+.0722*linear[2]>=.4,`too dark: ${colors[index]}`);
    assert.ok(Math.max(...color)-Math.min(...color)>=40,`washed out: ${colors[index]}`);
  }
  assert.ok(converted[0][0]>converted[0][1]&&converted[0][0]>converted[0][2]);
  assert.ok(converted[1][1]>converted[1][0]&&converted[1][1]>converted[1][2]);
  assert.ok(converted[2][2]>converted[2][0]&&converted[2][2]>converted[2][1]);
  const grays=[0,64,128,192,255].map(value=>pastelColor([value,value,value]));
  for(let i=0;i<grays.length;i++){
    assert.ok(Math.max(...grays[i])-Math.min(...grays[i])<=1);
    if(i) assert.ok(grays[i][0]>grays[i-1][0]);
  }
  assert.ok(grays[4][0]<235,'near-white source colors retain a visible land fill');
  const source=[50,90,160],first=pastelColor(source);
  first[0]=0;
  assert.notDeepEqual(pastelColor(source),first,'cached palette results cannot be mutated by a caller');
});
test('active countries have flags, valid pixel bounds and no excluded provinces',()=>{
  assert.equal(Object.keys(atlas.countries).length,803);
  for(const c of Object.values(atlas.countries)){
    assert.ok(c.provinceIds.length);assert.ok(existsSync(new URL(`../dist/data/${c.flag}`,import.meta.url)),c.tag);
    assert.equal(c.color.length,3);assert.ok(c.color.every(x=>Number.isInteger(x)&&x>=0&&x<=255));
    assert.ok(c.center[0]>=c.bounds[0]&&c.center[0]<=c.bounds[2]);
    assert.ok(c.center[1]>=c.bounds[1]&&c.center[1]<=c.bounds[3]);
    for(const id of c.provinceIds){assert.equal(atlas.provinces[id].owner,c.tag);assert.ok(visibleProvince(atlas.provinces[id]));}
  }
});
test('Chinese, English and TAG search resolve the same source identity',()=>{
  const countries=Object.fromEntries(Object.entries(atlas.countries).map(([tag,c])=>[tag,{...c,nameZh:zh.countries[tag]}]));
  for(const query of ['洛伦特','Lorent','a01'])assert.equal(searchableCountries(countries,query)[0].tag,'A01');
  assert.equal(zh.countries.A04,'威斯达姆');
  for(const c of Object.values(countries))if(c.nameZh)assert.doesNotMatch(c.nameZh,/[\x00-\x1f\uE000-\uF8FF]/);
});

test('endpoint search accepts an audited EU4 identity tag without confusing it with the Vic3 namespace',()=>{
  const countries={
    'v3:A03':{tag:'v3:A03',eu4Tag:'A01',name:'Lorent',nameZh:'洛伦特',provinceIds:[1,2]},
    'v3:A01':{tag:'v3:A01',eu4Tag:'Z99',name:'Anbennar',nameZh:'安本纳尔',provinceIds:[3,4,5]},
    'v3:X':{tag:'v3:X',eu4Tag:'A01',name:'No mapped territory',provinceIds:[]},
  };
  for(const query of ['a01','洛伦特','Lorent'])assert.equal(searchableCountries(countries,query)[0].tag,'v3:A03');
  assert.equal(searchableCountries(countries,'v3:A01')[0].tag,'v3:A01');
  assert.equal(searchableCountries(countries,'A01').some(c=>c.tag==='v3:X'),false);
});
