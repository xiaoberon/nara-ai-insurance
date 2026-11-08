import type { Coupon, CouponDecision, DecisionMode, DecisionTraceStep, InsuranceProduct, StageResult, UserNeed, UserProfile } from '../../shared/types';
import type { LLMProvider } from '../llm/LLMProvider';
import { couponDecisionSchema } from '../schemas';

type Check={rule:string;label:string;actual:unknown;expected:unknown;pass:boolean;code:string};
type Evaluation={coupon:Coupon;checks:Check[];eligible:boolean;firstFailure:string|null};

function rejected(reasonCodes:string[],rejectedCoupons:CouponDecision['rejected_coupon_ids'],fallback:CouponDecision['fallback_status']='none'):CouponDecision{
  return {decision:fallback==='manual_review'?'review':'reject',selected_coupon_id:null,discount_value:0,currency:'MYR',eligible_product_ids:[],reason_codes:reasonCodes,rejected_coupon_ids:rejectedCoupons,fallback_status:fallback};
}

function evaluateCoupon(coupon:Coupon,profile:UserProfile,products:InsuranceProduct[],now:Date):Evaluation{
  const productScope=coupon.eligible_product_ids.some((id)=>products.some((p)=>p.product_id===id&&p.active&&p.annual_premium>=coupon.minimum_premium&&p.coupon_ids.includes(coupon.coupon_id)));
  const checks:Check[]=[
    {rule:'market',label:'市场',actual:profile.market,expected:coupon.eligible_markets,pass:coupon.eligible_markets.includes(profile.market),code:'MARKET_NOT_ELIGIBLE'},
    {rule:'segment',label:'用户分群',actual:profile.segment,expected:coupon.eligible_segments,pass:coupon.eligible_segments.includes(profile.segment),code:'SEGMENT_NOT_ELIGIBLE'},
    {rule:'renewal_window_days',label:'续保时间窗口',actual:profile.renewal_due_days,expected:'不超过30天',pass:profile.renewal_due_days<=30,code:'RENEWAL_WINDOW_NOT_ELIGIBLE'},
    {rule:'campaign_status',label:'活动状态与有效期',actual:`${coupon.status} · ${coupon.valid_from} 至 ${coupon.valid_to}`,expected:'活动有效',pass:coupon.status==='active'&&now>=new Date(coupon.valid_from+'T00:00:00Z')&&now<=new Date(coupon.valid_to+'T23:59:59Z'),code:'COUPON_NOT_ACTIVE'},
    {rule:'budget',label:'活动预算',actual:coupon.budget_remaining,expected:`至少 MYR ${coupon.discount_value}`,pass:coupon.budget_remaining>=coupon.discount_value,code:'CAMPAIGN_BUDGET_INSUFFICIENT'},
    {rule:'frequency_30d',label:'近30天领取频控',actual:profile.coupon_received_30d,expected:`少于 ${coupon.per_user_limit_30d} 张`,pass:profile.coupon_received_30d<coupon.per_user_limit_30d,code:'FREQUENCY_LIMIT_REACHED'},
    {rule:'product_scope',label:'适用产品范围',actual:coupon.eligible_product_ids,expected:`双方映射一致、产品在售且保费不低于 MYR ${coupon.minimum_premium}`,pass:productScope,code:'NO_ELIGIBLE_PRODUCT_SCOPE'},
    {rule:'maximum_discount',label:'最大折扣限制',actual:coupon.discount_value,expected:`不超过 MYR ${coupon.maximum_discount}`,pass:coupon.discount_value<=coupon.maximum_discount,code:'MAX_DISCOUNT_EXCEEDED'}
  ];
  if(coupon.extra_for_established_user) {
    const purchases=profile.historical_purchase_count;
    const months=profile.platform_tenure_months??0;
    const member=profile.active_membership===true;
    checks.push({rule:'established_customer',label:'资深用户额外券',actual:{purchases,months,member},expected:'买过至少2次保险，且使用平台满12个月或有有效会员',pass:purchases>=2&&(months>=12||member),code:'LOYALTY_NOT_ELIGIBLE'});
  }
  const failure=checks.find((check)=>!check.pass);
  return {coupon,checks,eligible:!failure,firstFailure:failure?.code??null};
}

function productScope(coupon:Coupon,products:InsuranceProduct[]){
  return products.filter(p=>p.active&&p.annual_premium>=coupon.minimum_premium&&coupon.eligible_product_ids.includes(p.product_id)&&p.coupon_ids.includes(coupon.coupon_id)).map(p=>p.product_id);
}

