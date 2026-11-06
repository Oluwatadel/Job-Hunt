import {flootAi,FlootAiOutOfCreditsError,FlootAiRateLimitError} from "@floot/ai";
import {rewriteDraft} from "../helpers/rewriteDraft";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function handle(request:Request):Promise<Response>{
 if(request.method!=="POST")return json({error:"Method not allowed."},405);
 try{
  const body=await request.text();if(body.length>100000)return json({error:"Draft is too large."},413);
  let data:unknown;try{data=JSON.parse(body)}catch{return json({error:"Please send valid JSON."},400);}
  const parsed=rewriteDraft.schema.safeParse(data);
  if(!parsed.success)return json({error:parsed.error.issues[0]?.message||"Please check your draft."},400);
  return json(await rewriteDraft.run(parsed.data,async(params)=>await flootAi.chat(params as any)));
 }catch(error){
  if(error instanceof FlootAiOutOfCreditsError)return json({error:"Rewriting is temporarily unavailable.",code:"OUT_OF_CREDITS"},503);
  if(error instanceof FlootAiRateLimitError)return json({error:"Too many rewrites. Please wait one minute."},429);
  const safe=error instanceof Error&&/^(Please remove reserved|The model did not finish|No complete rewrite|The rewrite changed protected|An unexpected reference)/.test(error.message);
  return json({error:safe?(error as Error).message:"We could not complete this rewrite. Your original draft is safe. Please try again."},502);
 }
}
