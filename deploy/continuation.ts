import type { DecisionMode, StageResult, UserNeed } from '../src/shared/types';
type Snapshot={caseId:string;mode:DecisionMode;chat:StageResult<UserNeed>;expires:number};
const encoder=new TextEncoder();
const keyFor=(secret:string)=>crypto.subtle.importKey('raw',encoder.encode('nara-continuation-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
function encode(value:Uint8Array){return btoa(String.fromCharCode(...value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function decode(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}
export async function signContinuation(data:Omit<Snapshot,'expires'>,secret:string){
  const body=encode(encoder.encode(JSON.stringify({...data,expires:Date.now()+15*60*1000})));
  return body+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await keyFor(secret),encoder.encode(body))));
}
export async function readContinuation(token:unknown,secret:string,caseId:string,mode:DecisionMode):Promise<Snapshot|null>{
  if(typeof token!=='string'||token.length>48000)return null;
  try{
    const [body,signature,extra]=token.split('.');
    if(!body||!signature||extra!==undefined||!await crypto.subtle.verify('HMAC',await keyFor(secret),decode(signature),encoder.encode(body)))return null;
    const data=JSON.parse(new TextDecoder().decode(decode(body))) as Snapshot;
    return data.caseId===caseId&&data.mode===mode&&data.expires>Date.now()&&data.chat.output?data:null;
  }catch{return null}
}
