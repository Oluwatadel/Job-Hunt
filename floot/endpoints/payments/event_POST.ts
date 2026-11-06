import { getPaymentCallbackEventFromRequest } from "@floot/payments";import { db } from "../../helpers/db";import { syncSubscription } from "../../helpers/syncSubscription";
export async function handle(request:Request){let e;try{e=await getPaymentCallbackEventFromRequest(request);}catch{return Response.json({error:"Invalid callback"},{status:400});}
 try{const isLive=e.stage==="prod";const done=await db.selectFrom("paymentEvents").select("eventId").where("eventId","=",e.eventId).executeTakeFirst();if(done)return Response.json({received:true});
 if(e.subscriptionId&&e.customerId){const b=await db.selectFrom("billingAccounts").selectAll().where("customerId","=",e.customerId).where("isLive","=",isLive).executeTakeFirst();if(b&&(!b.subscriptionId||b.subscriptionId===e.subscriptionId))await syncSubscription(b.userId,isLive,e.subscriptionId);}
 await db.insertInto("paymentEvents").values({eventId:e.eventId,isLive,eventType:e.type}).onConflict(oc=>oc.column("eventId").doNothing()).execute();return Response.json({received:true});
 }catch{return Response.json({error:"Callback processing failed; retry required."},{status:503});}}
