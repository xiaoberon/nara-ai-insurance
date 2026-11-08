import type { ComparisonItem, ComparisonResult, DecisionMode, DecisionTraceStep, InsuranceProduct, PdpDocument, StageResult, UserNeed } from '../../shared/types';
import type { LLMProvider } from '../llm/LLMProvider';
import { comparisonResultSchema } from '../schemas';
import { pdpTextFor } from './pdpText';

function rulesExtract(products:InsuranceProduct[],pdps:PdpDocument[],discount:number):ComparisonResult{
  const items:ComparisonItem[]=products.map((product)=>{
    const text=pdpTextFor(product.product_id,pdps);
    const roadsideStated=/道路救援|道路援助/.test(text)&&!/未说明道路救援|未提及道路救援|未披露道路救援/.test(text);
    const floodStated=/水浸|水灾/.test(text)&&!/未提及水浸|未披露水浸/.test(text);
    const premium=Number(text.match(/(?:年保费|每年|年费)\s*MYR\s*([0-9,]+)/)?.[1]?.replace(',','')??0)||'not_stated';
    const sum=Number(text.match(/(?:保额|最高赔偿额|保险金额)\s*MYR\s*([0-9,]+)/)?.[1]?.replace(',','')??0)||'not_stated';
    const deductibleMatches=[...text.matchAll(/(?:免赔(?:额)?(?:条款写为)?|自付额)\s*MYR\s*([0-9,]+)/g)].map((m)=>Number(m[1].replace(',','')));
    const conflicts=deductibleMatches.length>1&&new Set(deductibleMatches).size>1?['deductible: REGEX_CONFLICT']:[];
    return {product_id:product.product_id,product_name:product.product_name,insurer:product.insurer,annual_premium:premium,discount_amount:discount,premium_after_coupon:typeof premium==='number'?premium-discount:'not_stated',sum_insured:sum,coverage:{flood:floodStated?'covered':'not_stated',theft:/盗抢|失窃/.test(text)?'covered':'not_stated',collision:/碰撞/.test(text)?'covered':'not_stated',fire:/火灾/.test(text)?'covered':'not_stated',natural_disaster:/自然灾害/.test(text)?'covered':'not_stated',third_party:/第三者|第三方/.test(text)?'covered':'not_stated',personal_accident:/个人意外/.test(text)?'covered':'not_stated'},deductible:conflicts.length?'not_stated':(deductibleMatches[0]??'not_stated'),roadside_assistance:roadsideStated?'included':'not_stated',term_and_waiting_period:text.match(/(?:保障期|保期|期限)[^。]+/)?.[0]??'not_stated',exclusions:[],claim_channel_and_documents:text.match(/[^。]*理赔[^。]*/)?.[0]??'not_stated',vehicle_eligibility:text.match(/适用[0-9]+年内[^。]+/)?.[0]??'not_stated',not_stated_fields:[],conflicts,evidence:{premium:text.match(/[^。]*(?:年保费|每年|年费)[^。]*/)?.[0]??'not_stated',sum_insured:text.match(/[^。]*(?:保额|赔偿额|保险金额)[^。]*/)?.[0]??'not_stated',deductible:text.match(/[^。]*(?:免赔|自付额)[^。]*/)?.[0]??'not_stated'},match_summary:'纯规则正则抽取；仅识别预定义措辞。'};
  });
  const review=items.some((x)=>x.conflicts.length>0);
  return {products:items,requires_manual_review:review,fallback_status:review?'manual_review':'none',errors:[]};
}

function deriveNotStatedFields(item:ComparisonItem):string[]{
  const conflicted=new Set(item.conflicts.map((value)=>value.split(':')[0].trim()));
  const candidates:Array<[string,unknown]>=[
    ['annual_premium',item.annual_premium],['sum_insured',item.sum_insured],['deductible',item.deductible],
    ['roadside_assistance',item.roadside_assistance],['term_and_waiting_period',item.term_and_waiting_period],
    ['claim_channel_and_documents',item.claim_channel_and_documents],['vehicle_eligibility',item.vehicle_eligibility],
    ...Object.entries(item.coverage).map(([field,value]):[string,unknown]=>[`coverage.${field}`,value])
  ];
  return candidates.filter(([path,value])=>value==='not_stated'&&!conflicted.has(path)&&!conflicted.has(path.replace('coverage.',''))).map(([path])=>path);
}

