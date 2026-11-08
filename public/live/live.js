const byId = id => document.getElementById(id);
const button = document.querySelector('button');
const errors = { REGION_UNAVAILABLE: '当前地区无法运行 Gemini，可打开历史评测回放。', GEMINI_QUOTA: 'Gemini 调用已达配额，请查看历史评测回放。', GEMINI_TIMEOUT: '模型响应超时，请重试或查看历史评测回放。', RUN_BUSY: '当前有任务正在执行或仍在冷却，请稍后重试。' };
const labels = { chat:'01 需求理解', coupon:'02 优惠券', recommendation:'03 产品推荐', comparison:'04 详情页对比' };
let cases = [];
async function load() {
  try {
    const response = await fetch('api/cases');
    const data = await response.json();
    cases = data.cases;
    byId('model').textContent = '实时型号 · ' + data.model;
    for (const item of cases) byId('cases').add(new Option(item.id + ' · ' + item.name, item.id));
    showPrompt();
    button.disabled = false;
  } catch {
    byId('status').textContent = '当前未连接实时服务。历史评测回放仍可使用。';
  }
}
function showPrompt() { byId('prompt').textContent = cases.find(item => item.id === byId('cases').value)?.message ?? ''; }
byId('cases').addEventListener('change', showPrompt);
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  byId('results').replaceChildren();
  byId('status').textContent = '正在运行。实时模型可能需要几十秒。';
  try {
    const response = await fetch('api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({caseId:byId('cases').value,mode:byId('mode').value}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    byId('status').textContent = data.model ? 'Gemini · ' + data.model + ' · 成功调用 ' + data.modelCalls + ' 次' : 'Rules Only · 模型调用 0 次';
    for (const [stage, result] of Object.entries(data.result.stages)) {
      const section = document.createElement('details');
      const title = document.createElement('summary');
      const description = document.createElement('p');
      const body = document.createElement('pre');
      title.textContent = labels[stage];
      description.textContent = result.decision_summary.join(' · ');
      body.textContent = JSON.stringify({输出:result.output, 决策记录:result.trace}, null, 2);
      section.append(title, description, body);
      byId('results').append(section);
    }
  } catch (error) {
    byId('status').textContent = errors[error.message] ?? '实时 Gemini 暂不可用，可查看历史评测回放。';
  } finally { button.disabled = false; }
});
load();
