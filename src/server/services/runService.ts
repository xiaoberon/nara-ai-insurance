import { requiredFields, sampleAnswers, type Answers } from './clarification';
import type { DecisionMode, FullRunResult, RecommendedProduct, StageResult, TestCase, UserNeed } from '../../shared/types';
import { coupons, pdps, products, users } from '../data/catalog';
import { estimateMockUsage } from '../llm/LLMProvider';
import { llmProvider } from '../llm/provider';
import { runChat } from './chatService';
import { runCoupon } from './couponEngine';
import { runRecommendation } from './productMatcher';
import { runComparison } from './comparisonExtractor';


const emptyStage=<T>(name:string,error:string):StageResult<T>=>({input:null,output:null,decision_summary:[`${name} 未运行：${error}`],node_logs:[{node:name,status:'failed',summary:error,duration_ms:0}],trace:[{step_id:`${name}-blocked`,stage:name as 'coupon'|'recommendation'|'comparison',kind:'fallback',title:`${name} 被上游阻断`,description:'上游没有产生可用且经过校验的输出。',input:{error},logic:'upstream_invalid → do_not_run',output:{blocked:true},status:'failed',reason_code:error}],schema_valid:false,retry_count:0,fallback_status:'blocked',error});

export interface FullRunInput { case:TestCase; mode:DecisionMode; message?:string; profile_id?:string; selected_product_ids?:string[]; persist?:boolean; continuation?:{chat:StageResult<UserNeed>;need:UserNeed;source:"answers"|"example";values:Answers} }

export async function runFull(input:FullRunInput,llm=llmProvider):Promise<FullRunResult>{
  const started=Date.now();
  const usageBefore=llm.usageSnapshot?.();
  const runId=crypto.randomUUID();
  const profile=users.find((user)=>user.user_id===(input.profile_id??input.case.profile_id));
  if(!profile)throw new Error('PROFILE_NOT_FOUND');
  const message=input.message??input.case.message;
  const initial=input.continuation?.chat??await runChat(message,input.mode,llm,input.case.mock_fault);
  const chat=input.continuation?{...initial,output:input.continuation.need,decision_summary:['已确认补充资料',...initial.decision_summary]}:initial;
  const missing=chat.output?requiredFields(chat.output):[];
  const clarification=missing.length&&chat.output?{fields:missing,sample:sampleAnswers(chat.output,profile)}:undefined;
  const need=clarification?null:chat.output;
  const confirmedProfile=need?{...profile,vehicle_type:need.vehicle.type,vehicle_age_years:need.vehicle.age_years??profile.vehicle_age_years}:profile;
  const blocked=clarification?'AWAITING_CLARIFICATION':'UPSTREAM_BLOCKED';
  const coupon=need?await runCoupon(need,confirmedProfile,coupons,products,input.mode,llm):emptyStage<any>('coupon',blocked);
  const recommendation=need&&coupon.output?await runRecommendation(need,confirmedProfile,coupon.output,products,input.mode,llm):emptyStage<any>('recommendation',blocked);
  // Comparison intentionally consumes the recommendation output, rather than
  // a fixture-specific product list, so both sections always show the same set.
  const selected=recommendation.output?.recommended_products.map((item:RecommendedProduct)=>item.product_id)??[];
  const comparison=need?await runComparison(need,selected,products,pdps,0,input.mode,llm,recommendation.output?.recommended_products):emptyStage<any>('comparison',blocked);
  const usageAfter=llm.usageSnapshot?.();
  const measuredUsage=usageBefore&&usageAfter?{input_tokens:Math.max(0,usageAfter.input_tokens-usageBefore.input_tokens),output_tokens:Math.max(0,usageAfter.output_tokens-usageBefore.output_tokens),estimated_cost_usd:Math.max(0,usageAfter.estimated_cost_usd-usageBefore.estimated_cost_usd)}:null;
  const usage=input.mode==='rules_only'?{input_tokens:0,output_tokens:0,estimated_cost_usd:0}:measuredUsage??estimateMockUsage({message,profile}, {chat:chat.output,coupon:coupon.output,recommendation:recommendation.output,comparison:comparison.output});
  const stages={chat,coupon,recommendation,comparison};
  const result:FullRunResult={...(clarification?{clarification}:{}),...(input.continuation?{confirmed:{source:input.continuation.source,values:input.continuation.values}}:{}),audit:{run_id:runId,timestamp:new Date().toISOString(),mode:input.mode,model:input.mode==='rules_only'?'none':llm.name,model_config:`temperature=0; provider=${llm.name}`,total_duration_ms:Date.now()-started,...usage,schema_valid:Object.values(stages).every((stage)=>stage.schema_valid),retry_count:Object.values(stages).reduce((sum,stage)=>sum+stage.retry_count,0),manual_review:Object.values(stages).some((stage)=>stage.fallback_status==='manual_review')},stages};
  // The hosted portfolio demo intentionally keeps no visitor prompts or run
  // records. Local evaluation can still call this function with persist:false.
  return result;
}
