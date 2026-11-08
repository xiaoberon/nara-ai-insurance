const { chromium } = require(process.env.NARA_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const url = 'https://nara-gemini-live.xiaoxh.chatgpt.site/live/';
const replay = 'https://nara-ai-insurance-poc.xiaoxh.chatgpt.site/replay/';
async function run(page, mode, caseId, maxAttempts = 2) {
  await page.locator('.toolbar select').nth(0).selectOption(caseId);
  await page.locator('.toolbar select').nth(1).selectOption(mode);
  for (let attempt=0; attempt<maxAttempts; attempt++) {
    const pending=page.waitForResponse(r=>r.url().endsWith('/live/api/run'),{timeout:230000});
    await page.getByRole('button',{name:'运行一次四阶段'}).click();
    assert(await page.locator('.toolbar select').first().isDisabled());
    const response=await pending, data=await response.json();
    if(response.ok()) return data;
    console.log(caseId, response.status(), data.error);
    await page.getByRole('alert').getByRole('link',{name:'打开历史评测'}).waitFor();
    if(!['RUN_BUSY','GEMINI_TIMEOUT','GEMINI_UNAVAILABLE'].includes(data.error)) break;
    await page.waitForTimeout(6500);
  }
  throw new Error('Live verification failed for '+caseId);
}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1680,height:980},deviceScaleFactor:2});
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  if(process.env.NARA_CHECK_REPLAY){
    const requests=[];
    page.on('request',r=>requests.push(r.url()));
    await page.goto(replay);
    await page.getByRole('heading',{name:'三模式历史评测'}).waitFor();
    await page.getByText('历史评测结果 · 75次').waitFor();
    await page.locator('.case-evidence summary').filter({hasText:'C07'}).click();
    await page.getByText('发券结论：预期 reject，实际 grant').first().waitFor();
    assert(!(await page.getByRole('button',{name:/运行.*评估/}).count()));
    assert(!requests.some(r=>r.includes('/live/api/')||r.includes('generativelanguage')));
    await page.getByRole('button',{name:'数据库与字段'}).click();
    await page.getByRole('button',{name:'三模式评估'}).click();
    await page.getByText('历史评测结果 · 75次').waitFor();
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Mobile replay overflows');
    console.log('Replay: original panel, C07 expanded, no model requests, mobile viewport');
    return;
  }
  await page.goto(url);
  await page.getByRole('heading',{name:'Nara AI 保险助手'}).waitFor();
  assert(await page.locator('textarea').getAttribute('readonly')!==null);
  assert.equal(await page.locator('.toolbar select').first().locator('option').count(),5);
  const rule=await run(page,'rules_only','C01');
  assert.equal(rule.modelCalls,0);
  await page.getByText('本次未调用模型').waitFor();
  for(const [id,stage,tab,key] of [['C01','recommendation','产品推荐','c01'],['C11','coupon','优惠券决策','c11']]){
    const data=await run(page,'hybrid',id);
    assert(data.model&&data.modelCalls>0&&Object.keys(data.result.stages).length===4);
    if(id==='C11') assert(data.result.stages.coupon.output?.decision==='reject','C11 did not reject');
    await page.getByText(/本次调用 Gemini \d+ 次/).waitFor();
    await page.locator('.stepper').getByRole('button',{name:new RegExp(tab)}).click();
    await page.screenshot({path:'public/showcase-media/'+key+'-workbench.png',animations:'disabled'});
    await page.locator('.overview').first().screenshot({path:'public/showcase-media/'+key+'-detail.png'});
    console.log(id, data.modelCalls, stage, JSON.stringify(id==='C11'?data.result.stages.coupon.output:data.result.stages.recommendation.output?.recommended_products?.[0]).slice(0,900));
    await page.waitForTimeout(6000);
  }
  await page.getByRole('button',{name:'重置',exact:true}).click();
  assert.equal(await page.locator('.trace-list').count(),0);
  assert(!pageErrors.length, pageErrors.join('; '));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1;});