function invalidEvidence(result:ComparisonResult,pdps:PdpDocument[]):string[]{
  const errors:string[]=[];
  for(const item of result.products){
    const source=pdpTextFor(item.product_id,pdps);
    for(const [field,evidence] of Object.entries(item.evidence)){
      if(evidence!=='not_stated'&&!source.includes(evidence))errors.push(`${item.product_id}.${field}: SOURCE_NOT_FOUND`);
    }
  }
  return errors;
}

export async function runComparison(need:UserNeed|null,selectedProductIds:string[],allProducts:InsuranceProduct[],pdps:PdpDocument[],discount:number,mode:DecisionMode,llm:LLMProvider):Promise<StageResult<ComparisonResult>>{
  const started=Date.now();
  const selected=selectedProductIds.map((id)=>allProducts.find((p)=>p.product_id===id)).filter((x):x is InsuranceProduct=>Boolean(x));
  if(!need||selected.length<2)return {input:{need,selectedProductIds},output:null,decision_summary:['至少需要两个有效产品，或上游需求不可用'],node_logs:[{node:'comparison.input',status:'failed',summary:'INSUFFICIENT_PRODUCTS_OR_NEED',duration_ms:0}],trace:[{step_id:'comparison-input',stage:'comparison',kind:'validation',title:'比较输入门禁',description:'至少两个有效 Product ID 和经过校验的 UserNeed。',input:{selectedProductIds,valid_products:selected.map((x)=>x.product_id),has_need:Boolean(need)},logic:'need != null AND valid_products.length >= 2',output:{blocked:true},status:'failed',reason_code:'COMPARISON_INPUT_INVALID'}],schema_valid:false,retry_count:0,fallback_status:'raw_pdp_only',error:'COMPARISON_INPUT_INVALID'};
  let raw:unknown=mode==='rules_only'?rulesExtract(selected,pdps,discount):await llm.compareProducts(selected,pdps,discount);
  if(mode==='llm_only'&&typeof raw==='object'&&raw){
    const loose=raw as ComparisonResult;
    raw={...loose,products:loose.products.map((item)=>({...item,conflicts:[]})),requires_manual_review:false,fallback_status:'none'};
  }
  const parsed=comparisonResultSchema.safeParse(raw);
  if(!parsed.success)return {input:{selectedProductIds,raw_pdps:pdps.filter((p)=>selectedProductIds.includes(p.product_id))},output:null,decision_summary:['抽取输出未通过 Schema','保留原始 PDP，不生成比较结论'],node_logs:[{node:'comparison.schema',status:'failed',summary:parsed.error.message,duration_ms:Date.now()-started}],trace:[{step_id:'comparison-schema-failed',stage:'comparison',kind:'validation',title:'ComparisonResult Schema 失败',description:'不输出未经校验的横向比较。',input:{raw},logic:'comparisonResultSchema.safeParse(raw)',output:{issues:parsed.error.issues},status:'failed',reason_code:'COMPARISON_SCHEMA_INVALID'}],schema_valid:false,retry_count:0,fallback_status:'raw_pdp_only',error:'COMPARISON_SCHEMA_INVALID'};
  const result:ComparisonResult={...parsed.data,products:parsed.data.products.map((item)=>({...item,not_stated_fields:deriveNotStatedFields(item)}))};
  const sourceErrors=mode==='llm_only'?[]:invalidEvidence(result,pdps);
  if(sourceErrors.length)return {input:{selectedProductIds,raw_pdps:pdps.filter((p)=>selectedProductIds.includes(p.product_id))},output:null,decision_summary:['字段来源校验失败','保留原始 PDP，不输出未经验证的结论'],node_logs:[{node:'comparison.source_validation',status:'failed',summary:sourceErrors.join('; '),duration_ms:Date.now()-started}],trace:[...result.products.map((item):DecisionTraceStep=>({step_id:`extract-${item.product_id}`,stage:'comparison',kind:mode==='rules_only'?'normalization':'llm',title:`抽取 ${item.product_id}`,description:'将不同 PDP 措辞归一到统一比较字段。',input:{pdp_id:allProducts.find((p)=>p.product_id===item.product_id)?.pdp_id},logic:mode==='rules_only'?'regex + synonym map':'structured extraction → normalization',output:{premium:item.annual_premium,sum_insured:item.sum_insured,deductible:item.deductible,not_stated_fields:item.not_stated_fields,conflicts:item.conflicts},status:item.conflicts.length?'warning':'passed',evidence:Object.values(item.evidence)})),{step_id:'comparison-source-failed',stage:'comparison',kind:'validation',title:'来源证据校验失败',description:'至少一个证据片段无法在对应 PDP 中找到，全部结构化结论被阻断。',input:{sourceErrors},logic:'every evidence_snippet must be substring of same product PDP',output:{valid:false,fallback:'raw_pdp_only'},status:'failed',reason_code:'SOURCE_NOT_FOUND'}],schema_valid:false,retry_count:0,fallback_status:'raw_pdp_only',error:sourceErrors.join('; ')};
  const trace:DecisionTraceStep[]=result.products.map(item=>{
    const source=pdpTextFor(item.product_id,pdps);
    const deductibleConflict=item.conflicts.some(x=>x.startsWith('deductible'));
    const snippets=deductibleConflict?[...source.matchAll(/[^。！？]*免赔额\s*MYR\s*[\d,]+[^。！？]*/g)].map(x=>x[0].trim()):[];
    const amounts=[...new Set(snippets.map(line=>line.match(/免赔额\s*MYR\s*([\d,]+)/)?.[1]).filter(Boolean))];
    const description=deductibleConflict
      ? amounts.length>1?'同一详情页同时写了 '+amounts.map(x=>'MYR '+x).join(' 和 ')+'，暂不采用其中任一金额。':'详情页免赔额有冲突，暂不采用数值。'
      :item.conflicts.length?'发现字段冲突，请查看详情页核对。':'已整理本产品的比较字段。';
    return {step_id:'extract-'+item.product_id,stage:'comparison',kind:mode==='rules_only'?'normalization':'llm',title:item.product_id+(deductibleConflict?' · 免赔额需人工核对':item.conflicts.length?' · 字段需核对':' · 比较结果'),description,input:{pdp_id:allProducts.find(p=>p.product_id===item.product_id)?.pdp_id,focus:need.coverage_priorities},logic:'按本阶段统一的字段与证据规则处理',output:{premium:item.annual_premium,sum_insured:item.sum_insured,deductible:item.deductible,coverage:item.coverage,not_stated_fields:item.not_stated_fields,conflicts:item.conflicts},status:item.conflicts.length?'warning':'passed',reason_code:item.conflicts.length?'FIELD_CONFLICT':'FIELDS_EXTRACTED',evidence:snippets.length?snippets:Object.values(item.evidence).filter(value=>value!=='not_stated')};
  });
  trace.push({step_id:'comparison-schema-source',stage:'comparison',kind:'validation',title:'比较结果总检查',description:mode==='llm_only'?'LLM Only 对照组只执行结构校验。':'逐字段验证格式和证据；冲突数值不自动选择更有利结果。',input:{mode,product_count:result.products.length},logic:mode==='llm_only'?'schema_valid':'schema_valid AND evidence_in_source AND conflict_gate',output:{schema_valid:true,source_errors:sourceErrors,requires_manual_review:result.requires_manual_review},status:result.requires_manual_review?'warning':'passed',reason_code:result.requires_manual_review?'PDP_FIELD_CONFLICT':'COMPARISON_VALID'});
  return {input:{selectedProductIds,focus:need.coverage_priorities},output:result,decision_summary:[mode==='rules_only'?'使用关键词/正则抽取（对照组）':mode==='llm_only'?'LLM抽取但跳过来源与冲突门禁（对照组）':'Mock LLM结构化抽取并执行 Schema/来源校验',`比较 ${result.products.length} 个产品；缺失字段明确标为 not_stated`,result.requires_manual_review?'发现字段冲突，确定结论被阻断并进入人工核对':'关键字段来源可追溯'],node_logs:[{node:'comparison.extract',status:result.requires_manual_review?'warning':'success',summary:`products=${result.products.length}`,duration_ms:Date.now()-started},{node:'comparison.schema_and_source',status:'success',summary:'Schema and source validation passed',duration_ms:0}],trace,schema_valid:true,retry_count:0,fallback_status:result.fallback_status};
}

