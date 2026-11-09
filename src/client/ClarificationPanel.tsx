import { useState } from 'react';
import type { FullRunResult } from '../shared/types';

const names:Record<string,string>={intent:'续保意图',vehicle_type:'车型',vehicle_age:'车龄',budget:'预算上限'};
const show=(field:string,value:string|number|null)=>field==='intent'?'确认续保':field==='vehicle_age'?value+' 年':field==='budget'?value===null?'本次不设预算':'MYR '+value:String(value);
export function ClarificationPanel({detail,busy,onConfirm}:{detail:NonNullable<FullRunResult['clarification']>;busy:boolean;onConfirm:(answers?:Record<string,string|number|null>)=>void}){
 const [answers,setAnswers]=useState<Record<string,string|number|null>>({});
 const [example,setExample]=useState(false);
 return <section className="customer-view"><h2>需要确认后才能继续</h2>
 <p>待补充：{detail.fields.map(field=>names[field]).join('、')}。优惠券、推荐和对比尚未执行。</p>
 <form onSubmit={event=>{event.preventDefault();onConfirm(answers)}}>
 {detail.fields.map(field=><label key={field}>{names[field]}{' '}
 {field==='vehicle_age'||field==='budget'?<input aria-label={names[field]} required type="number" min={field==='vehicle_age'?0:1} max={field==='vehicle_age'?80:1000000} onChange={event=>setAnswers({...answers,[field]:event.target.valueAsNumber})}/>:<select aria-label={names[field]} required defaultValue="" onChange={event=>setAnswers({...answers,[field]:event.target.value})}><option value="">请选择</option>{(field==='intent'?['renew_car_insurance']:['Sedan','SUV','Hatchback','MPV']).map(value=><option key={value} value={value}>{show(field,value)}</option>)}</select>}</label>)}
 <button className="primary" disabled={busy}>确认答案并继续</button>
 </form>
 <button type="button" disabled={busy} onClick={()=>setExample(!example)}>使用示例资料继续</button>
 {example&&<div><p>将补用以下虚构资料：</p><ul>{Object.entries(detail.sample).map(([field,value])=><li key={field}>{names[field]}：{show(field,value)}</li>)}</ul><button className="primary" disabled={busy} onClick={()=>onConfirm()}>确认使用示例资料</button></div>}
 </section>
}
