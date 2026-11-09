import { useEffect, useState } from 'react';

type Scope='typical'|'all';
type Job={id:string; scope:Scope; total:number; completed:number; state:'running'|'completed'|'failed'; availableAt:number; reason:string|null};
const key='nara-evaluation-job';
const path='/live/api/evaluations';
const messages:Record<string,string>={
  REGION_UNAVAILABLE:'当前地区未开放 Gemini 批量评测。',
  DAILY_BATCH_LIMIT:'今天的公开批次已有人发起。请查看历史评测，或在下一个 UTC 自然日重试。',
  BATCH_UNAVAILABLE:'批量服务暂不可用，历史评测仍可查看。',
  CALL_BUDGET:'达到本批次的模型调用上限，已完成的进度已保存。',
  GEMINI_QUOTA:'Gemini 暂时限流。稍后会继续尝试，请保留此页。',
  POLICY_UPDATED:'本批使用旧策略，已停止推进。',
  BATCH_EXPIRED:'任务已超过续跑时限，已完成的进度已保存。',
  GEMINI_CONFIGURATION:'模型服务配置暂不可用，已完成的进度已保存。',
  GEMINI_RETRY:'模型响应暂时失败。稍后会继续尝试。',
};
async function request<T>(url:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(url,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw new Error(messages[value.error]??'请求失败，请稍后再试。');
  return value;
}
export function BatchEvaluation({onResult}:{onResult:(result:any)=>void}){
  const [id,setId]=useState(()=>localStorage.getItem(key)??'');
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState('');
  const [starting,setStarting]=useState(false);
  const [paused,setPaused]=useState(false);
  const [checking,setChecking]=useState(Boolean(id));
  const [shared,setShared]=useState<Job|null>(null);
  const [latest,setLatest]=useState<Job[]>([]);
  useEffect(()=>{
    let active=true;
    request<Job|null>(path).then(value=>{if(active)setShared(value)}).catch(()=>{});
    request<Job|null>(path+'?scope=typical')
      .then(value=>{if(active&&value)setLatest([value])}).catch(()=>{});
    return ()=>{active=false};
  },[]);
  function select(current:Job){
    localStorage.setItem(key,current.id);setJob(current);setError('');setPaused(false);setId(current.id);onResult(null);
  }
  useEffect(()=>{
    if(!id||paused)return;
    let cancelled=false, timer:ReturnType<typeof setTimeout>|undefined;
    async function update(initial:boolean){
      try{
        const current=await request<Job>(path+'/'+id+(initial?'':'/advance'),initial?'GET':'POST');
        if(cancelled)return;
        setChecking(false);setJob(current);setError('');
        if(current.state==='completed'){
          const result=await request(path+'/'+id+'/result');
          if(!cancelled){onResult(result);setLatest(items=>[...items.filter(item=>item.scope!==current.scope),current]);}
        }else if(current.state==='running'){
          timer=setTimeout(()=>void update(false),Math.min(15000,Math.max(300,current.availableAt-Date.now())));
        }
      }catch(failure){
        if(!cancelled){setChecking(false);setError(failure instanceof Error?failure.message:'评测暂时无法继续。');setPaused(true);}
      }
    }
    void update(true);
    return ()=>{cancelled=true;if(timer)clearTimeout(timer)};
  },[id,paused,onResult]);
  async function start(){
    setStarting(true);setError('');
    try{
      const current=await request<Job>(path,'POST',{scope:'typical'});
      select(current);
    }catch(failure){setError(failure instanceof Error?failure.message:'无法发起评测。')}
    finally{setStarting(false)}
  }
  const busy=starting||checking||job?.state==='running';
  return <section className="toolbar">
    <div><h2>重新运行三模式评测</h2>
      <p>5 个典型案例 × 3 种模式 × 5 轮。运行时可继续查看下方历史结果。</p>
      <p>请保持此页打开推进任务。关闭或刷新后，已完成的进度保存在服务器，返回后可继续公开批次。</p>
      <button className="primary" disabled={busy} onClick={()=>void start()}>重新运行 75 次</button>{' '}
      {shared&&shared.id!==id&&!busy&&<button onClick={()=>select(shared)}>继续当前公开批次</button>}{latest.map(item=><button key={item.id} disabled={busy||item.id===id} onClick={()=>select(item)}>查看最新完成的 {item.total} 次评测</button>)}
      {job&&<p role="status">已完成 {job.completed}／{job.total} · {job.state==='completed'?'完成':job.state==='failed'?'已停止':'进行中'}{job.reason?' · '+(messages[job.reason]??'稍后重试'):''}</p>}
      {error&&<p role="alert">{error}</p>}
      {paused&&id&&<button onClick={()=>{setPaused(false);setChecking(true)}}>重新连接本次评测</button>}
    </div>
  </section>;
}
