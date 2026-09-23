// Navigation is independent of events and political replay.
export function validateBookmarks(bundle,events) {
  const rows=bundle?.bookmarks,ids=new Set(),eventIds=new Set(events.map(e=>e.id));
  if(!Array.isArray(rows)||rows.length<6||rows.length>8)throw new Error('精选时点数量应为6至8个');
  for(const row of rows){
    if(!row.bookmarkId||ids.has(row.bookmarkId)||!Number.isInteger(row.year)||row.year<1444||row.year>1820)throw new Error('精选时点标识或年份无效');
    if(!row.relatedEventIds?.length||row.relatedEventIds.some(id=>!eventIds.has(id)))throw new Error('精选时点关联记录缺失');
    ids.add(row.bookmarkId);
  }
  if(rows[0].year!==1444||rows.at(-1).year!==1820||rows.some((r,i)=>i&&r.year<=rows[i-1].year))throw new Error('精选时点须按年排列并包含首尾');
  return rows;
}
export function adjacentBookmark(bookmarks,year,direction) {
  return direction<0?[...bookmarks].reverse().find(b=>b.year<year):bookmarks.find(b=>b.year>year);
}
export function renderBookmarks(bookmarks,year,escape) {
  return bookmarks.map(b=>`<button type="button" data-bookmark="${escape(b.bookmarkId)}" ${b.year===year?'aria-current="date"':''} title="${escape(b.description)}"><strong>${b.year}</strong><span>${escape(b.label)}</span></button>`).join('');
}
