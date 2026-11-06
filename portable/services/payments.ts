import Stripe from 'stripe';
import { appUrl, required } from './config';
const stripe=()=>new Stripe(required('STRIPE_SECRET_KEY'));
export async function getPaymentsClientConfig(){return {publishableKey:process.env.STRIPE_PUBLISHABLE_KEY||'',isLiveMode:!!process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')};}
export async function stripeRequest<T=any>(params:{method:'GET'|'POST';path:string;params?:Record<string,unknown>;idempotencyKey?:string}):Promise<T>{
 if(!/^\/v1\/[a-z_\/0-9-]+$/i.test(params.path))throw new Error('Invalid Stripe path.');
 return await stripe().rawRequest(params.method,params.path,params.params as any,params.idempotencyKey?{idempotencyKey:params.idempotencyKey}:{}) as T;
}
export const getPaymentsReturnUrl=(_request:Request)=>new URL('/_api/payments/return',appUrl()).toString();
export async function getPaymentCallbackEventFromRequest(request:Request){
 const e=stripe().webhooks.constructEvent(Buffer.from(await request.arrayBuffer()),request.headers.get('stripe-signature')||'',required('STRIPE_WEBHOOK_SECRET'));
 const o=e.data.object as any;
 const subscriptionId=e.type.startsWith('customer.subscription.')?o.id:(typeof o.subscription==='string'?o.subscription:o.parent?.subscription_details?.subscription);
 const customerId=typeof o.customer==='string'?o.customer:o.customer?.id;
 return {eventId:e.id,type:e.type,stage:e.livemode?'prod':'dev',subscriptionId,customerId};
}
export function renderPaymentsReturnPage(request:Request){
 const id=new URL(request.url).searchParams.get('checkoutSessionId');const result={type:'PAYMENTS_RETURN',checkoutSessionId:id,paymentIntentId:null,setupIntentId:null,redirectStatus:null};
 const json=JSON.stringify(result).replace(/</g,'\\u003c');
 return new Response(`<!doctype html><html><body><p>You can close this window and return to Job Hunt.</p><a href="/billing">Return to billing</a><script>if(window.opener){window.opener.postMessage(${json},location.origin);window.close();}</script></body></html>`,{headers:{'Content-Type':'text/html','Cache-Control':'no-store'}});
}
