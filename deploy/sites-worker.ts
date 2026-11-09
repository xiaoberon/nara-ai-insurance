import { sampleAnswers, type Answers } from '../src/server/services/clarification';
import { confirmAnswers } from '../src/server/services/clarification';
import { readContinuation, signContinuation } from './continuation';
import { evaluationRequest, type BatchDatabase } from './evaluation-jobs';
import { pdps, products, users } from '../src/server/data/catalog';
import { testCases } from '../src/server/data/testCases';
import { GeminiLLMProvider } from '../src/server/llm/GeminiLLMProvider';
import { runFull } from '../src/server/services/runService';
import type { DecisionMode } from '../src/shared/types';

declare const NARA_WORKBENCH_HTML: string;
declare const NARA_PDP_HTML: string;
declare const NARA_EVALUATION_HISTORY:string;
declare const NARA_WORKBENCH_ASSETS: Record<string,string>;
interface Environment { DB: BatchDatabase; GEMINI_API_KEY?: string; GEMINI_MODEL?: string; NARA_ALLOWED_COUNTRIES?: string; NARA_BATCH_MAX_CALLS?:string; NARA_CONTINUATION_SECRET?:string; }
const cases = testCases;
const modes = new Set(['hybrid', 'rules_only', 'llm_only']);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const error = (code: string, status: number) => json({ error: code }, status);
const staticFile = (body: string, type: string) => new Response(body, { headers: { 'content-type': type + '; charset=utf-8' } });

export default {
  async fetch(request: Request & { cf?: { country?: string } }, env: Environment): Promise<Response> {
    const { pathname } = new URL(request.url);
    const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const country = request.cf?.country ?? request.headers.get('CF-IPCountry') ?? 'XX';
    if (pathname.startsWith('/live/api/evaluations')) {
      try { return await evaluationRequest(request,env,(env.NARA_ALLOWED_COUNTRIES??'').split(',').includes(country)); }
      catch { return error('BATCH_UNAVAILABLE',503); }
    }
    if (request.method === 'GET') {
      if (pathname === '/' || pathname === '/live') return Response.redirect(new URL('/live/', request.url));
      if ((pathname === '/live/' || pathname === '/live/evaluation/') ) return staticFile(NARA_WORKBENCH_HTML, 'text/html');
      if (pathname === '/replay/evaluation.json') return staticFile(NARA_EVALUATION_HISTORY,'application/json');
      if (pathname === '/pdp.html') return staticFile(NARA_PDP_HTML, 'text/html');
      const productMatch = /^\/api\/products\/([A-Za-z0-9-]+)\/pdp$/.exec(pathname);
      if (productMatch) {
        const product = products.find(item => item.product_id === productMatch[1]);
        const pdp = pdps.find(item => item.product_id === productMatch[1]);
        return product && pdp ? json({ product_name: product.product_name, html: pdp.html }) : error('NOT_FOUND', 404);
      }
      if (Object.hasOwn(NARA_WORKBENCH_ASSETS, pathname)) return staticFile(NARA_WORKBENCH_ASSETS[pathname], pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
      if (pathname === '/live/api/cases') return json({ model, region: country, cases: cases.map(({id, name, message}) => ({ id, name, message })) });
    }
    if (pathname !== '/live/api/run' || request.method !== 'POST') return error('NOT_FOUND', 404);
    if (request.headers.get('origin') !== new URL(request.url).origin ||
        !request.headers.get('content-type')?.startsWith('application/json')) return error('INVALID_CASE_OR_MODE', 400);
    const raw = await request.text();
    if (raw.length > 50000) return error('INVALID_CASE_OR_MODE', 400);
    let body: { caseId?: string; mode?: DecisionMode; token?:unknown; answers?:unknown; useExample?:boolean } | null;
    try { body = JSON.parse(raw); } catch { return error('INVALID_CASE_OR_MODE', 400); }
    const item = cases.find(entry => entry.id === body?.caseId);
    if (!item || !body?.mode || !modes.has(body.mode) || Object.keys(body).some(k=>!['caseId','mode','token','answers','useExample'].includes(k))) return error('INVALID_CASE_OR_MODE', 400);
    const mode = body.mode;
    const secret=env.NARA_CONTINUATION_SECRET;
    const input:Parameters<typeof runFull>[0]={case:item,mode};
    if(body.token!==undefined){
      const state=secret?await readContinuation(body.token,secret,item.id,mode):null;
      if(!state?.chat.output)return error('CONTINUATION_EXPIRED',400);
      const profile=users.find(user=>user.user_id===item.profile_id)!;
      const values=body.useExample===true?sampleAnswers(state.chat.output,profile):body.answers;
      const need=confirmAnswers(state.chat.output,values);
      if(!need)return error('INVALID_ANSWERS',400);
      input.continuation={chat:state.chat,need,source:body.useExample===true?'example':'answers',values:values as Answers};
    }else if(body.answers!==undefined||body.useExample!==undefined)return error('CONTINUATION_EXPIRED',400);
    async function respond(result:Awaited<ReturnType<typeof runFull>>,modelName:string|null,calls:number){
      const token=result.clarification&&secret?await signContinuation({caseId:item!.id,mode,chat:result.stages.chat},secret):null;
      return json({model:modelName,modelCalls:calls,result,token});
    }
    if(mode==='rules_only')return respond(await runFull(input),null,0);
    const countries = (env.NARA_ALLOWED_COUNTRIES ?? '').split(',');
    if (!countries.includes(country)) return error('REGION_UNAVAILABLE', 403);
    if (!env.GEMINI_API_KEY || !env.DB) return error('GEMINI_UNAVAILABLE', 503);
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const lease = crypto.randomUUID();
    let reserved;
    try {
      reserved = await env.DB.prepare(`INSERT INTO live_quota (id, day, runs, unlock_at, lease)
        VALUES (1, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET day=excluded.day, runs=CASE WHEN day=excluded.day THEN runs+1 ELSE 1 END,
        unlock_at=excluded.unlock_at, lease=excluded.lease
        WHERE unlock_at <= ? AND (day != excluded.day OR runs < 20) RETURNING runs`)
        .bind(day, now + 275000, lease, now).first();
    } catch { return error('GEMINI_UNAVAILABLE', 503); }
    if (!reserved) {
      const state = await env.DB.prepare('SELECT day, runs FROM live_quota WHERE id=1').first() as {day?: string; runs?: number} | null;
      return error(state?.day === day && (state.runs ?? 0) >= 20 ? 'GEMINI_QUOTA' : 'RUN_BUSY', 429);
    }
    let calls = 0;
    let upstream: unknown;
    const provider = new GeminiLLMProvider(env.GEMINI_API_KEY, model, 45000, 0, 4500, {
      beforeRequest() {},
      onSuccess() { calls++; },
      onFailure(failure) { upstream = failure; },
    });
    try {
      const result = await runFull(input,provider);
      if (upstream || (!calls&&!input.continuation)) throw upstream ?? new Error('GEMINI_EMPTY_RESPONSE');
      return respond(result,model,calls);
    } catch (failure) {
      const reason = String(upstream ?? failure);
      if (reason.includes('GEMINI_HTTP_429')) return error('GEMINI_QUOTA', 429);
      if (reason.includes('GEMINI_TIMEOUT')) return error('GEMINI_TIMEOUT', 504);
      return error('GEMINI_UNAVAILABLE', 502);
    } finally {
      await env.DB.prepare('UPDATE live_quota SET unlock_at=? WHERE id=1 AND lease=?')
        .bind(Date.now() + 5000, lease).run().catch(() => {});
    }
  },
};
