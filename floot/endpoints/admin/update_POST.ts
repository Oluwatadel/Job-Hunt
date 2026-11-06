import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";import { z } from "zod";import superjson from "superjson";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("user"),userId:z.number().int().positive(),disabled:z.boolean().optional(),free:z.boolean().optional()}),
 z.object({action:z.literal("plan"),amount:z.number().int().min(10000).max(100000000),currency:z.enum(["ngn","usd"]),billingEnabled:z.boolean(),freeLimit:z.number().int().min(0).max(1000)}),
 z.object({action:z.literal("support"),id:z.string(),reply:z.string().trim().min(1).max(5000),status:z.enum(["open","closed"])})
]);
export async function handle(request:Request){try{const owner=await a.owner(request);const i=schema.parse(superjson.parse(await request.text()));
 if(i.action==="user"){if(i.userId===owner.id)a.fail("The owner account cannot be suspended or have its free access removed.");
 await db.transaction().execute(async tx=>{const target=await tx.updateTable("users").set({...i.disabled!==undefined?{disabled:i.disabled}:{},...i.free!==undefined?{accessUntil:i.free?new Date("9999-12-31T00:00:00Z"):null}:{},updatedAt:new Date()}).where("id","=",i.userId).returning("id").executeTakeFirstOrThrow();if(i.disabled)await tx.deleteFrom("sessions").where("userId","=",target.id).execute();});
 }else if(i.action==="plan"){await db.updateTable("platformSettings").set({amount:i.amount,currency:i.currency,billingEnabled:i.billingEnabled,freeLimit:i.freeLimit,updatedAt:new Date()}).where("id","=",1).execute();}
 else{await db.updateTable("supportTickets").set({reply:i.reply,status:i.status,updatedAt:new Date()}).where("id","=",i.id).executeTakeFirstOrThrow();}
 return a.json({ok:true});
 }catch(e){return a.error(e);}}