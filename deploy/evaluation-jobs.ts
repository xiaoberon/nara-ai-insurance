import { GeminiLLMProvider } from '../src/server/llm/GeminiLLMProvider';
import { runFull } from '../src/server/services/runService';
import { compareModes, getEvaluationCases, evaluationModes, evaluationPolicy } from '../src/server/services/evaluationService';
import type { FullRunResult } from '../src/shared/types';

interface Statement {
  bind(...values: Array<string|number|null>): Statement;
  first<T=unknown>(): Promise<T|null>;
  run(): Promise<unknown>;
  all<T>(): Promise<{results:T[]}>;
}
export interface BatchDatabase { prepare(sql:string):Statement; batch(statements:Statement[]):Promise<unknown> }
interface Job {
  id:string; scope:'typical'|'all'; policy:string; total:number; completed:number; calls:number;
  state:'running'|'completed'|'failed'; model:string; available_at:number; reason:string|null;
}
interface Environment { DB:BatchDatabase; GEMINI_API_KEY?:string; GEMINI_MODEL?:string; NARA_BATCH_MAX_CALLS?:string }
const version = evaluationPolicy;
const reserve = 5; // Two chat attempts plus one each for voucher, recommendation and comparison.
const reply = (value:unknown,status=200) => Response.json(value,{status,headers:{'cache-control':'no-store'}});
const status = (job:Job) => ({id:job.id,scope:job.scope,total:job.total,completed:job.completed,state:job.state,reason:job.reason,availableAt:job.available_at,model:job.model});
const find = (db:BatchDatabase,id:string) => db.prepare('SELECT * FROM evaluation_jobs WHERE id=?').bind(id).first<Job>();

