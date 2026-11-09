import { pdps, products, users } from './data/catalog';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { testCases } from './data/testCases';
import { GeminiLLMProvider } from './llm/GeminiLLMProvider';
import { runFull } from './services/runService';
import { readContinuation, signContinuation } from '../../deploy/continuation';
import { confirmAnswers, sampleAnswers, type Answers } from './services/clarification';
import type { DecisionMode } from '../shared/types';

dotenv.config();
const app = express();
const cases = testCases.filter(item => ['C01', 'C07', 'C11', 'C12', 'C16'].includes(item.id));
const modes = new Set(['hybrid', 'rules_only', 'llm_only']);
const key = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
const gatewaySecret = process.env.NARA_GATEWAY_SECRET;
const continuationSecret = process.env.NARA_CONTINUATION_SECRET ?? gatewaySecret ?? randomBytes(32).toString('hex');
const countries = new Set((process.env.NARA_ALLOWED_COUNTRIES ?? '').toUpperCase().split(',').map(code => code.trim()).filter(Boolean));
const hosted = process.env.NARA_PUBLIC === '1';
const maxAttempts = Number(process.env.NARA_DAILY_MODEL_CALLS ?? 120);

if (hosted && (!key || !gatewaySecret || gatewaySecret.length < 32 || !countries.size || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1)) {
  throw new Error('Public showcase requires a Gemini key, gateway secret, country allowlist and a positive daily request limit.');
}
let busy = false;
let count = 0;
let day = '';
let nextRun = 0;

app.disable('x-powered-by');
app.get('/live/api/cases', (_req, res) => {
  res.json({ model, cases: cases.map(({id, name, message}) => ({ id, name, message })) });
});
app.post('/live/api/run', express.json({ limit: '50kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body ?? {};
  const item = cases.find(entry => entry.id === body.caseId);
  if (!item || !modes.has(body.mode) || Object.keys(body).some(field => !['caseId', 'mode', 'token', 'answers', 'useExample'].includes(field))) {
    res.status(400).json({ error: 'INVALID_CASE_OR_MODE' });
    return;
  }
  const mode = body.mode as DecisionMode;
  const input: Parameters<typeof runFull>[0] = { case: item, mode };
  if (body.token !== undefined) {
    const state = await readContinuation(body.token, continuationSecret, item.id, mode);
    if (!state?.chat.output) { res.status(400).json({ error: 'CONTINUATION_EXPIRED' }); return; }
    const profile = users.find(user => user.user_id === item.profile_id)!;
    const values = body.useExample === true ? sampleAnswers(state.chat.output, profile) : body.answers;
    const need = confirmAnswers(state.chat.output, values);
    if (!need) { res.status(400).json({ error: 'INVALID_ANSWERS' }); return; }
    input.continuation = { chat: state.chat, need, values: values as Answers, source: body.useExample === true ? 'example' : 'answers' };
  } else if (body.answers !== undefined || body.useExample !== undefined) {
    res.status(400).json({ error: 'CONTINUATION_EXPIRED' }); return;
  }
  if (mode !== 'rules_only' && hosted) {
    const expected = Buffer.from(gatewaySecret ?? '');
    const received = Buffer.from(req.get('X-Nara-Gateway') ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected) ||
        !countries.has(req.get('X-Nara-Country') ?? '')) {
      res.status(403).json({ error: 'REGION_UNAVAILABLE' });
      return;
    }
  }
  if (mode !== 'rules_only' && !key) {
    res.status(503).json({ error: 'GEMINI_UNAVAILABLE' });
    return;
  }
  if (busy || (mode !== 'rules_only' && Date.now() < nextRun)) {
    res.status(429).json({ error: 'RUN_BUSY' });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; count = 0; }
  let upstreamError: unknown;
  let successfulCalls = 0;
  const provider = key && mode !== 'rules_only' ? new GeminiLLMProvider(key, model, 45000, 0, 4500, {
    beforeRequest() {
      if (count >= maxAttempts) throw new Error('NARA_DAILY_QUOTA');
      count++;
    },
    onSuccess() { successfulCalls++; },
    onFailure(error) { upstreamError = error; },
  }) : undefined;
  busy = true;
  try {
    const result = await runFull(input, provider);
    if (upstreamError || (provider && successfulCalls === 0 && !input.continuation)) {
      throw upstreamError ?? new Error('GEMINI_EMPTY_RESPONSE');
    }
    const token = result.clarification ? await signContinuation({ caseId: item.id, mode, chat: result.stages.chat }, continuationSecret) : null;
    res.json({ model: provider ? model : null, modelCalls: successfulCalls, result, token });
  } catch (error) {
    const detail = String(upstreamError ?? error);
    const quota = /NARA_DAILY_QUOTA|GEMINI_HTTP_429/.test(detail);
    const timeout = /GEMINI_TIMEOUT|ETIMEDOUT/.test(detail);
    res.status(quota ? 429 : timeout ? 504 : 502).json({
      error: quota ? 'GEMINI_QUOTA' : timeout ? 'GEMINI_TIMEOUT' : 'GEMINI_UNAVAILABLE',
    });
  } finally {
    if (provider) nextRun = Date.now() + 5000;
    busy = false;
  }
});
app.use('/live/api', (_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
app.get('/api/products/:productId/pdp', (req, res) => {
  const product = products.find(item => item.product_id === req.params.productId);
  const pdp = pdps.find(item => item.product_id === req.params.productId);
  if (!product || !pdp) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
  res.json({ product_name: product.product_name, html: pdp.html });
});
app.get('/health', (_req, res) => { res.json({ ok: true }); });
app.get('/', (_req, res) => { res.sendFile(resolve('dist/client/live/index.html')); });
app.use(express.static(resolve('dist/client')));
app.listen(Number(process.env.PORT ?? 3002), hosted ? '0.0.0.0' : '127.0.0.1');
