export class FlootAiOutOfCreditsError extends Error {}
export class FlootAiRateLimitError extends Error {}
export const flootAi={async chat(params:Record<string,unknown>){
 const key=process.env.AI_API_KEY;const model=process.env.AI_MODEL;
 if(!key||!model)throw new Error('Set AI_API_KEY and AI_MODEL in the local environment.');
 const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
 const response=await fetch(base+'/responses',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({...params,model,store:false}),signal:AbortSignal.timeout(140000)});
 if(response.status===429)throw new FlootAiRateLimitError();
 if(response.status===402)throw new FlootAiOutOfCreditsError();
 if(!response.ok)throw new Error('AI provider request failed.');
 return response.json();
}};
