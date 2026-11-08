const cases = document.querySelector('#cases');
const mode = document.querySelector('#mode');
const result = document.querySelector('#result');
const status = document.querySelector('#status');
const labels = { chat: '需求理解', voucher: '优惠券', recommendation: '产品推荐', comparison: '详情页对比', full_chain: '全链路' };
let evaluation;
function show() {
  const item = evaluation.case_results.find(entry => entry.case_id === cases.value);
  const run = item.modes[mode.value];
  result.replaceChildren();
  for (const [title, value] of [
    ['阶段通过率（' + run.runs + ' 轮）', Object.entries(labels).map(([key, name]) => name + ' ' + Math.round(run[key + '_pass_rate'] * 100) + '%').join('  ·  ')],
    ['判分差异', run.mismatches.join('\n') || '导出未记录差异'],
    ['预期结果', JSON.stringify(item.expected, null, 2)],
    ['历史实际输出摘要', JSON.stringify(run.sample_actual, null, 2)],
  ]) {
    const detail = document.createElement('details');
    detail.open = true;
    const summary = document.createElement('summary');
    summary.textContent = title;
    const body = document.createElement('pre');
    body.textContent = value;
    detail.append(summary, body);
    result.append(detail);
  }
}
(async () => {
  try {
    const response = await fetch('evaluation.json');
    if (!response.ok) throw new Error('missing evaluation');
    evaluation = await response.json();
    for (const item of evaluation.case_results) cases.add(new Option(item.case_id + ' · ' + item.case_name, item.case_id));
    cases.addEventListener('change', show);
    mode.addEventListener('change', show);
    show();
  } catch { status.textContent = '暂时无法加载历史评测文件。'; }
})();
