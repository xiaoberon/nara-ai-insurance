const { chromium } = require(process.env.NARA_PLAYWRIGHT || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const root = 'https://nara-ai-insurance-poc.xiaoxh.chatgpt.site';
    await page.goto(root + '/replay/');
    await page.locator('#cases option').first().waitFor({ state: 'attached' });
    await page.selectOption('#cases', 'C07');
    await page.getByText('预期 reject，实际 grant', { exact: false }).first().waitFor();
    console.log('Anonymous replay: C07 available');
    await page.goto(root + '/film/');
    const video = page.locator('video');
    await video.evaluate(media => { media.muted = true; return media.play(); });
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25);
    console.log('Anonymous video playback:', await video.evaluate(media => media.duration), 'seconds');
    const live = process.env.NARA_LIVE_URL;
    if (!live) return;
    await page.goto(live);
    await page.locator('form button:enabled').waitFor();
    await page.selectOption('#mode','rules_only');
    await page.click('button');
    await page.getByText('Rules Only · 模型调用 0 次').waitFor();
    console.log('Anonymous Rules Only: 0 calls');
    await page.selectOption('#mode','hybrid');
    const result = await Promise.all([page.waitForResponse(r => r.url().endsWith('/live/api/run'), {timeout:240000}), page.click('button')]);
    const data = await result[0].json();
    console.log('Anonymous Hybrid:', result[0].status(), data.error ?? { model:data.model, modelCalls:data.modelCalls, stages:Object.keys(data.result?.stages ?? {}) });
    if (!result[0].ok()) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
