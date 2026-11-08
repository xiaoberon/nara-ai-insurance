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
  await page.addStyleTag({content:`
    .stage-grid>article:first-child,.stage-grid>.brain,.stage-grid>article:last-child,.customer-view{outline:3px solid #c32932;outline-offset:-3px;position:relative}
    .stage-grid>article:first-child::before,.stage-grid>.brain::before,.stage-grid>article:last-child::before,.customer-view::before{position:absolute;right:8px;top:8px;background:#b62029;color:white;padding:2px 9px;border-radius:6px;font-weight:bold;z-index:5}
    .stage-grid>article:first-child::before{content:'①'}.stage-grid>.brain::before{content:'②'}.stage-grid>article:last-child::before{content:'③'}.customer-view::before{content:'④'}
    .stage-grid pre{max-height:none!important}
  `});
  await page.screenshot({path:'public/showcase-media/'+name+'-workbench.png',fullPage:true});
  await page.locator('.overview').first().screenshot({path:'public/showcase-media/'+name+'-detail.png'});
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:960},deviceScaleFactor:2});
    await page.goto(origin+'/live/');
    await page.getByRole('heading',{name:'Nara AI 保险助手'}).waitFor();
    if(!process.env.NARA_SKIP_NORMAL){
    const pure=await run(page,'C01','rules_only');
    assert.equal(pure.modelCalls,0);
    const normal=await run(page,'C01');
    assert(normal.modelCalls>0);
    await page.locator('.stepper').getByRole('button',{name:'产品推荐'}).click();
    await page.getByText('通过资格检查的产品与得分').waitFor();
    if(process.env.NARA_CAPTURE)await capture(page,'c01');
    await page.locator('.stepper').getByRole('button',{name:'产品比较'}).click();
    await page.getByText('P005 · 免赔额需人工核对').waitFor();
    await page.getByText(/同时写了 MYR 450 和 MYR 700/).waitFor();
    await page.waitForTimeout(6500);
    console.log('Rules=0, C01 calls='+normal.modelCalls+', P005 sources verified');
    }
    const blocked=await run(page,'C11');
    assert.equal(blocked.result.stages.coupon.output.decision,'reject');
    await page.locator('.stepper').getByRole('button',{name:'优惠券决策'}).click();
    await page.getByText('续保券已达到领取次数上限，本次没有其他符合条件的券。').waitFor();
    await page.locator('.technical-bundle > summary').click();
    if(process.env.NARA_CAPTURE)await capture(page,'c11');
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
    assert.equal(prices[0].original_premium-prices[0].premium_after_coupon,65);
    console.log('C11 calls='+blocked.modelCalls+', C16 combined=65');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});

