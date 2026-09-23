// Pure public-text view. No date, source, identity, or political data are mutated.
const strings = values => [...new Set(values.flat(Infinity).filter(x => typeof x === 'string' && x))];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sameValue = (a,b) => {
  const ordered = value => JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([x],[y])=>x.localeCompare(y))):row);
  return ordered(a)===ordered(b);
};
export const assessmentKey = (tag, layer='primary') => JSON.stringify([tag,layer]);
export const noticeKey = (file,...segments) => `${file}:/`+segments.map(x=>String(x).replaceAll('~','~0').replaceAll('/','~1')).join('/');

export function dateDisplay(record={}, step=null,semanticKind=null) {
  const date=step?.dateEvidence ?? record.dateEvidence ?? record.effectiveDateEvidence ?? {};
  const kind=step?.evidenceKind ?? step?.kind ?? record.evidenceKind ?? record.kind;
  const year=number(step?.year ?? record.year), exact=number(date.exactYear);
  const earliest=number(date.earliest ?? date.earliestYear), latest=number(date.latest ?? date.latestYear);
  const precision=String(date.precision || ''), hypothetical=kind==='hypothesis' || date.dateIsHistoricalFact===false || date.historicalFact===false;
  const observation=semanticKind==='snapshot' || record.recordRole==='endpoint_observation' || kind==='endpoint' || number(date.snapshotYear)!=null || typeof date.snapshotDate==='string' || record.dateStatus==='static-bookmark-observation' || /^(fixed-endpoint-observation|endpoint-observation|source-state-observation|as-of-bookmark)$/.test(precision);
  const upperBound=/(^by-year$|upper-bound|observed-by|terminus-ante-quem|reported-by-year)/.test(precision);
  let dateLabel,certaintyLabel,scopeLabel='',timeStatus;
  if(observation){
    dateLabel=year==null?'局势观察 · 发生时间待考':`${year}年局势 · 发生时间待考`;
    certaintyLabel=year===1444?'开局观察；过程待考':year===1820?'端点记载；过程待考':'局势观察；过程待考';scopeLabel='局势对照不表示变化发生于此年。';timeStatus='observation-not-occurrence';
  }else if(kind==='setup'){
    dateLabel=year==null?'开局局势':`${year}年开局局势`;certaintyLabel='开局状态记录';scopeLabel='开局归属不表示建国时间，也不证明此后从未变化。';timeStatus='setup-state';
  }else if(upperBound && (latest ?? exact ?? year)!=null){
    dateLabel=`最迟${latest ?? exact ?? year}年`;certaintyLabel='完成上界；发生确年待考';timeStatus='upper-bound';
  }else if(exact!=null && date.dateIsHistoricalFact!==false && date.historicalFact!==false){
    dateLabel=`${exact}年 · 记载年份`;certaintyLabel=hypothetical?'事件年份有据；范围推定':'资料记载';timeStatus='source-reported-year';
  }else if(precision==='editorial-era-stage' && date.eventDateWindowKnown===false){
    dateLabel=year==null?'代表阶段 · 具体年份待考':`约${year}年 · 代表阶段`;
    certaintyLabel='分期推定；选年非确年';timeStatus='editorial-era-stage';
  }else if(earliest!=null && latest!=null && earliest!==latest){
    dateLabel=`${earliest}—${latest}年之间${year!=null?` · 图示${year}年`:''}`;
    certaintyLabel=hypothetical?'分期推定；选年非确年':'期间记载；具体年份待考';timeStatus='bounded-window';
  }else if(hypothetical){
    dateLabel=(year ?? exact ?? earliest ?? latest)==null?'具体年份待考':`约${year ?? exact ?? earliest ?? latest}年 · 分期选年`;
    certaintyLabel='分期推定；选年非确年';timeStatus='editorial-year';
  }else if(number(record.endYear)!=null && year!=null && record.endYear!==year){
    dateLabel=`${year}—${record.endYear}年 · 期间记录`;certaintyLabel='资料记载；过程仍待考证';timeStatus='recorded-interval';
  }else if(earliest!=null && latest==null){
    dateLabel=`${earliest}年以后`;certaintyLabel='时间范围待定';timeStatus='lower-bound';
  }else{
    dateLabel=year==null?'具体年份待考':`${year}年相关记录`;certaintyLabel=kind==='attested'?'资料记载':'记载与解释；具体时间、范围仍需区分';timeStatus='record-index';
  }
  if(hypothetical && !observation && kind!=='setup')scopeLabel='疆域与地方控制范围为推定，不能由记载年份推得精确省界。';
  if(date.boundsAreProvinceTransferDates===false || date.boundsAreHistoricalTransferDates===false || date.notTreatyOrProvinceTransferDate===true)
    scopeLabel=strings([scopeLabel,'时间窗口不等于各地转属或条约的确切日期。']).join(' ');
  if(timeStatus==='editorial-era-stage')scopeLabel=strings([scopeLabel,'所示年份是代表阶段；显示年代范围不是建国或转属事件的发生界限。']).join(' ');
  const sourceWindow=date.sourceDateRange ?? date.sourceTemporalEnvelope;
  const sourceWindowLabel=sourceWindow?.earliest!=null && sourceWindow?.latest!=null && (sourceWindow.earliest!==earliest || sourceWindow.latest!==latest)
    ?`来源涉及${sourceWindow.earliest}—${sourceWindow.latest}年；图示分期另有取舍。`:'';
  return {dateLabel,certaintyLabel,scopeLabel,sourceWindowLabel,timeStatus,dateEvidence:date,dateFrom:step?'step':'record',historicalCertaintyUpgraded:false};
}

