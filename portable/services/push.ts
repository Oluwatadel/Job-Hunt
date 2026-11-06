import webPush from 'web-push';
export async function sendPushNotifications(subscriptions:any[],message:any){
 if(!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_PUBLIC_KEY)return subscriptions.map(()=>({ok:false,gone:false,error:{message:'Browser push is not configured.'}}));
 webPush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
 return Promise.all(subscriptions.map(async s=>{try{if(!s.endpoint)return {ok:false,gone:false};await webPush.sendNotification(s,JSON.stringify(message));return {ok:true,gone:false};}catch(e:any){return {ok:false,gone:[404,410].includes(e.statusCode)};}}));
}
