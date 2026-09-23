const $ = id => document.getElementById(id);
const pageSize = 20;
let index;
let page = 0;

function text(value) {
  return value == null ? '' : String(value);
}

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = text(value);
  if (className) node.className = className;
  return node;
}

function count(value) {
  if (value == null) return '—';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number.toLocaleString('zh-CN') : '—';
}

function externalUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function regionLabel(region) {
  return text(index.regionLabels?.[region] || region);
}

function appendMeta(container, value) {
  if (value) container.append(element('span', value));
}

function renderSummary() {
  const summary = index.summary || {};
  const values = [
    [summary.localFiles, '本地文件', `${count(summary.localUniqueFiles)} 份内容去重 · ${count(summary.localExtraCopies)} 个重复副本`],
    [summary.localTextFiles, '本地已提取文本', `${count(summary.localHistoricalUnique)} 份历史相关去重材料`],
    [summary.onlineCaptured, '补充来源已留存', `含 ${count(summary.localModSnapshots || 0)} 份 MOD 副本、${count(summary.onlineSearchExcerpts || 0)} 条检索摘录；另有 ${count(summary.onlineDiscoveryOnly)} 条入口`],
    [summary.publishedResearchRecords, '已选择入库的文献记录', `${count(summary.publishedByKind?.attested)} 条来源记载 · ${count(summary.publishedByKind?.hypothesis)} 条推测候选 · ${count(summary.publishedByKind?.context || 0)} 条背景；另有 ${count(summary.publishedUndatedNotes || 0)} 条未定年说明`],
  ];
  $('reference-summary').replaceChildren(...values.map(([value, label, detail]) => {
    const item = element('div');
    item.append(element('strong', count(value)), element('span', label), element('small', detail));
    return item;
  }));
  $('reference-counting').textContent = `目录共 ${count(index.entries.length)} 条，本地部分展示历史相关的去重材料。本地材料按标题初步分区，待正文审核。文件数、内容去重数和来源入口数分别统计；同一材料可能涉及多个地区，地区筛选结果不能相加作为材料总数。`;
  if(summary.reviewedInferenceSteps)$('reference-counting').textContent+=` 另有 ${summary.reviewedInferenceSteps} 项地图推演已审查；相关来源标为“已用于显式推演”，不因此提高其史实等级。`;
}

function populateFilters() {
  const regions = [...new Set(index.entries.flatMap(entry => Array.isArray(entry.regions) ? entry.regions : []))];
  regions.sort((a, b) => regionLabel(a).localeCompare(regionLabel(b), 'zh-CN'));
  for (const region of regions) {
    const option = element('option', regionLabel(region));
    option.value = text(region);
    $('reference-region').append(option);
  }
  const statuses = [...new Set(index.entries.map(entry => text(entry.captureStatus)).filter(Boolean))];
  statuses.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  for (const status of statuses) {
    const option = element('option', status);
    option.value = status;
    $('reference-status').append(option);
  }
}

function renderEntry(entry) {
  const article = element('article', null, 'reference-item');
  const header = element('div', null, 'reference-item-header');
  header.append(element('h3', entry.title || '未命名材料'), element('span', entry.reviewStatus || '待核对', 'status'));
  const meta = element('div', null, 'reference-meta');
  appendMeta(meta, entry.origin === 'local' ? '社群提供原件' : entry.origin === 'mod' ? '本地 MOD 原件' : '网上材料');
  appendMeta(meta, entry.kind);
  appendMeta(meta, (entry.regions || []).map(regionLabel).join(' / ') || '地区待归类');
  appendMeta(meta, entry.captureStatus);
  appendMeta(meta, entry.textStatus);
  if (entry.author) appendMeta(meta, `作者：${text(entry.author)}`);
  if (entry.publicationDate) appendMeta(meta, `发表：${text(entry.publicationDate)}`);
  if (entry.revisionId) appendMeta(meta, `固定修订：${text(entry.revisionId)}${entry.revisionTimestamp ? ` · ${text(entry.revisionTimestamp)}` : ''}`);
  article.append(header, meta);
  if (entry.note) article.append(element('p', entry.note, 'reference-description'));
  if (entry.localPath) {
    const location = element('p', '本地位置：', 'reference-location');
    location.append(element('code', entry.localPath));
    article.append(location);
  }
  const url = externalUrl(entry.url);
  if (url) {
    const link = element('a', '打开原始来源 ↗', 'reference-source-link');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    article.append(link);
  }
  if (entry.sourceFamily || entry.copies || entry.captures?.length > 1) {
    const details = element('details', null, 'reference-details');
    details.append(element('summary', '来源与副本说明'));
    if (entry.sourceFamily) details.append(element('p', `来源族：${text(entry.sourceFamily)}。同族材料需追踪引用关系，不直接当作独立佐证。`));
    if (Array.isArray(entry.copies) && entry.copies.length) {
      const list = element('ul', null, 'reference-copy-list');
      for (const copy of entry.copies) {
        const value = typeof copy === 'string' ? copy : copy?.path || copy?.localPath || copy?.title;
        if (value) list.append(element('li', value));
      }
      if (list.childElementCount) details.append(list);
    } else if (typeof entry.copies === 'number' && entry.copies > 0) {
      details.append(element('p', `相关副本：${count(entry.copies)}。副本不增加独立证据数量。`));
    }
    if (Array.isArray(entry.captures) && entry.captures.length > 1) {
      details.append(element('p', `此来源保留 ${count(entry.captures.length)} 份抓取或提取副本；同一网址的摘录与全文分别保存。`));
      const list = element('ul', null, 'reference-copy-list');
      for (const capture of entry.captures) {
        if (capture.localPath) list.append(element('li', `${capture.revisionId ? `修订 ${text(capture.revisionId)} · ` : ''}${text(capture.localPath)}`));
      }
      details.append(list);
    }
    article.append(details);
  }
  return article;
}

