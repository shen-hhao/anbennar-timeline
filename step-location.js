// Camera targets only. This must never supply territorial or overlay changes.
export function stepLocationProvinceIds(step, changedProvinceIds = []) {
  const usable = ids => [...new Set((Array.isArray(ids) ? ids : [])
    .filter(id => Number.isInteger(id) && id > 0))];
  const changed = usable(changedProvinceIds);
  if (changed.length) return changed;
  return usable((Array.isArray(step?.updates) ? step.updates : [])
    .flatMap(update => Array.isArray(update?.provinceIds) ? update.provinceIds : []));
}
