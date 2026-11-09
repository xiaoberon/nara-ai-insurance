const { chromium } = require(process.env.NARA_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.NARA_VERIFY_ORIGIN || 'https://nara-gemini-live.xiaoxh.chatgpt.site';
async function run(page, id, mode='hybrid') {
  await page.locator('.toolbar select').nth(0).selectOption(id);
  await page.locator('.toolbar select').nth(1).selectOption(mode);
  for(let i=0;i<3;i++){
    const pending = page.waitForResponse(r=>r.url().endsWith('/live/api/run'),{timeout:240000});
    await page.getByRole('button',{name:'运行一次四阶段'}).click();
    const response = await pending, data = await response.json();
    if(response.ok()) return data;
    console.log(id,response.status(),data.error);
    if(!['RUN_BUSY','GEMINI_TIMEOUT','GEMINI_UNAVAILABLE'].includes(data.error)) break;
    await page.waitForTimeout(6600);
  }
  throw new Error('Verification failed for '+id);
}
async function capture(page,name) {
  const details=page.locator('.stage-grid .technical-bundle').filter({
    has: page.getByText(name==='c01'?'打分明细':'查看逐项校验明细',{exact:true})
  });
  const keyStep=name==='c01'?details.locator('.trace-step').first():details.locator('.trace-step').filter({hasText:'规则预筛 CPN-RENEW-50'});
  await keyStep.evaluate(element=>element.setAttribute('data-capture-detail',''));
  await page.addStyleTag({content:`.stage-grid > article > pre{min-height:0!important;max-height:310px!important}
    .stage-grid .technical-bundle[open] > .trace-step:not([data-capture-detail]) > div:nth-of-type(2){display:none}`});
  await page.screenshot({path:'public/showcase-media/v9-'+name+'-workbench.png',fullPage:true});
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1040,height:960},deviceScaleFactor:2});
    await page.goto(origin+'/live/');
    await page.getByRole('heading',{name:'Nara AI 保险助手'}).waitFor();
    if(!process.env.NARA_SKIP_NORMAL){
    const pure=await run(page,'C01','rules_only');
    assert.equal(pure.modelCalls,0);
    const normal=await run(page,'C01');
    assert(normal.modelCalls>0);
    await page.locator('.stepper').getByRole('button',{name:'产品推荐'}).click();
    await page.getByText('通过资格检查的产品与得分').waitFor();
    if(process.env.NARA_CAPTURE){
      await page.getByText('打分明细',{exact:true}).click();
      await page.getByText(/超出 MYR/).first().waitFor();
      await capture(page,'c01');
    }
    await page.locator('.stepper').getByRole('button',{name:'产品比较'}).click();
    await page.getByText('P005 · 免赔额需人工核对').first().waitFor();
    await page.getByText(/同时写了 MYR 450 和 MYR 700/).first().waitFor();
    await page.waitForTimeout(6500);
    console.log('Rules=0, C01 calls='+normal.modelCalls+', P005 sources verified');
    }
    let blocked;
    if(process.env.NARA_CAPTURE_C11_RULES){
      await run(page,'C11','rules_only');
      const age=page.getByRole('spinbutton',{name:'车龄'});
      await age.fill('7');
      const pending=page.waitForResponse(r=>r.url().endsWith('/live/api/run'));
      await page.getByRole('button',{name:'确认答案并继续'}).click();
      const response=await pending;
      assert(response.ok());
      blocked=await response.json();
      assert.equal(blocked.modelCalls,0);
      console.log('C11 captured in Rules Only after confirming the stated 7-year vehicle age');
    }else{
      blocked=await run(page,'C11');
    }
    assert.equal(blocked.result.stages.coupon.output.decision,'reject');
    await page.locator('.stepper').getByRole('button',{name:'优惠券决策'}).click();
    await page.getByText('续保券已达到领取次数上限，本次没有其他符合条件的券。').waitFor();
    await page.locator('.technical-bundle > summary').click();
    if(process.env.NARA_CAPTURE){await capture(page,'c11');return;}
    await page.waitForTimeout(6500);
    const veteran=await run(page,'C16');
    assert.equal(veteran.result.stages.coupon.output.discount_value,65);
    await page.locator('.stepper').getByRole('button',{name:'优惠券决策'}).click();
    await page.getByText('你已符合额外优惠资格。券后价格已包含这项权益。').waitFor();
    await page.getByRole('button',{name:'查看额外优惠'}).click();
    await page.getByRole('button',{name:'还有可叠加的优惠吗？'}).click();
    assert.equal(await page.locator('.customer-view').getByText('资深用户续保额外减 MYR 15 · MYR 15').count(),1);
    await page.locator('.stepper').getByRole('button',{name:'产品推荐'}).click();
    const prices=veteran.result.stages.recommendation.output.recommended_products;
    const p008=prices.find(item=>item.product_id==='P008'); assert.equal(p008.original_premium-p008.premium_after_coupon,65); assert.equal(p008.applied_coupons.length,2);
    console.log('C11 calls='+blocked.modelCalls+', C16 combined=65');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});

