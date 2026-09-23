// Candidate presentation sidecar. Never alters renderer relations, owners or border styles.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sameEdge = (a, b) => a?.subject === b?.subject && a?.overlord === b?.overlord && a?.type === b?.type;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const typeNames = {vassal:'附庸关系',puppet:'傀儡关系',personal_union:'共主关系',imperial_bodyguard:'帝国卫邦',tributary:'朝贡关系',tributary_state_anb:'朝贡关系',protectorate:'保护关系',chartered_company:'特许公司关系',dominion:'自治领关系',colony:'殖民属地关系',march:'卫戍关系'};

export function buildRelationSemantics(view, registry, endpointRelations = null) {
  if (registry?.schemaVersion !== 1) throw new Error('Unsupported relation semantic registry');
  const links = Object.fromEntries(Object.entries({...view.offmapRelations, ...view.relations}).map(([subject, r]) => [subject, {subject, overlord:r.overlord, type:r.type}]));
  const scope = new Set(registry.scopeTags), bySubject = {}, evidence = new Map();
  for (const p of Object.values(view.provinces)) for (const r of p.basis?.relationshipEvidence || []) {
    if (!r.subject || r.status === 'unknown') continue;
    const key = JSON.stringify([r.subject,r.overlord,r.type]);
    if (!evidence.has(key)) evidence.set(key, new Set());
    for (const id of [r.recordId,r.transitionRecordId]) if(id) evidence.get(key).add(id);
  }
  const endpoint = view.year === 1820;
  const rawEndpoints = Object.fromEntries((Array.isArray(endpointRelations) ? endpointRelations : Object.values(endpointRelations || {})).map(r => [r.subject,r]));
  for (const [subject, relation] of Object.entries({...view.offmapRelations, ...view.relations})) {
    if (!scope.has(subject)) continue;
    const raw = endpoint ? rawEndpoints[subject] : relation;
    const rawMatches = !!raw && sameEdge(raw, {...relation,subject});
    const present = rawMatches && own(raw, 'control'), meaningful = present && nonempty(raw.control);
    const evidenceStepIds = [...(evidence.get(JSON.stringify([subject,relation.overlord,relation.type])) || [])].sort();
    const annotations = endpoint ? [] : registry.annotations.filter(a => sameEdge(a, {...relation,subject}) && a.stepIds.some(id => evidenceStepIds.includes(id)));
    const sourceContext = endpoint ? registry.endpointContexts.filter(a => sameEdge(a, {...relation,subject})) : [];
    const status = annotations.length ? 'source-described-with-limits' : 'administration-unspecified';
    const administrativeText = annotations.length ? annotations.map(a=>a.publicText).join(' ') : endpoint ? !rawMatches ? '相符的端点原始关系资料尚缺；内政权限仍待考证。' : meaningful ? '端点记录显式标注管理类别；其具体权限与适用年代仍须对照史料。' : '端点原件未说明内政权限；不据此判断本年收权或放权。' : '此阶段的内政权限尚待考证；地图关系类别不代表已核定行政权限。';
    bySubject[subject] = {
      subject,overlord:relation.overlord,rawType:rawMatches?raw.type:null,renderedType:relation.type,
      rawInputAvailable:rawMatches,rawControlFieldPresent:present,rawControl:present?raw.control:null,
      renderedControl:relation.control??null,
      controlProvenance:endpoint ? !rawMatches?'endpoint-original-unavailable':meaningful?'endpoint-explicit-field':'endpoint-type-default' : meaningful?'adopted-relation-explicit':'adopted-relation-missing',
      administrativeStatus:status,administrativeText,
      historicalContextText:sourceContext.map(a=>a.publicText).join(' '),
      sourceEvidenceIds:annotations.map(a=>a.id),sourceContextIds:sourceContext.map(a=>a.id),
      evidenceStepIds,sourceRefs:[...annotations,...sourceContext].flatMap(a=>a.sourceRefs),
      relationTypeLabel:typeNames[relation.type]||relation.typeLabel||relation.type,
      // No claim either that a transition occurred or that none ever occurred.
      establishesAdministrativeTransition:false,comparisonBasis:endpoint&&!meaningful?'endpoint-administration-unspecified':'source-and-adopted-model-kept-separate'
    };
  }
  return {schemaVersion:1,year:view.year,bySubject,links};
}

export function relationSemanticChain(sidecar, subject) {
  const rows=[],seen=new Set();let cursor=subject;
  while (sidecar?.links[cursor]) {
    if (seen.has(cursor)) throw new Error('Relationship cycle in semantic sidecar: '+cursor);
    seen.add(cursor);
    if (sidecar.bySubject[cursor]) rows.push(sidecar.bySubject[cursor]);
    cursor=sidecar.links[cursor].overlord;
  }
  return rows;
}

export function relationSemanticsMarkup(sidecar, subject, kind = 'compact', nameForTag = tag=>tag) {
  const rows=relationSemanticChain(sidecar,subject);
  if(!rows.length)return '';
  const parts=rows.map((r,i)=>{
    const subjectName=escape(nameForTag(r.subject));
    const prefix=rows.length>1||r.subject!==subject?subjectName+'：':'';
    const text=prefix+escape(r.relationTypeLabel)+'；'+escape(r.administrativeText);
    const context=r.historicalContextText?'<br>'+escape(r.historicalContextText):'';
    return `<span data-relation-semantics="${escape(r.subject)}" data-administration-status="${escape(r.administrativeStatus)}">${text}${context}</span>`;
  });
  if(kind==='detail')return `<dt>行政说明</dt><dd class="relation-administration">${parts.join('<br>')}</dd>`;
  return `<small class="relation-administration">${parts.join('<br>')}</small>`;
}
