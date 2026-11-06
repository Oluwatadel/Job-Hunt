import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";import { syncSubscription } from "../../helpers/syncSubscription";import { stripeRequest,getPaymentsClientConfig } from "@floot/payments";import { z } from "zod";import superjson from "superjson";
export async function handle(request:Request){try{const u=await a.current(request);const i=z.object({checkoutSessionId:z.string().max(200)}).parse(superjson.parse(await request.text()));const {isLiveMode}=await getPaymentsClientConfig();
 const b=await db.selectFrom("billingAccounts").selectAll().where("userId","=",u.id).where("isLive","=",isLiveMode).executeTakeFirst();if(!b||b.checkoutId!==i.checkoutSessionId)a.fail("Checkout not found.",404);
 const c=await stripeRequest<any>({method:"GET",path:"/v1/checkout/sessions/"+encodeURIComponent(i.checkoutSessionId)});
 if(c.customer!==b!.customerId||c.client_reference_id!==String(u.id)||!!c.livemode!==isLiveMode)a.fail("Checkout not found.",404);
 if(c.status!=="complete"||c.payment_status!=="paid"||typeof c.subscription!=="string")return a.json({status:"pending"});
 return a.json({status:await syncSubscription(u.id,isLiveMode,c.subscription)});
 }catch(e){return a.error(e);}}