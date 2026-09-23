// Candidate display policy only. No source endpoint or chronology is mutated.
// The caller supplies the actual renderer's groupCountries implementation.
export function applyEndpointReview(view, registry, options = {}) {
  if (!registry) return view;
  if (view.year !== 1820 || registry.schemaVersion !== 1 || registry.observedYear !== 1820)
    throw new Error('Endpoint review registry/year mismatch');
  if (!Array.isArray(registry.entries) || new Set(registry.entries.map(r => r.provinceId)).size !== registry.entries.length)
    throw new Error('Duplicate or missing endpoint review entries');
  if (view.endpointReviewSummary) throw new Error('Apply endpoint review to the original endpoint view only');
  const comparison = options.comparisonMode === true;
  const provinces = {...view.provinces};
  let withheld = 0, continued = 0;
  for (const entry of registry.entries) {
    const original = provinces[entry.provinceId];
    if (!original || original.originalEndpointOwner !== entry.expectedRawOwner)
      throw new Error(`Endpoint review source drift: ${entry.provinceId}`);
    if (original.owner !== null && original.owner !== entry.expectedProjectedOwner)
      throw new Error(`Endpoint review display drift: ${entry.provinceId}`);
    const canContinue=entry.displayPolicy==='qualified-prior-stage-continuation'&&!comparison&&options.evidence==='reconstructed';
    const isolate = ['withhold-conflicted-projection','qualified-prior-stage-continuation'].includes(entry.displayPolicy) && !comparison&&!canContinue;
    if(canContinue)continued++;
    if (isolate && original.owner) withheld++;
    const review = {
      decisionId: entry.decisionId, category: entry.category, status: entry.status,
      displayPolicy: entry.displayPolicy, comparisonActive: comparison,
      publicText: entry.publicText, historicalEventDate: null,
      comparisonBefore: entry.comparisonBefore, comparisonAfter: entry.comparisonAfter,
      sourceRefs: entry.sourceRefs, nativeAndPredecessor: entry.nativeAndPredecessor,
    };
    provinces[entry.provinceId] = canContinue ? {
      ...original, owner:entry.continuityDisplay.owner,controller:null,coverage:true,ownerStatus:'scenario',coverageStatus:'qualified_prior_stage_continuation',
      sourceConflict:false,endpointReview:review,
      politicalQualification:{id:entry.decisionId,fromYear:1820,throughYear:1820,visibleText:entry.publicText,secondaryColor:null,historicalSovereigntyConfirmed:false},
      basis:{...entry.continuityDisplay.basis,certainty:'hypothesis',endpointContinuity:true,referenceYear:1819,notes:entry.publicText},
      priorStageDisplay:entry.continuityDisplay,
    } : isolate ? {
      ...original, owner: null, controller: null, coverage: false,
      ownerStatus: 'endpoint_mapping_conflict', coverageStatus: 'endpoint_mapping_conflict',
      endpointReview: review,
      // Retain originalSourceConflict, originalEndpointOwner, endpointInference,
      // projection, basis and settlementState as trace, not active sovereignty.
    } : {...original, endpointReview: review};
  }
  if (!comparison && typeof options.regroup !== 'function')
    throw new Error('The actual renderer groupCountries function is required');
  const actors = {...(options.evidence==='reconstructed'&&!comparison?registry.continuityActors||{}:{}), ...(options.actors || {}), ...(view.offmapActors || {}), ...view.countries};
  const countries = comparison ? view.countries : options.regroup(provinces, actors);
  // buildEndpointView has already filtered relations by mapped actors. Feed its
  // unfiltered sourceRelations here to retain originally off-map chains too.
  // The raw array remains separate from the renderer's display control default.
  const sourceRelations = options.sourceRelations == null ? null
    : structuredClone(Array.isArray(options.sourceRelations) ? options.sourceRelations : Object.values(options.sourceRelations));
  const sourceDisplay = {};
  for (const row of sourceRelations || []) {
    if (!row.subject || !row.overlord || sourceDisplay[row.subject]) throw new Error('Invalid or duplicate source diplomatic subject');
    sourceDisplay[row.subject] = {...row, control: row.control || (row.type === 'tributary' ? 'tributary'
      : ['protectorate', 'dominion', 'chartered_company', 'colony'].includes(row.type) ? 'autonomous' : 'direct')};
  }
  const priorRelations=options.evidence==='reconstructed'&&!comparison?Object.fromEntries((registry.continuityRelations||[]).map(r=>[r.subject,{...r,displayContinuity:true}])):{};
  const allRelations = {...priorRelations,...sourceDisplay, ...(view.offmapRelations || {}), ...view.relations};
  const relations = {}, offmapRelations = {};
  for (const [subject, relation] of Object.entries(allRelations))
    (countries[subject] && countries[relation.overlord] ? relations : offmapRelations)[subject] = relation;
  const offmapActors = {...(view.offmapActors || {})};
  for (const [tag, actor] of Object.entries(actors)) if (!countries[tag]) offmapActors[tag] = actor;
  const priorUnmapped = new Map((view.projectionSummary?.unmappedCountries || []).map(c => [c.tag, c]));
  for (const [tag, actor] of Object.entries(view.countries)) if (!countries[tag]) priorUnmapped.set(tag, {
    tag, name: actor.name, nameZh: actor.nameZh,
    reason: '该国仍见于原始1820资料；现有对应省形涉及位置或来源冲突，暂不指定显示疆域。',
  });
  return {...view, provinces, countries, relations, offmapRelations, offmapActors,
    signature: `${view.signature}:review:${registry.id}:${comparison ? 'comparison' : 'default'}`,
    stats: {...view.stats, countries: Object.keys(countries).length,
      politicalProvinces: Object.values(countries).reduce((n, c) => n + c.provinceIds.length, 0)},
    projectionSummary: {...view.projectionSummary, mappedCountries: Object.keys(countries).length,
      unmappedCountries: [...priorUnmapped.values()]},
    ...(sourceRelations ? {sourceRelations} : {}),
    endpointReviewSummary: {id: registry.id, reviewedEntries: registry.entries.length,
      conflictedEntries: registry.entries.filter(r => ['withhold-conflicted-projection','qualified-prior-stage-continuation'].includes(r.displayPolicy)).length,
      currentlyWithheldProvinces: withheld, qualifiedContinuationProvinces:continued, comparisonActive: comparison,
      originalSourceCountriesPreserved: true,
      relationScope: sourceRelations ? 'complete-source-plus-existing-view' : 'existing-view-only',
      rawSourceRelationCount: sourceRelations?.length ?? null},
    coverage: {...view.coverage, description: view.coverage.description + (comparison
      ? ' 当前为原始投影对照；其中标明冲突的对应关系未经采用。'
      : (continued?' 位置待核但已有前阶段归属的省份以彩色条纹延续1819方案；这不是1820主权确证。':' 当前位置待核或当前资料模式未采用推定归属。')+' 原始州归属与投影候选保留在逐省对照中。')},
  };
}

export function endpointReviewEntry(registry, provinceId, year) {
  if (![1819, 1820].includes(Number(year))) return null;
  return registry?.entries?.find(r => r.provinceId === Number(provinceId)) || null;
}