export function createPublicDisplay({copy={},steps=[]}={}) {
  const stepMap=new Map(steps.map(step=>[step.id,step]));
  const decodeText=value=>copy.textEncoding==='public-fields-pool-v1'&&Number.isInteger(value)?copy.textPool[value]:value;
  const decodeRow=row=>!row?null:{...row,...Object.fromEntries(['title','description','summary','scopeLabel','originalText'].filter(key=>key in row).map(key=>[key,decodeText(row[key])])),...(row.questions?{questions:row.questions.map(decodeText)}:{}),...(Number.isInteger(row.sourceIds)?{sourceIds:copy.sourceIdLists[row.sourceIds]}:{})};
  const tables={events:copy.eventsById||{},records:copy.recordsById||{},steps:copy.stepsById||{},history:copy.historyById||{},continuity:copy.continuityRecordsById||{}};
  const explicitStepLinks=copy.stepIdsByRecordId || {};
  const findCopy=(record,surface)=>{
    const table=tables[surface]||tables.records;
    if(record.id && Object.hasOwn(table,record.id))return {row:decodeRow(table[record.id]),matchBasis:`${surface}:exact-id`};
    for(const id of strings([record.originRecordId,record.originRecordIds||[]])){
      if(Object.hasOwn(tables.records,id))return {row:decodeRow(tables.records[id]),matchBasis:'explicit-origin-record'};
    }
    if(record.stepId && Object.hasOwn(tables.steps,record.stepId))return {row:decodeRow(tables.steps[record.stepId]),matchBasis:'explicit-step-id'};
    return {row:null,matchBasis:'unmatched-original-fallback'};
  };
  const resolveStep=(record,row,surface)=>{
    const direct=record.stepId ?? (stepMap.has(record.id)?record.id:null);
    const ids=strings([direct,row?.stepId,explicitStepLinks[record.id]||[],...strings([record.originRecordId,record.originRecordIds||[]]).map(id=>[id,explicitStepLinks[id]||[]])])
      .filter(id=>stepMap.has(id));
    const linkedSteps=ids.map(id=>stepMap.get(id));
    // A source assertion can be cited by a later map stage. That citation does
    // not move the assertion's own date to the later stage.
    const exactCopies=linkedSteps.filter(step=>record.year===step.year&&record.title===step.title&&record.description===step.description);
    const step=direct&&stepMap.has(direct)?stepMap.get(direct):exactCopies.length===1?exactCopies[0]:null;
    return {step,linkedSteps,ambiguous:!step&&ids.length>1};
  };
  return {
    record(record={}, {surface='records'}={}) {
      const {row,matchBasis}=findCopy(record,surface),{step,linkedSteps,ambiguous}=resolveStep(record,row,surface);
      const baseDate=dateDisplay(record,step,copy.dateSemanticsById?.[record.id]);
      const dateRule=copy.reviewedDatesById?.[record.id];
      const dateVariant=dateRule?.variants?.find(variant=>Object.entries(variant.expectedFields).every(([field,guard])=>Object.hasOwn(record,field)===guard.present&&(!guard.present||sameValue(record[field],guard.value))));
      const dateTextFields=['dateLabel','certaintyLabel','scopeLabel','sourceWindowLabel','timeStatus'];
      const reviewedDate=dateVariant?Object.fromEntries(dateTextFields.filter(key=>typeof dateRule.display?.[key]==='string').map(key=>[key,dateRule.display[key]])):{};
      const date={...baseDate,...reviewedDate,historicalCertaintyUpgraded:false};
      const title=row?.title ?? record.title ?? record.nameZh ?? record.name ?? '';
      const description=row?.description ?? record.description ?? '';
      const sourceIds=strings([record.sourceIds||[],record.sourceId,...linkedSteps.map(step=>[step.sourceIds||[],step.sourceId]),row?.sourceIds||[],...(dateVariant?[dateRule.sourceIds||[]]:[])]);
      const scopeLabel=strings([date.scopeLabel,row?.scopeLabel||'']).join(' ');
      const certaintyLabel=ambiguous?strings([date.certaintyLabel,'涉及多个阶段，详见各节点']).join('；'):date.certaintyLabel;
      return {...date,title,description,scopeLabel,certaintyLabel,sourceIds,stepId:step?.id??null,linkedStepAmbiguous:ambiguous,matchBasis,
        ariaLabel:strings([date.dateLabel,title,certaintyLabel,scopeLabel,date.sourceWindowLabel]).join('。'),
        original:{title:record.title??record.nameZh??record.name??'',description:record.description??'',geometryNote:record.geometryNote??record.geographyStatus??'',reasoning:record.reasoning??'',dateEvidence:record.dateEvidence??null},
        reviewedDateStatus:dateVariant?'exact-id-and-original-date-fields':dateRule?'input-mismatch-original-date':'not-applicable',
        editorialStatus:row?.editorialStatus??'unreviewed-fallback'};
    },
    country(country={}) {
      const row=decodeRow(copy.countriesByTag?.[country.tag]);
      return {summary:row?.summary??country.summary??'',questions:row?.questions??country.questions??[],scopeLabel:row?.scopeLabel??'',sourceIds:row?.sourceIds??[],original:{summary:country.summary??'',questions:country.questions??[]},matchBasis:row?'exact-country-tag':'unmatched-original-fallback'};
    },
    assessment(countryTag,layer='primary',assessment={}) {
      const row=decodeRow(copy.assessmentsByKey?.[assessmentKey(countryTag,layer)]);
      return {summary:row?.summary??assessment.summary??'',scopeLabel:row?.scopeLabel??'',sourceIds:strings([assessment.sourceIds||[],row?.sourceIds||[]]),original:{summary:assessment.summary??''},matchBasis:row?'exact-country-and-layer':'unmatched-original-fallback'};
    },
    notice(key,original='') {
      const text=String(original??''),entry=copy.noticesByKey?.[key],row=decodeRow(Number.isInteger(entry)?copy.noticeRows[entry]:entry);
      if(!row||row.originalText!==text)return {description:text,original:text,scopeLabel:'此处保留原说明，尚未匹配当前公众编辑条目。',sourceIds:[],matchBasis:row?'input-mismatch-original-fallback':'unmatched-original-fallback'};
      return {description:row.description,original:text,scopeLabel:row.scopeLabel||'',sourceIds:row.sourceIds||[],matchBasis:'exact-path-and-original'};
    }
  };
}
