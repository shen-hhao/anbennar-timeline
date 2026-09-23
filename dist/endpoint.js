import {applyEndpointReview} from './endpoint-review.js';
import {groupCountries} from './reconstruction.js';

const relationLabels={puppet:'傀儡国',vassal:'附庸国',colony:'殖民属地',tributary:'朝贡国',
  protectorate:'受保护国',chartered_company:'特许公司',dominion:'自治领',personal_union:'被联统国'};
const sameObservation=(a,b)=>a===b||Boolean(a&&b&&typeof a==='object'&&typeof b==='object'
  &&Array.isArray(a)===Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length
  &&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameObservation(a[k],b[k])));
const hasSpatialCitations=c=>Array.isArray(c?.spatialEvidence)&&c.spatialEvidence.length>0
  &&c.spatialEvidence.every(e=>e&&Array.isArray(c.sourceIds)&&c.sourceIds.includes(e.sourceId)
    &&typeof e.sha256==='string'&&/^[a-f0-9]{64}$/i.test(e.sha256)
    &&typeof e.locator==='string'&&e.locator.trim()&&typeof e.supports==='string'&&e.supports.trim());

// The source snapshot and the display geometry are separate. Only political
// assignments cross the boundary; V3 pixel IDs, bounds and centers never do.
export function buildEndpointView(base, endpoint, identities, evidence='reconstructed', options={}) {
  if(endpoint.year!==1820 || endpoint.width!==base.width || endpoint.height!==base.height)
    throw new Error('1820 映射与 EU4 底图尺寸不一致');
  const registry=identities?.countries||{},actors={};
  for(const [tag,source] of Object.entries(endpoint.countries||{})) {
    const identity=registry[tag]||{};
    actors[tag]={...source,...identity,tag,capital:source.capital??null,
      capitalBasis:source.capitalBasis||'按 Vic3 首都地名映射至 EU4 省份；未定部分不指定首都。'};
  }
  const provinces={};
  const cartographic=endpoint.cartographicFill;
  const fillRows=cartographic?.schemaVersion===1&&Array.isArray(cartographic.overrides)
    ?cartographic.overrides.filter(row=>row&&row.kind==='cartographic-vote-fill'):[];
  // Reviewed correspondences have priority over automatic cartographic fills.
  // Both remain optional; the raw province assignment is never overwritten.
  const overrides=new Map((evidence==='reconstructed'?[...fillRows,...(endpoint.reconstructionOverrides?.overrides||[])]:[]).map(item=>[item.provinceId,item]));
  for(const [id,p] of Object.entries(base.provinces)) {
    const assignment=endpoint.provinces?.[id];
    const candidate=overrides.get(p.id);
    const reviewedCorrection=candidate?.reviewType==='boundary-correspondence-correction'
      &&sameObservation(candidate.originalAssignment,assignment)&&hasSpatialCitations(candidate);
    const automatic=candidate?.kind==='cartographic-vote-fill';
    const validAutomatic=!automatic||(!assignment?.owner&&sameObservation(candidate.originalAssignment,assignment)
      &&candidate.certainty==='hypothesis'&&candidate.dateEvidence?.observedYear===1820
      &&candidate.dateEvidence.exactYear===null&&candidate.dateEvidence.dateIsHistoricalFact===false
      &&Number.isInteger(candidate.sampleCount)&&candidate.sampleCount>0
      &&['dense-area-plurality','distance-weighted-shore-vote'].includes(candidate.method)
      &&['medium','low','very-low'].includes(candidate.confidenceBand)
      &&Array.isArray(candidate.sourceProvinceIds)&&candidate.sourceProvinceIds.length>0
      &&candidate.sourceProvinceIds.every(id=>Number.isInteger(id)&&id>0));
    const eligible=assignment&&validAutomatic&&(!assignment.owner||reviewedCorrection)&&actors[candidate?.owner]&&!p.water&&!p.wasteland&&!p.excluded;
    const remote=eligible&&automatic&&candidate.remoteExtrapolation===true&&!options.remoteExtrapolation?candidate:null;
    const inference=eligible&&!remote?candidate:null;
    const certainty=inference?'hypothesis':assignment?.certainty||assignment?.basis?.certainty||'hypothesis';
    const shown=evidence!=='confirmed' && (evidence!=='attested'||certainty==='reconstructed');
    const valid=assignment && (assignment.coverage!==false||inference) && !p.water && !p.wasteland && !p.excluded;
    const owner=valid&&shown?(inference&&actors[inference.owner]?inference.owner:!assignment.sourceConflict&&actors[assignment.owner]?assignment.owner:null):null;
    provinces[id]={...p,owner,controller:null,coverage:Boolean(owner),
      ownerStatus:owner?'endpoint_owner':'source_unresolved',coverageStatus:owner?'endpoint_projected':'source_unresolved',
      settlementState:{status:'source_unspecified'},
      sourceConflict:Boolean(assignment?.sourceConflict)&&!inference,
      originalSourceConflict:Boolean(assignment?.sourceConflict),
      originalEndpointOwner:assignment?.owner??null,
      endpointInference:inference||null,
      remoteCorrespondence:remote||null,
      cartographicFill:inference?.kind==='cartographic-vote-fill'?{method:inference.method,confidenceBand:inference.confidenceBand,
        weightedWinnerShare:inference.weightedWinnerShare,directWinnerShare:inference.directWinnerShare,
        shoreDistanceP95:inference.shoreDistanceP95}:null,
      projection:assignment?{method:assignment.method,confidence:assignment.confidence??assignment.support,support:assignment.support,
        sourceProvinceIds:assignment.sourceProvinceIds,candidateOwners:assignment.candidateOwners,reasons:assignment.reasons,notes:assignment.notes}:null,
      basis:owner?{year:1820,certainty,sourceId:inference?(inference.sourceId||(automatic?'endpoint-cartographic-vote-fill':'wc080-endpoint-inferences')):'endpoint-1820-eu4',recordId:inference?.recordId,
        title:inference?.title||'1820 开局归属 · EU4 省形映射',notes:inference?.reasoning||assignment.notes||'官方开局归属映射到 EU4 省形，边界仍需逐国审校。'}:null};
  }
  const countries=groupCountries(provinces,actors);
  const sourceRelations=endpoint.subjects||endpoint.relations||[];
  const relations=Object.fromEntries((Array.isArray(sourceRelations)?sourceRelations:Object.values(sourceRelations))
    .filter(r=>countries[r.subject]&&countries[r.overlord]).map(r=>[r.subject,{...r,
      typeLabel:r.typeLabel||relationLabels[r.type]||r.type,
      control:r.control||(r.type==='tributary'?'tributary':['protectorate','dominion','chartered_company','colony'].includes(r.type)?'autonomous':'direct')}]));
  const projectionSummary={sourceCountries:Object.keys(actors).length,mappedCountries:Object.keys(countries).length,
    unmappedCountries:Object.values(actors).filter(c=>!countries[c.tag]).map(c=>({tag:c.tag,name:c.name,nameZh:c.nameZh,
      reason:evidence==='confirmed'?'当前模式隐藏跨图映射':evidence==='attested'?'无可显示的强对应省份，或仅有待审映射':c.mappingNoteZh||c.mappingNote||'尚无可分配的 EU4 省份，待逐国审校'}))};
  const fillCount=Object.values(provinces).filter(p=>p.cartographicFill).length;
  const description='Vic3 1820 静态开局归属映射至 EU4 原始省形；地名对应与地理配准不等于精确正史边界。空白可表示映射不足、源冲突或暂缓地区，不能解释为历史上无主。'
    +(fillCount?` 当前含${fillCount}省跨图投票补色；各省票数、距离及置信度单列，远距离补色属于极弱候选，不表示1820年发生转属。`:'')
    +(Object.values(provinces).some(p=>p.remoteCorrespondence)?' 远海未找到有效对应的地块显示待核底色；可在图层中启用最近国家极弱推测。':'');
  const view={...base,year:1820,date:'1820.1.1',countries,provinces,relations,geometryKey:'eu4',sourceGeometry:'vic3',
    imperialCentralTag:endpoint.imperialCentralTag||'v3:A01',signature:`eu4:endpoint:1820:${evidence}:${options.remoteExtrapolation?'remote':'bounded'}`,
    provenance:{...base.provenance,endpoint:endpoint.provenance},projectionSummary,
    stats:{...base.stats,countries:Object.keys(countries).length,politicalProvinces:Object.values(countries).reduce((sum,c)=>sum+c.provinceIds.length,0)},
    coverage:{type:evidence==='confirmed'?'none':'endpoint-projection',title:evidence==='confirmed'?'1820 跨图映射已隐藏':'1820 开局 · EU4 省形映射',
      description:evidence==='confirmed'?'仅开局确证模式不显示跨图推定边界；切换“仅史料节点重建”或“含推测延拓”查看 1820 映射。':description,
      latestYear:1820,sourceGeometry:'vic3'}};
  return options.reviewRegistry?applyEndpointReview(view,options.reviewRegistry,{regroup:groupCountries,actors,sourceRelations,evidence,comparisonMode:options.reviewComparison===true}):view;
}
