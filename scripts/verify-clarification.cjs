const {chromium}=require(process.env.NARA_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
const origin='https://nara-gemini-live.xiaoxh.chatgpt.site';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:960},deviceScaleFactor:2});
  await page.goto(origin+'/live/');
  const modes=page.locator('.toolbar select');
  await modes.nth(0).selectOption('C07');
  await modes.nth(1).selectOption('rules_only');
  await page.getByRole('button',{name:'运行一次四阶段'}).click();
  await page.getByRole('heading',{name:'需要确认后才能继续'}).waitFor();
  await page.locator('.stepper').getByRole('button',{name:'产品推荐'}).click();
  assert(await page.getByText('等待补充 · 本阶段未执行',{exact:true}).isVisible());
  assert.equal(await page.locator('.product-card').count(),0);
  await page.locator('.stepper').getByRole('button',{name:/需求理解/}).click();
  await page.getByRole('button',{name:'使用示例资料继续'}).click();
  await page.getByText('将补用以下虚构资料：').waitFor();
  await page.getByRole('button',{name:'确认使用示例资料'}).click();
  await page.getByText(/已使用虚构示例资料/).waitFor();
  await page.locator('.stepper').getByRole('button',{name:'产品推荐'}).click();
  assert(await page.locator('.product-card').count()>0);
  assert(await page.getByText('缺少预算',{exact:true}).first().isVisible());
  const call=async(body)=>{
    const response=await page.request.post(origin+'/live/api/run',{headers:{origin},data:body});
    return {status:response.status(),body:await response.json()};
  };
  const initial=await call({caseId:'C12',mode:'rules_only'});
  assert.equal(initial.status,200);
  assert.deepEqual(initial.body.result.clarification.fields,['vehicle_age']);
  const mismatch=await call({caseId:'C07',mode:'rules_only',token:initial.body.token,answers:{vehicle_age:3}});
  assert.equal(mismatch.status,400);
  const resumed=await call({caseId:'C12',mode:'rules_only',token:initial.body.token,answers:{vehicle_age:3}});
  assert.equal(resumed.status,200);
  assert.equal(resumed.body.result.confirmed.source,'answers');
  const result=resumed.body.result;
  assert.equal(result.stages.comparison.output.requires_manual_review,true);
  const p005=result.stages.comparison.output.products.find(product=>product.product_id==='P005');
  assert(p005.conflicts.some(conflict=>conflict.startsWith('deductible')));
  for(const recommendation of result.stages.recommendation.output.recommended_products){
    const compared=result.stages.comparison.output.products.find(product=>product.product_id===recommendation.product_id);
    assert.equal(compared.premium_after_coupon,recommendation.premium_after_coupon);
    assert.deepEqual(compared.applied_coupons,recommendation.applied_coupons);
  }
  await page.getByRole('button',{name:'数据库与字段'}).click();
  await page.getByRole('heading',{name:'专属券资格 · 虚构画像对照'}).waitFor();
  await page.goto(origin+'/live/evaluation/');
  await page.getByRole('heading',{name:'旧版基线 · 75次'}).waitFor();
  assert(await page.getByRole('button',{name:'重新运行 75 次'}).isVisible());
  assert.equal(await page.getByRole('button',{name:/运行 300 次/}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  console.log('Public C07 pause + explicit continuation, database, historical 75, and mobile verified');
 } finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
