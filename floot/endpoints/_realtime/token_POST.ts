import { createToken } from "@floot/realtime";
import { channels } from "../../helpers/realtimeChannels";
import { serverAccess as a } from "../../helpers/serverAccess";
export async function handle(request:Request){try{
 const user=await a.current(request);const userId=String(user.id);
 const r=await createToken({userId,channels:[channels.applications(userId),channels.links(userId)],ttlSeconds:300});
 if(!r.ok)return a.json({error:r.error.message},500);
 return a.json({token:r.token,wssEndpoint:r.wssEndpoint,userId});
}catch(e){return a.error(e);}}