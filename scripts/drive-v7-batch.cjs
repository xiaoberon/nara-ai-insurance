const {chromium}=require(process.env.NARA_PLAYWRIGHT||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto('https://nara-gemini-live.xiaoxh.chatgpt.site/live/evaluation/');
  await page.getByRole('heading',{name:'旧版基线 · 75次'}).waitFor({timeout:30000});
  const resume=page.getByRole('button',{name:'继续当前公开批次'});
  if(await resume.isVisible())await resume.click();
  else{
   const submitted=page.waitForResponse(r=>r.url().endsWith('/live/api/evaluations')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'重新运行 75 次'}).click();
   const response=await submitted;
   const job=await response.json();
   if(!response.ok())throw Error(JSON.stringify(job));
   console.log('Batch started',job.id);
   fs.writeFileSync(process.env.NARA_JOB_FILE,JSON.stringify(job));
  }
  let previous='';
  while(true){
   const status=await page.getByRole('status').filter({hasText:'已完成'}).first().textContent({timeout:30000});
   if(status!==previous){console.log(status);previous=status}
   if(status.includes('已停止'))throw Error(status);
   if(status.includes('75／75')&&status.includes('完成')){
    const report=await page.evaluate(async()=>{const id=localStorage.getItem('nara-evaluation-job');const r=await fetch('/live/api/evaluations/'+id+'/result');if(!r.ok)throw Error('Report HTTP '+r.status);return r.json()});
    assert.equal(report.execution_count,75);
    assert.equal(report.evaluation_version,'v7-clarification-product-pricing');
    assert.equal(report.real_llm_result_valid,true);
    assert.equal(report.case_results.length,5);
    fs.writeFileSync(process.env.NARA_REPORT_FILE,JSON.stringify(report,null,2));
    console.log('Saved verified report:',JSON.stringify(report.modes.map(mode=>({mode:mode.mode,scenarios:mode.full_chain_pass_rate,correct_pauses:mode.expected_pauses}))));
    return;
   }
   await new Promise(resolve=>setTimeout(resolve,6000));
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