export async function evaluationRequest(request:Request,env:Environment,allowed:boolean):Promise<Response>{
  const url=new URL(request.url);
  const db=env.DB;
  const cap=Number(env.NARA_BATCH_MAX_CALLS);
  if(!db) return reply({error:'BATCH_UNAVAILABLE'},503);
  if(request.method==='POST'){
    if(!allowed)return reply({error:'REGION_UNAVAILABLE'},403);
    if(request.headers.get('origin')!==url.origin)return reply({error:'INVALID_REQUEST'},403);
    if(!env.GEMINI_API_KEY||!Number.isInteger(cap)||cap<reserve)return reply({error:'BATCH_UNAVAILABLE'},503);
  }
  if(url.pathname==='/live/api/evaluations'&&request.method==='GET'){
    const scope=url.searchParams.get('scope');
    if(scope==='typical'||scope==='all'){
      const latest=await db.prepare("SELECT * FROM evaluation_jobs WHERE scope=? AND state='completed' AND policy=? ORDER BY created_at DESC LIMIT 1").bind(scope,version).first<Job>();
      return reply(latest?status(latest):null);
    }
    const active=await db.prepare("SELECT * FROM evaluation_jobs WHERE state='running' AND created_at>? ORDER BY created_at DESC LIMIT 1").bind(Date.now()-86400000).first<Job>();
    return reply(active?status(active):null);
  }
  if(url.pathname==='/live/api/evaluations'&&request.method==='POST'){
    const body=await request.json().catch(()=>null);
    if(body?.scope!=='typical')return reply({error:'INVALID_SCOPE'},400);
    const scope=body.scope as Job['scope'];
    const now=Date.now(), day=version+":"+new Date(now).toISOString().slice(0,10);
    await db.prepare("UPDATE evaluation_jobs SET state='failed',reason='BATCH_EXPIRED' WHERE state='running' AND created_at<=? AND available_at<=?")
      .bind(now-86400000,now).run();
    const row=await db.prepare("INSERT INTO evaluation_jobs (id, admission_day, scope, total, model, created_at, policy) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM evaluation_jobs WHERE state='running') ON CONFLICT(admission_day) DO NOTHING RETURNING *")
      .bind(crypto.randomUUID(),day,scope,getEvaluationCases(scope).length*evaluationModes.length*5,env.GEMINI_MODEL||'gemini-3.5-flash-lite',now,version).first<Job>();
    if(!row)return reply({error:'DAILY_BATCH_LIMIT'},429);
    return reply(status(row),202);
  }
  const match=/^\/live\/api\/evaluations\/([0-9a-f-]{36})(?:\/(advance|result))?$/.exec(url.pathname);
  if(!match)return reply({error:'NOT_FOUND'},404);
  const [,id,action]=match;
  const job=await find(db,id);
  if(!job)return reply({error:'NOT_FOUND'},404);
  if(request.method==='GET'&&!action)return reply(status(job));
  if(request.method==='GET'&&action==='result'&&job.state==='completed'){
    const {results}=await db.prepare('SELECT result FROM evaluation_rounds WHERE job_id=? ORDER BY ordinal').bind(id).all<{result:string}>();
    if(results.length!==job.total)return reply({error:'BATCH_UNAVAILABLE'},503);
    let index=0;
    const result=await compareModes(5,job.scope,'C01',async()=>JSON.parse(results[index++].result) as FullRunResult,'gemini:'+job.model,job.policy!==version);
    return reply({...result,evaluation_version:job.policy,generated_at:new Date(job.available_at).toISOString()});
  }
  if(request.method!=='POST'||action!=='advance')return reply({error:'NOT_FOUND'},404);
  if(job.policy!==version||job.state!=='running'||job.available_at>Date.now())return reply(status(job));
  const cases=getEvaluationCases(job.scope);
  const mode=evaluationModes[Math.floor(job.completed/(cases.length*5))];
  const testCase=cases[Math.floor(job.completed/5)%cases.length];
  const maximum=mode==='rules_only'?0:reserve;
  const lease=crypto.randomUUID();
  const now=Date.now();
  const locked=await db.prepare('UPDATE evaluation_jobs SET lease=?,available_at=?,calls=calls+? WHERE id=? AND state=? AND completed=? AND available_at<=? AND calls+?<=? RETURNING *')
    .bind(lease,now+270000,maximum,id,'running',job.completed,now,maximum,cap).first<Job>();
  if(!locked){
    await db.prepare("UPDATE evaluation_jobs SET state='failed',reason='CALL_BUDGET' WHERE id=? AND state='running' AND completed=? AND available_at<=? AND calls+?>?")
      .bind(id,job.completed,now,maximum,cap).run();
    return reply(status((await find(db,id))!));
  }
  let calls=0;
  let upstream:unknown;
  try{
    const provider=mode==='rules_only'?undefined:new GeminiLLMProvider(env.GEMINI_API_KEY!,job.model,45000,0,5000,{
      beforeRequest(){ if(calls>=maximum)throw new Error('CALL_BUDGET');calls++; },
      onSuccess(){},
      onFailure(error){upstream=error},
    });
    const result=await runFull({case:testCase,mode,persist:false},provider);
    if(upstream)throw upstream;
    const compact={clarification:result.clarification,audit:result.audit,stages:Object.fromEntries(Object.entries(result.stages).map(([key,stage])=>[key,{output:stage.output,schema_valid:stage.schema_valid,error:stage.error}]))};
    await db.batch([
      db.prepare('INSERT INTO evaluation_rounds (job_id,ordinal,result) SELECT id,completed,? FROM evaluation_jobs WHERE id=? AND lease=?')
        .bind(JSON.stringify(compact),id,lease),
      db.prepare("UPDATE evaluation_jobs SET completed=completed+1,state=CASE WHEN completed+1=total THEN 'completed' ELSE 'running' END,lease=NULL,available_at=?,calls=calls-?,reason=NULL WHERE id=? AND lease=?")
        .bind(Date.now()+(mode==='rules_only'?0:5000),maximum-calls,id,lease),
    ]);
  }catch(error){
    const detail=String(upstream??error);
    const quota=detail.includes('GEMINI_HTTP_429');
    const fatal=/GEMINI_HTTP_(400|401|403|404)/.test(detail);
    await db.prepare("UPDATE evaluation_jobs SET lease=NULL,state=?,available_at=?,calls=calls-?,reason=? WHERE id=? AND lease=?")
      .bind(fatal?'failed':'running',Date.now()+(quota?65000:20000),maximum-calls,fatal?'GEMINI_CONFIGURATION':quota?'GEMINI_QUOTA':'GEMINI_RETRY',id,lease).run();
  }
  return reply(status((await find(db,id))!));
}
