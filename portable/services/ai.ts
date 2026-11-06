import { required } from './config';
export class FlootAiOutOfCreditsError extends Error {}
export const flootAi={async chat(params:any){
 const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
 const r=await fetch(base+'/responses',{method:'POST',headers:{Authorization:'Bearer '+required('AI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({...params,model:required('AI_MODEL'),store:false}),signal:AbortSignal.timeout(180000)});
 if(r.status===402||r.status===429)throw new FlootAiOutOfCreditsError('AI provider unavailable or usage limit reached.');
 if(!r.ok)throw new Error('AI request failed.');
 return {...await r.json(),flootCredits:{consumed:0}};
}};
