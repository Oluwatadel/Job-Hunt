import { notifyApplication } from "./notifyApplication";
import { db } from "./db";
import { serverAccess as a } from "./serverAccess";
import { channels } from "./realtimeChannels";
import { publish } from "@floot/realtime";
import { z } from "zod";
import { ApplicationStatusArrayValues } from "./schema";
const url=z.string().url().refine(v=>new URL(v).protocol==="https:","Use an HTTPS job link.");
const inputSchema=z.object({
 docId:z.string().min(1).max(200),company:z.string().trim().min(1).max(200),role:z.string().trim().min(1).max(300),
 source:z.string().max(1000).nullish(),contact:z.string().max(500).nullish(),location:z.string().max(500).nullish(),
 jobUrl:url.nullish(),status:z.enum(ApplicationStatusArrayValues),nextAction:z.string().max(3000).nullish(),
 notes:z.string().max(25000).nullish(),confirmation:z.string().trim().max(2000).nullish(),
 dateApplied:z.string().datetime().nullish(),lastContact:z.string().datetime().nullish()
});
export async function saveApplication(user:{id:number;accessUntil?:Date|null},raw:unknown){
 const i=inputSchema.parse(raw);const paid=await a.paid(user);const settings=await a.settings();
 let previousStatus:string|undefined;
 const row=await db.transaction().execute(async tx=>{
 await tx.selectFrom("users").select("id").where("id","=",user.id).forUpdate().executeTakeFirstOrThrow();
 const old=await tx.selectFrom("applications").selectAll().where("userId","=",user.id).where("docId","=",i.docId).executeTakeFirst();
 previousStatus=old?.status;
 if(!old&&!paid){const n=await tx.selectFrom("applications").select(tx.fn.countAll().as("n")).where("userId","=",user.id).executeTakeFirstOrThrow();if(Number(n.n)>=settings.freeLimit)a.fail("Free tracking limit reached. Upgrade or contact support.",402);}
 const proof=i.confirmation??old?.confirmation;
 if(i.status==="applied" && old?.status!=="applied" && !proof)a.fail("Add a submission confirmation or sent-message reference before marking Applied.");
 const values={userId:user.id,company:i.company,role:i.role,status:i.status,source:i.source??old?.source??null,contact:i.contact??old?.contact??null,location:i.location??old?.location??null,jobUrl:i.jobUrl===undefined?old?.jobUrl??null:i.jobUrl,nextAction:i.nextAction===undefined?old?.nextAction??null:i.nextAction,notes:i.notes===undefined?old?.notes??null:i.notes,confirmation:proof??null,dateApplied:i.status==="applied"?(i.dateApplied?new Date(i.dateApplied):old && ["applied","interviewed","offer","rejected"].includes(old.status) && old.dateApplied ? old.dateApplied : new Date()):old?.dateApplied??null,lastContact:i.lastContact?new Date(i.lastContact):old?.lastContact??null,updatedAt:new Date()};
 const r=await tx.insertInto("applications").values({docId:i.docId,...values}).onConflict(oc=>oc.columns(["userId","docId"]).doUpdateSet(values)).returningAll().executeTakeFirstOrThrow();
 await tx.insertInto("applicationEvents").values({userId:user.id,applicationId:r.id,event:old?"Application updated":"Job added",detail:r.company+" — "+r.role+" · "+r.status+(proof?" · "+proof:"")}).execute();
 return r;
 });
 await publish(channels.applications(user.id),{type:"updated",docId:row.docId});
 if(!previousStatus||previousStatus!==row.status){try{await notifyApplication(user.id,row.company,row.role,row.status,row.docId);}catch(e){console.warn("Push delivery failed",e);}}
 return row;
}