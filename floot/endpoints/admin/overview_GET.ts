import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";import { getPaymentsClientConfig } from "@floot/payments";
export async function handle(request:Request){try{await a.owner(request);const settings=await a.settings();let live=false;try{live=(await getPaymentsClientConfig()).isLiveMode;}catch{}
 const users=await db.selectFrom("users").select(["id","displayName","email","disabled","accessUntil","createdAt"]).orderBy("createdAt","desc").execute();
 const billing=await db.selectFrom("billingAccounts").select(["userId","status","periodEnd"]).where("isLive","=",live).execute();
 const counts=await db.selectFrom("applications").select(["userId",db.fn.countAll().as("total")]).groupBy("userId").execute();
 const runs=await db.selectFrom("searchRuns").selectAll().orderBy("startedAt","desc").limit(30).execute();
 const tickets=await db.selectFrom("supportTickets").innerJoin("users","users.id","supportTickets.userId").select(["supportTickets.id","supportTickets.userId","supportTickets.subject","supportTickets.message","supportTickets.status","supportTickets.reply","supportTickets.createdAt","users.email"]).orderBy("supportTickets.updatedAt","desc").limit(100).execute();
 return a.json({settings,isLive:live,users:users.map(u=>({...u,billing:billing.find(b=>b.userId===u.id)??null,tracked:Number(counts.find(c=>c.userId===u.id)?.total??0)})),runs,tickets});
 }catch(e){return a.error(e);}}