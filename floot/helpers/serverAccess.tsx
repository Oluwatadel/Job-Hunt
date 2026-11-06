import { db } from "./db";
import { getServerUserSession } from "./getServerUserSession";
import { isAuthorizedIngestRequest } from "./ingestAuth";
import { getPaymentsClientConfig } from "@floot/payments";
import superjson from "superjson";
import { hasAutomationAccess } from "./hasAutomationAccess";

class AccessError extends Error { constructor(message:string,public status=403){super(message);} }
class Access {
  json(data:unknown,status=200){return new Response(superjson.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
  error(error:unknown){return this.json({error:error instanceof AccessError ? error.message : "Unable to complete this request."},error instanceof AccessError ? error.status : 400);}
  async settings(){return db.selectFrom("platformSettings").selectAll().where("id","=",1).executeTakeFirstOrThrow();}
  async current(request:Request){
    if(request.method==="POST" && request.headers.get("sec-fetch-site")==="cross-site")throw new AccessError("Cross-site request refused.",403);
    let user;try{user=(await getServerUserSession(request)).user;}catch{throw new AccessError("Please sign in.",401);}
    const record=await db.selectFrom("users").select(["disabled","accessUntil"]).where("id","=",user.id).executeTakeFirstOrThrow();
    if(record.disabled)throw new AccessError("Your account is suspended. Contact the owner.",403);
    return {...user,...record};
  }
  async owner(request:Request){const user=await this.current(request);const s=await this.settings();if(user.id!==s.ownerId)throw new AccessError("Owner access required.",403);return user;}
  async actor(request:Request){
    if(isAuthorizedIngestRequest(request)){
      const s=await this.settings();const target=request.headers.get("x-user-id");
      const id=target ? Number(target):s.ownerId;
      if(!Number.isSafeInteger(id)||id<1)throw new AccessError("Invalid automation user.",400);
      const user=await db.selectFrom("users").selectAll().where("id","=",id).executeTakeFirst();
      if(!user||user.disabled)throw new AccessError("User unavailable.",403);
      if(!await this.paid(user))throw new AccessError("A confirmed subscription payment or admin free-access grant is required for automation.",402);
      return user;
    }
    return this.current(request);
  }
  async paid(user:{id:number;accessUntil?:Date|null}){
    const s=await this.settings();if(user.id===s.ownerId)return true;
    if(user.accessUntil && new Date(user.accessUntil)>new Date())return true;
    try{
      const {isLiveMode}=await getPaymentsClientConfig();
      const b=await db.selectFrom("billingAccounts").selectAll().where("userId","=",user.id).where("isLive","=",isLiveMode).executeTakeFirst();
      return hasAutomationAccess({userId:user.id,ownerId:s.ownerId,accessUntil:user.accessUntil,billing:b});
    }catch{return false;}
  }
  fail(message:string,status=400):never{throw new AccessError(message,status);}
}
export const serverAccess: Access = new Access();
