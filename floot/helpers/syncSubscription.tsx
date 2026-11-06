import { db } from "./db";
import { stripeRequest } from "@floot/payments";
export async function syncSubscription(userId:number,isLive:boolean,subscriptionId:string){
 const b=await db.selectFrom("billingAccounts").selectAll().where("userId","=",userId).where("isLive","=",isLive).executeTakeFirstOrThrow();
 const s=await stripeRequest<any>({method:"GET",path:"/v1/subscriptions/"+encodeURIComponent(subscriptionId)});
 const customer=typeof s.customer==="string"?s.customer:s.customer?.id;
 if(customer!==b.customerId||s.metadata?.userId!==String(userId)||!!s.livemode!==isLive)throw new Error("Subscription ownership mismatch");
 const end=s.current_period_end??s.items?.data?.[0]?.current_period_end;
 let paidThrough=b.subscriptionId===s.id?b.paidThrough:null;
 // A subscription marked active or trialing is insufficient: verify a paid, non-zero invoice.
 if(s.latest_invoice){
   const invoice=typeof s.latest_invoice==="string"?await stripeRequest<any>({method:"GET",path:"/v1/invoices/"+encodeURIComponent(s.latest_invoice)}):s.latest_invoice;
   const invoiceCustomer=typeof invoice.customer==="string"?invoice.customer:invoice.customer?.id;
   const invoiceSub=invoice.subscription??invoice.parent?.subscription_details?.subscription;
   if(invoiceCustomer!==b.customerId||!!invoice.livemode!==isLive||invoiceSub!==s.id)throw new Error("Invoice ownership mismatch");
   if(invoice.status==="paid"&&invoice.paid!==false&&Number(invoice.amount_paid)>0){
     const paidEnd=Math.max(0,...(invoice.lines?.data??[]).filter((l:any)=>Number(l.amount)>0&&(l.subscription===s.id||l.parent?.subscription_item_details?.subscription===s.id||l.type==="subscription")).map((l:any)=>Number(l.period?.end)||0));
     if(paidEnd)paidThrough=new Date(Math.min(paidEnd,Number(end)||paidEnd)*1000);
   }
 }
 await db.updateTable("billingAccounts").set({checkoutId:null,subscriptionId:s.id,status:s.status,periodEnd:end?new Date(end*1000):null,paidThrough,planKey:s.metadata?.planKey??null}).where("userId","=",userId).where("isLive","=",isLive).execute();
 return s.status as string;
}
