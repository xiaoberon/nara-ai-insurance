import type { UserNeed, UserProfile } from '../../shared/types';

export type Answers = Partial<{intent:UserNeed['intent'];vehicle_type:UserNeed['vehicle']['type'];vehicle_age:number;budget:number|null}>;
export function requiredFields(need:UserNeed):(keyof Answers)[]{
  const missing:(keyof Answers)[]=[];
  if(need.intent==='unknown')missing.push('intent');
  if(need.vehicle.type==='unknown')missing.push('vehicle_type');
  if(need.vehicle.age_years===null)missing.push('vehicle_age');
  if(need.missing_fields.includes('budget.conflict_requires_confirmation'))missing.push('budget');
  return missing;
}
export function sampleAnswers(need:UserNeed,profile:UserProfile):Answers{
  const values:Answers={intent:'renew_car_insurance',vehicle_type:profile.vehicle_type as UserNeed['vehicle']['type'],vehicle_age:profile.vehicle_age_years,budget:null};
  return Object.fromEntries(requiredFields(need).map(field=>[field,values[field]]));
}
export function confirmAnswers(need:UserNeed,input:unknown):UserNeed|null{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const answers=input as Answers;
  const fields=requiredFields(need);
  if(Object.keys(answers).length!==fields.length||!fields.every(key=>Object.prototype.hasOwnProperty.call(answers,key)))return null;
  if(fields.includes('intent')&&answers.intent!=='renew_car_insurance')return null;
  if(fields.includes('vehicle_type')&&!['Sedan','SUV','Hatchback','MPV'].includes(answers.vehicle_type??''))return null;
  if(fields.includes('vehicle_age')&&(!Number.isInteger(answers.vehicle_age)||answers.vehicle_age!<0||answers.vehicle_age!>80))return null;
  if(fields.includes('budget')&&answers.budget!==null&&(!Number.isInteger(answers.budget)||answers.budget!<=0||answers.budget!>1000000))return null;
  const updated={...need,vehicle:{...need.vehicle},budget:{...need.budget},missing_fields:need.missing_fields.filter(field=>field!=='budget.conflict_requires_confirmation')};
  if(answers.intent)updated.intent=answers.intent;
  if(answers.vehicle_type)updated.vehicle.type=answers.vehicle_type;
  if(answers.vehicle_age!==undefined)updated.vehicle.age_years=answers.vehicle_age;
  if(answers.budget!==undefined)updated.budget.max_annual_premium=answers.budget;
  updated.missing_fields=[...(updated.budget.max_annual_premium===null?['budget.max_annual_premium']:[])];
  updated.information_status='complete';
  return updated;
}
