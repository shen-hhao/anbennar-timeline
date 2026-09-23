import {noticeKey} from './public-display.js';
import {displayRecordTitle} from './records.js';

// These are visible explanatory fields. IDs, dates, source text/body, source
// links, and political/identity data never enter this presentation overlay.
export function researchPublicPaths(country) {
  const paths=[],add=path=>{
    const value=path.reduce((row,key)=>row?.[key],country);
    if(typeof value==='string'&&value)paths.push(path);
  };
  for(const key of ['summary','placementBasis','activationAuditNote'])add(['origin',key]);
  if(!country.annotation?.researchNotes?.length)add(['annotation','note']);
  for(const key of ['note','flagNote'])add(['origin','endpointProjection',key]);
  for(const key of ['label','note'])add(['origin','canonAssessment',key]);
  add(['origin','mapStageReview','summary']);
  for(const root of [['origin','reconstructionAssessment'],['annotation','reconstruction']]){
    for(const key of ['summary','classification','reviewedScope'])add([...root,key]);
    const assessment=root.reduce((row,key)=>row?.[key],country);
    (assessment?.uncertainties||[]).forEach((_,i)=>add([...root,'uncertainties',i]));
  }
  for(const root of [['origin','researchNotes'],['annotation','researchNotes'],['researchNotes']]){
    const notes=root.reduce((row,key)=>row?.[key],country)||[];
    notes.forEach((_,i)=>{for(const key of ['title','description'])add([...root,i,key]);});
  }
  (country.reviews||[]).forEach((_,i)=>add(['reviews',i,'note']));
  (country.issues||[]).forEach((_,i)=>{for(const key of ['text','resolution'])add(['issues',i,key]);});
  return paths;
}

export function createResearchPublicIndex(original, publicView) {
  const view=structuredClone(original);
  for(const country of view.countries){
    country.publicOriginalFields=[];
    country.publicNoticeQualifications=[];country.publicNoticeSourceIds=[];
    for(const path of researchPublicPaths(country)){
      const parent=path.slice(0,-1).reduce((row,key)=>row[key],country),key=path.at(-1),raw=parent[key];
      const display=publicView.notice(noticeKey('research-index',country.id,...path),raw);
      if(display.scopeLabel)country.publicNoticeQualifications.push(display.scopeLabel);
      country.publicNoticeSourceIds.push(...display.sourceIds);
      if(display.matchBasis==='exact-path-and-original'&&display.description!==raw){
        country.publicOriginalFields.push({path,original:raw,display:display.description});
        parent[key]=display.description;
      }
    }
    country.publicNoticeQualifications=[...new Set(country.publicNoticeQualifications)];
    country.publicNoticeSourceIds=[...new Set(country.publicNoticeSourceIds)];
  }
  for(const record of Object.values(view.records)){
    const display=publicView.record(record,{surface:'records'});
    record.publicOriginal=display.original;
    record.title=display.matchBasis==='unmatched-original-fallback'?displayRecordTitle(record):display.title;record.description=display.description;
    record.publicMatchBasis=display.matchBasis;record.sourceIds=display.sourceIds;
    record.publicDateLabel=display.dateLabel;
    record.publicScopeLabel=[display.certaintyLabel,display.scopeLabel,display.sourceWindowLabel].filter(Boolean).join(' · ');
  }
  return view;
}

export function createResearchModelReviews(reviews,publicView){
  return reviews.map((review,i)=>{
    const display=publicView.notice(noticeKey('western-chronology.json','modelReviewNotes',i,'note'),review.note);
    return {...structuredClone(review),note:display.description,publicOriginal:review.note,publicScopeLabel:display.scopeLabel,sourceIds:[...new Set([...(review.sourceIds||[]),...display.sourceIds])]};
  });
}
