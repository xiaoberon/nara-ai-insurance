import { confirmAnswers } from '../../src/server/services/clarification';
import { describe,expect,it } from 'vitest';
import { testCases } from '../../src/server/data/testCases';
import { compareModes } from '../../src/server/services/evaluationService';
import { runFull } from '../../src/server/services/runService';

describe('Full four-stage run',()=>{
  it('stops all downstream work until the visitor confirms the missing vehicle data',async()=>{
    const item=testCases.find(item=>item.id==='C07')!;
    const pending=await runFull({case:item,mode:'hybrid'});
    expect(pending.clarification?.fields).toEqual(['vehicle_type','vehicle_age']);
    expect([pending.stages.coupon,pending.stages.recommendation,pending.stages.comparison].map(stage=>stage.error)).toEqual(Array(3).fill('AWAITING_CLARIFICATION'));
    const answers={vehicle_type:'Sedan',vehicle_age:3} as const;
    const need=confirmAnswers(pending.stages.chat.output!,answers)!;
    const resumed=await runFull({case:item,mode:'hybrid',continuation:{chat:pending.stages.chat,need,source:'example',values:answers}});
    expect(resumed.confirmed?.source).toBe('example');
    expect(resumed.stages.recommendation.output?.recommended_products.length).toBeGreaterThan(0);
    expect(resumed.stages.chat.output?.budget.max_annual_premium).toBeNull();
  });

  it('links four stage outputs under one audit id',async()=>{
    const run=await runFull({case:testCases[0],mode:'hybrid',persist:false});
    expect(run.audit.run_id).toMatch(/[0-9a-f-]{36}/);
    expect(run.stages.chat.output?.intent).toBe('renew_car_insurance');
    expect(run.stages.coupon.output?.decision).toBe('grant');
    expect(run.stages.recommendation.output?.recommended_products.map((item)=>item.product_id)).toEqual(['P008','P001','P005','P003','P007','P002']);
    expect(run.stages.comparison.output?.products.map((item)=>item.product_id)).toEqual(['P008','P001','P005','P003','P007','P002']);
  });

  it('runs all 20 cases in all three modes and reports measured metrics',async()=>{
    const evaluation=await compareModes(1);
    expect(evaluation.test_case_count).toBe(20);
    expect(evaluation.modes).toHaveLength(3);
    expect(evaluation.modes.every((x)=>x.runs===20)).toBe(true);
    expect(evaluation.modes.every((x)=>typeof x.chat_pass_rate==='number'&&typeof x.voucher_pass_rate==='number'&&typeof x.recommendation_pass_rate==='number'&&typeof x.comparison_pass_rate==='number'&&typeof x.full_chain_pass_rate==='number')).toBe(true);
    expect(evaluation.modes.find((x)=>x.mode==='llm_only')!.hard_condition_violations).toBeGreaterThan(0);
    expect(evaluation.note).toContain('no superiority values are prefilled');
  });

  it('runs the five-case typical suite as 75 paired executions',async()=>{
    const evaluation=await compareModes(5,'typical');
    expect(evaluation.test_case_count).toBe(5);
    expect(evaluation.profile_count).toBe(3);
    expect(evaluation.execution_count).toBe(75);
    expect(evaluation.modes.every((x)=>x.runs===25)).toBe(true);
    const hybrid=evaluation.modes.find(mode=>mode.mode==='hybrid')!;
    expect(hybrid.expected_pauses).toBe(10);
    expect(hybrid.expected_comparison_skips).toBe(5);
    expect(hybrid.stage_denominators).toEqual({chat:25,voucher:15,recommendation:15,comparison:10});
    expect(evaluation.case_results.find(item=>item.case_id==='C01')?.modes.hybrid.comparison_pass_rate).toBe(1);
    expect(evaluation.case_results.find(item=>item.case_id==='C16')?.modes.hybrid.comparison_pass_rate).toBeNull();
  });

  it('can evaluate only the currently selected case in three executions',async()=>{
    const evaluation=await compareModes(1,'current','C12');
    expect(evaluation.test_case_count).toBe(1);
    expect(evaluation.execution_count).toBe(3);
    expect(evaluation.case_results[0].case_id).toBe('C12');
    expect(evaluation.case_results[0].expected.comparison.required_conflict).toBe('P005.deductible');
  });
});
