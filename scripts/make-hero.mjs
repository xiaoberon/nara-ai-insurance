import { writeFileSync } from 'node:fs';
const cards = [
  {fill:'#142b40',tag:'#24465e',accent:'#9fe1d5',heading:'PoC / 可行性验证',title:'验证 AI 如何接入保险购买流程',subtitle:'Proof of Concept · 三种决策跑法对照',tags:['AI 与规则的决策边界','75 次典型场景对照','逐阶段展示输入、判断与结果']},
  {fill:'#773a21',tag:'#935033',accent:'#ffdab9',heading:'FILM / 参赛视频',title:'用 AI 与关键帧制作参赛视频',subtitle:'Agent / Admin 双端交互与产品叙事',tags:['Figma × Codex 交互动效','关键帧理解与人工审核','录制、剪辑、配音']},
];
function card(item,x,y) {
 return `<g transform="translate(${x},${y})">
 <rect width="478" height="241" rx="17" fill="${item.fill}"/>
 <text x="24" y="35" fill="${item.accent}" font-size="16" font-weight="700">${item.heading}</text>
 <text x="24" y="77" font-size="25" font-weight="700">${item.title}</text>
 <text x="24" y="110" font-size="16">${item.subtitle}</text>
 ${item.tags.map((tag,i)=>`<rect x="24" y="${126+i*34}" width="430" height="27" rx="7" fill="${item.tag}"/><text x="37" y="${145+i*34}" font-size="15">${tag}</text>`).join('')}
 </g>`;
}
for(const mobile of [false,true]) {
 const layout=mobile?{w:478,h:494}:{w:972,h:241};
 writeFileSync('assets/hero'+(mobile?'-mobile':'')+'.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.w} ${layout.h}" fill="#fff" font-family="Microsoft YaHei,Noto Sans CJK SC,PingFang SC,sans-serif">${card(cards[0],0,0)}${card(cards[1],mobile?0:494,mobile?253:0)}</svg>\n`);
}

