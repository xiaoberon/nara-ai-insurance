import { testCases } from '../src/server/data/testCases';
import { GeminiLLMProvider } from '../src/server/llm/GeminiLLMProvider';
import { runFull } from '../src/server/services/runService';
import type { DecisionMode } from '../src/shared/types';
import html from '../public/live/index.html';
import js from '../public/live/live.js';
import css from '../public/showcase.css';

interface Statement { bind(...values: (string|number)[]): Statement; first(): Promise<unknown>; run(): Promise<unknown> }
interface Environment { DB: { prepare(sql: string): Statement }; GEMINI_API_KEY?: string; GEMINI_MODEL?: string; NARA_ALLOWED_COUNTRIES?: string; }
const cases = testCases.filter(item => ['C01', 'C07', 'C11', 'C12', 'C16'].includes(item.id));
const modes = new Set(['hybrid', 'rules_only', 'llm_only']);
const publicReplay = 'https://nara-ai-insurance-poc.xiaoxh.chatgpt.site/replay/';
const page = html.replace('../replay/', publicReplay).replace('../showcase.css', '/showcase.css');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const error = (code: string, status: number) => json({ error: code }, status);
const staticFile = (body: string, type: string) => new Response(body, { headers: { 'content-type': type + '; charset=utf-8' } });

export default {
  async fetch(request: Request & { cf?: { country?: string } }, env: Environment): Promise<Response> {
    const { pathname } = new URL(request.url);
    const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const country = request.cf?.country ?? request.headers.get('CF-IPCountry') ?? 'XX';
    if (request.method === 'GET') {
      if (pathname === '/' || pathname === '/live') return Response.redirect(new URL('/live/', request.url));
      if (pathname === '/live/') return staticFile(page, 'text/html');
      if (pathname === '/showcase.css') return staticFile(css, 'text/css');
      if (pathname === '/live/live.js') return staticFile(js, 'application/javascript');
      if (pathname === '/live/api/cases') return json({ model, region: country, cases: cases.map(({id, name, message}) => ({ id, name, message })) });
    }
    if (pathname !== '/live/api/run' || request.method !== 'POST') return error('NOT_FOUND', 404);
    if (request.headers.get('origin') !== new URL(request.url).origin ||
        !request.headers.get('content-type')?.startsWith('application/json')) return error('INVALID_CASE_OR_MODE', 400);
    const raw = await request.text();
    if (raw.length > 1024) return error('INVALID_CASE_OR_MODE', 400);
    let body: { caseId?: string; mode?: DecisionMode } | null;
    try { body = JSON.parse(raw); } catch { return error('INVALID_CASE_OR_MODE', 400); }
    const item = cases.find(entry => entry.id === body?.caseId);
    if (!item || !body?.mode || !modes.has(body.mode) || Object.keys(body).length !== 2) return error('INVALID_CASE_OR_MODE', 400);
    const mode = body.mode;
    if (mode === 'rules_only') return json({ model: null, modelCalls: 0, result: await runFull({ case: item, mode }) });
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
      const result = await runFull({ case: item, mode }, provider);
      if (upstream || !calls) throw upstream ?? new Error('GEMINI_EMPTY_RESPONSE');
      return json({ model, modelCalls: calls, result });
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
