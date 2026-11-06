import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";import { stripeRequest,getPaymentsClientConfig } from "@floot/payments";import { createStripeCheckoutSession } from "../../helpers/createStripeCheckoutSession";import { getOrCreateStripePriceId } from "../../helpers/getOrCreateStripePriceId";
export async function handle(request:Request){try{const u=await a.current(request);const s=await a.settings();if(!s.billingEnabled||s.amount<=0)a.fail("Subscriptions are not open yet.",503);
 const {isLiveMode}=await getPaymentsClientConfig();
 let b=await db.selectFrom("billingAccounts").selectAll().where("userId","=",u.id).where("isLive","=",isLiveMode).executeTakeFirst();
 if(b?.subscriptionId&&["active","trialing","past_due","unpaid","incomplete"].includes(b.status))a.fail("Manage your existing subscription instead of starting another.");
 if(!b?.customerId){
 const c=await stripeRequest<{id:string}>({method:"POST",path:"/v1/customers",params:{email:u.email,name:u.displayName,metadata:{userId:String(u.id)}},idempotencyKey:"customer-"+u.id+"-"+isLiveMode});
 await db.insertInto("billingAccounts").values({userId:u.id,isLive:isLiveMode,customerId:c.id}).onConflict(oc=>oc.columns(["userId","isLive"]).doUpdateSet({customerId:c.id})).execute();
 b=await db.selectFrom("billingAccounts").selectAll().where("userId","=",u.id).where("isLive","=",isLiveMode).executeTakeFirstOrThrow();
 }
 if(b.checkoutId){const existing=await stripeRequest<any>({method:"GET",path:"/v1/checkout/sessions/"+b.checkoutId});if(existing.status==="open"&&existing.url)return a.json({url:existing.url});if(existing.status==="complete")a.fail("Your existing checkout is awaiting verification. Refresh Membership or contact support.",409);}
 const key="jobhunt-"+s.currency+"-"+s.amount+"-month-v1";
 const price=await getOrCreateStripePriceId({key,name:s.planName,amount:s.amount,currency:s.currency,interval:"month"});
 const checkout=await createStripeCheckoutSession(request,{mode:"subscription",customer:b.customerId,line_items:[{price,quantity:1}],client_reference_id:String(u.id),metadata:{userId:String(u.id)},subscription_data:{metadata:{userId:String(u.id),planKey:key}}},"checkout-"+u.id+"-"+isLiveMode+"-"+key+"-"+Math.floor(Date.now()/3600000));
 await db.updateTable("billingAccounts").set({checkoutId:checkout.id}).where("userId","=",u.id).where("isLive","=",isLiveMode).execute();
 return a.json({url:checkout.url});
 }catch(e){if((e as any)?.code==="payments_not_ready")return a.json({error:"Payments are temporarily unavailable. Contact the owner."},503);return a.error(e);}}