function ruleTrace(need:UserNeed,profile:UserProfile,evaluations:Evaluation[],upstreamBlocked:boolean,missing:string[]):DecisionTraceStep[]{
  const trace:DecisionTraceStep[]=[{step_id:'coupon-upstream-gate',stage:'coupon',kind:'validation',title:'检查上一环的信息是否足够',description:'车型未确认、续保意图不明或预算冲突时，先补问再决定是否发券。',input:{需要确认:missing,原始缺失字段:need.missing_fields,information_status:need.information_status},logic:'关键信息缺失或冲突 → 阻断',output:{blocked:upstreamBlocked,需要确认:missing},status:upstreamBlocked?'failed':'passed',reason_code:upstreamBlocked?'HIGH_RISK_COUPON_BLOCKED':'UPSTREAM_SCHEMA_VALID'}];
  for(const evaluation of evaluations){
    trace.push({step_id:`coupon-${evaluation.coupon.coupon_id}`,stage:'coupon',kind:'rule',title:`规则预筛 ${evaluation.coupon.coupon_id}`,description:'按固定顺序检查资格；任一条件不满足，即排除这张券。',input:{batch_name:evaluation.coupon.batch_name,profile_user:profile.user_id,checks:evaluation.checks.map(({rule,label,actual,expected})=>({rule,label,actual,expected}))},logic:'市场 → 分群 → 续保窗口 → 活动状态 → 预算 → 频控 → 产品范围 → 最大折扣',output:{checks:evaluation.checks.map(({rule,label,pass,code})=>({rule,label,pass,reason_code:pass?'PASS':code})),eligible:!upstreamBlocked&&evaluation.eligible,first_failure:evaluation.firstFailure},status:upstreamBlocked?'info':evaluation.eligible?'passed':'failed',reason_code:evaluation.firstFailure??'COUPON_ELIGIBLE'});
  }
  return trace;
}

