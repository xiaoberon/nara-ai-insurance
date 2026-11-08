import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('public/replay/evaluation.json', 'utf8'));
const ink = '#13283c', muted = '#486176', colors = ['#08796b','#456aab','#ab4e28'];
const text = (x,y,label,size=22,color=ink,weight=500) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${label}</text>`;
const box = (x,y,w,h,fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}"/>`;
function save(name, height, content) {
  writeFileSync('assets/'+name+'.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 ${height}" font-family="Microsoft YaHei,Noto Sans CJK SC,PingFang SC,sans-serif">${box(0,0,960,height,'#f0f5f9')}${content}</svg>\n`);
}
save('hero',300,box(0,0,960,300,ink)+text(48,59,'NARA / AI INSURANCE',20,'#80ddd0',700)+text(48,123,'让续保咨询变成可检查的决策',43,'white',700)+text(48,174,'车险续保 · 混合决策 PoC · Agent / Admin 产品演示',22,'#c8deee')+
  ['真实 Gemini 评测','75 次典型场景执行','AI Challenge 团队第一名'].map((item,i)=>box(48+i*289,215,264,49,'#23435d')+text(66+i*289,247,item,19,'white',650)).join(''));
save('opportunity',168, [['01 / 用户表达','怕水浸，也关心续保价格'],['02 / 平台决策','核对预算、车型、资格与条款'],['03 / 运营跟进','识别流程停滞，安排跟进']].map(([a,b],i)=>box(18+i*310,26,295,115,'#ffffff')+text(36+i*310,72,a,22,colors[0],700)+text(36+i*310,110,b,18)).join(''));
save('flow',163,[['01 需求理解','模型抽取 / 结构校验'],['02 优惠券','规则预筛 / 模型排序 / 复核'],['03 产品推荐','规则过滤 / 保障与价格排序'],['04 详情对比','模型抽取 / 证据与冲突校验']].map(([a,b],i)=>box(14+i*237,23,222,117,'#ffffff')+text(27+i*237,70,a,22,colors[0],700)+text(27+i*237,108,b,14)).join(''));
let graph = text(40,56,'五个典型案例的三模式通过率',31,ink,700)+text(40,90,'每种模式 25 次执行 · 同轮四阶段都通过才计为全链通过',18,muted);
['Hybrid','Rules Only','LLM Only'].forEach((name,i)=>{graph+=box(40+i*200,115,18,18,colors[i])+text(67+i*200,130,name,19,ink,650);});
for (const [i,[key,name]] of [['chat','需求理解'],['voucher','优惠券'],['recommendation','产品推荐'],['comparison','详情对比'],['full_chain','全链通过']].entries()) {
  const y=165+i*78;
  if(i===4) graph+=box(24,y-6,900,75,'#deeeec');
  graph+=text(40,y+33,name,20,ink,650);
  data.modes.forEach((row,j)=>{
    const p=Math.round(row[key+'_pass_rate']*100), y0=y+20*j;
    if(p) graph+=box(190,y0,p*6.2,15,colors[j]);
    graph+=text(200+p*6.2,y0+13,p+'%',15,ink,650);
  });
}
save('evaluation',568,graph);
