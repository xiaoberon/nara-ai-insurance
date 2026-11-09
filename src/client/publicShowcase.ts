import type { DecisionMode, FullRunResult } from '../shared/types';

export const liveUrl = 'https://nara-gemini-live.xiaoxh.chatgpt.site/live/';
export const replayUrl = 'https://nara-ai-insurance-poc.xiaoxh.chatgpt.site/replay/';
export const surface = location.pathname.startsWith('/live/') ? 'live'
  : location.pathname.startsWith('/replay/') || location.hostname === new URL(replayUrl).hostname ? 'replay' : 'local';
const errors: Record<string, string> = {
  REGION_UNAVAILABLE: '当前地区暂未开放 Gemini，可体验纯规则或查看历史评测。',
  GEMINI_QUOTA: '今天的模型额度已用完，可体验纯规则或查看历史评测。',
  GEMINI_TIMEOUT: 'Gemini 响应超时。可以重试，或查看历史评测。',
  CONTINUATION_EXPIRED:'补充资料的凭证已过期，请重新运行当前案例。',
  INVALID_ANSWERS:'请检查并补齐需要确认的资料。',
  RUN_BUSY: '已有演示正在运行或处于短暂冷却，请稍后重试。',
  GEMINI_UNAVAILABLE: 'Gemini 暂时无法连接。可以重试，或查看历史评测。',
};
export async function runPublic(caseId: string, mode: DecisionMode, continuation?:{token:string;answers?:Record<string,string|number|null>;useExample?:boolean}): Promise<{model: string | null; modelCalls: number; result: FullRunResult;token?:string|null}> {
  const response = await fetch('/live/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({caseId, mode,...continuation}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(errors[data.error] ?? '暂时无法运行，请重试或查看历史评测。');
  return data;
}
export async function getReplay(size:75|300=75) {
  const response = await fetch(size===75?'/replay/evaluation.json':'/replay/evaluation-300.json');
  if (!response.ok) throw new Error('历史评测暂时无法载入，请刷新重试。');
  return response.json();
}