export async function runCoupon(need:UserNeed|null,profile:UserProfile,coupons:Coupon[],products:InsuranceProduct[],mode:DecisionMode,llm:LLMProvider,now=new Date('2026-08-24T00:00:00Z')):Promise<StageResult<CouponDecision>>{
  const started=Date.now();
  if(!need)return {input:{need,profile},output:null,decision_summary:['Chat 输出无效，优惠券节点被阻断'],node_logs:[{node:'coupon.upstream',status:'failed',summary:'USER_NEED_MISSING',duration_ms:0}],trace:[],schema_valid:false,retry_count:0,fallback_status:'manual_review',error:'UPSTREAM_SCHEMA_INVALID'};
  const invalidConfig=coupons.filter((coupon)=>coupon.discount_value>coupon.maximum_discount||coupon.budget_remaining<0);
  if(invalidConfig.length){
    const decision=rejected(['RULE_CONFIGURATION_CONFLICT'],invalidConfig.map((coupon)=>({coupon_id:coupon.coupon_id,reason_code:'INVALID_DISCOUNT_OR_BUDGET'})),'manual_review');
    return {input:{invalid_coupon_ids:invalidConfig.map((x)=>x.coupon_id)},output:decision,decision_summary:['Voucher规则配置冲突，转人工核对'],node_logs:[{node:'coupon.configuration',status:'failed',summary:'invalid discount or budget',duration_ms:Date.now()-started}],trace:[{step_id:'coupon-config-conflict',stage:'coupon',kind:'validation',title:'Voucher配置检查',description:'折扣超过上限或预算为负时不运行发券流程。',input:{invalidConfig},logic:'discount_value <= maximum_discount AND budget_remaining >= 0',output:{blocked:true},status:'failed',reason_code:'RULE_CONFIGURATION_CONFLICT'}],schema_valid:true,retry_count:0,fallback_status:'manual_review'};
  }
  if(mode==='llm_only'){
    const parsed=couponDecisionSchema.safeParse(await llm.chooseCoupon(need,profile,coupons));
    if(!parsed.success)return {input:{need,profile},output:null,decision_summary:['LLM 输出未通过 Schema，禁止发券'],node_logs:[{node:'coupon.schema',status:'failed',summary:parsed.error.message,duration_ms:Date.now()-started}],trace:[],schema_valid:false,retry_count:0,fallback_status:'manual_review',error:'COUPON_SCHEMA_INVALID'};
    const decision=parsed.data;
    return {input:{need,profile_snapshot_id:profile.profile_snapshot_id,candidate_batches:coupons.map((x)=>x.coupon_id)},output:decision,decision_summary:['LLM 从全部原始券中直接选择；本对照组刻意跳过资格规则'],node_logs:[{node:'coupon.llm_decision',status:'warning',summary:decision.selected_coupon_id??'no coupon',duration_ms:Date.now()-started}],trace:[{step_id:'coupon-llm-only',stage:'coupon',kind:'llm',title:'LLM 直接发券（对照组）',description:'复用同一 LLM 节点，但不执行规则预筛和最终确认。',input:{candidate_batches:coupons.map((x)=>x.coupon_id)},logic:'全部券 → LLM选择 → 仅Schema校验',output:{decision},status:'warning',reason_code:'LLM_ONLY_UNSAFE_PATH'}],schema_valid:true,retry_count:0,fallback_status:decision.fallback_status};
  }
  const missing=[
    ...(need.vehicle.type==='unknown'?['车型']:[]),
    ...(need.intent==='unknown'?['是否要续保']:[]),
    ...(need.missing_fields.includes('budget.conflict_requires_confirmation')?['正确预算']:[]),
  ];
  const upstreamBlocked=missing.length>0;
  const evaluations=coupons.map((coupon)=>evaluateCoupon(coupon,profile,products,now));
  const trace=ruleTrace(need,profile,evaluations,upstreamBlocked,missing);
  if(upstreamBlocked){
    const decision=rejected(['UPSTREAM_FIELDS_INCOMPLETE','HIGH_RISK_COUPON_BLOCKED'],[],'clarification_required');
    return {input:{need,profile_snapshot:{user_id:profile.user_id,market:profile.market,segment:profile.segment}},output:decision,decision_summary:['关键信息不完整，先补问再发券'],node_logs:[{node:'coupon.upstream',status:'warning',summary:'blocked',duration_ms:Date.now()-started}],trace,schema_valid:true,retry_count:0,fallback_status:decision.fallback_status};
  }
  const eligible=evaluations.filter((x)=>x.eligible).map((x)=>x.coupon);
  const standard=eligible.filter(c=>!c.extra_for_established_user);
  const extra=eligible.filter(c=>c.extra_for_established_user);
  const options=standard.flatMap(base=>[
    {base, extra:null as Coupon|null, ids:productScope(base,products), amount:base.discount_value, reason:null as string|null},
    ...extra.map(add=>{
      const ids=productScope(base,products).filter(id=>productScope(add,products).includes(id));
      const amount=base.discount_value+add.discount_value;
      const reason=!add.stackable||add.stack_with_coupon_id!==base.coupon_id?'不允许叠加':!ids.length?'没有共同适用产品':amount>(add.combined_discount_cap??0)?'超过组合优惠上限':null;
      return {base,extra:add,ids,amount,reason};
    }),
  ]);
  const selected=options.filter(x=>!x.reason&&x.ids.length).sort((a,b)=>b.amount-a.amount||a.base.coupon_id.localeCompare(b.base.coupon_id)||(a.extra?.coupon_id??'').localeCompare(b.extra?.coupon_id??''))[0];
  const rejectedCoupons=evaluations.filter(x=>!x.eligible).map(x=>({coupon_id:x.coupon.coupon_id,reason_code:x.firstFailure!}));
  const decision:CouponDecision=selected?{
    decision:'grant',selected_coupon_id:selected.base.coupon_id,discount_value:selected.amount,currency:'MYR',eligible_product_ids:selected.ids,
    applied_coupons:[selected.base,...(selected.extra?[selected.extra]:[])].map(c=>({coupon_id:c.coupon_id,name:c.name,amount:c.discount_value,tier:c.extra_for_established_user?'extra':'standard'})),
    reason_codes:['RULE_PREFILTER_PASSED','DETERMINISTIC_RANK_RECORDED','FINAL_RULE_CHECK_PASSED'],rejected_coupon_ids:rejectedCoupons,fallback_status:'none',
  }:rejected(['NO_ELIGIBLE_COUPON'],rejectedCoupons);
  trace.push({step_id:'coupon-final-decision',stage:'coupon',kind:'validation',title:'确认本次发放方案',description:selected?'核对选中组合的叠加条件、共同适用产品和实际优惠。':'未找到可发放的券组合。',input:{候选方案:options.map(x=>({券:[x.base.coupon_id,x.extra?.coupon_id].filter(Boolean),优惠:x.amount,共同适用产品:x.ids,排除原因:x.reason}))},logic:'从满足叠加、范围和金额约束的方案中选实际优惠最高的一组',output:{decision},status:selected?'passed':'info',reason_code:selected?'FINAL_RULE_CHECK_PASSED':'NO_ELIGIBLE_COUPON'});
  return {input:{need,profile_snapshot:{profile_snapshot_id:profile.profile_snapshot_id,user_id:profile.user_id,market:profile.market,segment:profile.segment,renewal_due_days:profile.renewal_due_days,coupon_received_30d:profile.coupon_received_30d}},output:decision,decision_summary:['信息检查 → 单券资格 → 券组合确认',`合资格券 ${eligible.length} 张`,decision.decision==='grant'?`最终发放 ${decision.selected_coupon_id}`:'没有可发放的券'],node_logs:[{node:'coupon.hybrid_orchestration',status:'success',summary:`eligible=${eligible.length}; selected=${decision.selected_coupon_id??'none'}`,duration_ms:Date.now()-started}],trace,schema_valid:true,retry_count:0,fallback_status:decision.fallback_status};
}