function renderResults() {
  const query = $('reference-search').value.trim().toLocaleLowerCase();
  const region = $('reference-region').value;
  const origin = $('reference-origin').value;
  const status = $('reference-status').value;
  const matches = index.entries.filter(entry => {
    const title = [entry.title, entry.localPath, entry.id,
      ...(entry.captures || []).flatMap(capture => [capture.title, capture.localPath, capture.id]),
      ...(Array.isArray(entry.copies) ? entry.copies.map(copy => typeof copy === 'string' ? copy : copy?.path || copy?.localPath) : [])
    ].map(text).join(' ').toLocaleLowerCase();
    return (!query || title.includes(query))
      && (region === 'all' || (entry.regions || []).includes(region))
      && (origin === 'all' || entry.origin === origin)
      && (status === 'all' || entry.captureStatus === status);
  });
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.max(0, Math.min(page, pages - 1));
  $('reference-count').textContent = `${count(matches.length)} 条匹配 / ${count(index.entries.length)} 条目录`;
  const entries = matches.slice(page * pageSize, (page + 1) * pageSize);
  $('reference-results').replaceChildren(...(entries.length ? entries.map(renderEntry) : [element('p', '没有符合条件的材料。可以缩短关键词或清除筛选。', 'empty')]));
  $('reference-previous').disabled = page === 0;
  $('reference-next').disabled = page + 1 >= pages;
  $('reference-page').textContent = `${page + 1} / ${pages} · 每页 ${pageSize} 条`;
}

function renderPolicy() {
  const policy = index.policy;
  const values = typeof policy === 'string' ? [policy] : Array.isArray(policy) ? policy : Object.values(policy || {});
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) $('reference-policy').append(element('p', value));
  }
  if (index.updatedAt) $('reference-updated').textContent = `目录更新：${text(index.updatedAt)}`;
}

$('reference-filters').addEventListener('submit', event => event.preventDefault());
$('reference-search').addEventListener('input', () => { page = 0; renderResults(); });
for (const id of ['reference-region', 'reference-origin', 'reference-status']) {
  $(id).addEventListener('change', () => { page = 0; renderResults(); });
}
$('reference-filters').addEventListener('reset', () => {
  requestAnimationFrame(() => { page = 0; renderResults(); });
});
$('reference-previous').addEventListener('click', () => { page -= 1; renderResults(); });
$('reference-next').addEventListener('click', () => { page += 1; renderResults(); });

try {
  const response = await fetch(new URL('./data/reference-index.json', import.meta.url));
  if (!response.ok) throw new Error(`Reference index request failed: ${response.status}`);
  index = await response.json();
  if (!Array.isArray(index.entries)) throw new Error('Reference index entries are missing');
  renderSummary();
  populateFilters();
  renderPolicy();
  renderResults();
  $('reference-loading').hidden = true;
  $('reference-view').hidden = false;
} catch (error) {
  $('reference-loading').textContent = '参考材料目录未能加载，请确认数据文件完整后刷新。';
  console.error(error);
}
