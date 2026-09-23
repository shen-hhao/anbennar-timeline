import { resolveColor } from './model.js';

export function changesAtYear(history, year) {
  return (history?.changes || []).filter(c => year >= c.earliestYear && year <= c.observedByYear);
}
export function changePhase(change, year) {
  return year === change.observedByYear ? 'endpoint' : 'interval';
}
export function changeColor(change, history, year, mode) {
  if (changePhase(change, year) === 'interval' || change.conflict) return [163,116,47];
  return resolveColor(change.directActor, history.actors, history.relations, mode);
}
export function changeLabel(change, history, year) {
  if (changePhase(change, year) === 'interval') return '归属变化的发生区间 · 确切年份待考';
  if (change.conflict) return '1820 开局文件存在归属冲突';
  return `1820：${history.actors[change.directActor].nameZh}`;
}

export function shouldHighlightChange(change, year, evidence) {
  return change.highlightYear === year
    && Array.isArray(change.changedProvinceIds) && change.changedProvinceIds.length > 0
    && !change.conflict
    && (evidence !== 'confirmed' || change.geometryCertainty === 'confirmed');
}
