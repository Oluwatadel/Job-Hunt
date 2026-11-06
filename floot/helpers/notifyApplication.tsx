import { db } from "./db";import { sendPushNotifications } from "@floot/push";
export async function notifyApplication(userId:number,company:string,role:string,status:string,docId:string){
 const subs=await db.selectFrom("pushSubscriptions").select(["identity","subscription"]).where("userId","=",userId).execute();
 if(!subs.length)return;
 const r=await sendPushNotifications(subs.map(s=>s.subscription as any),{title:company+" — "+status.replace("_"," "),body:role,tag:"application-"+docId,url:"/"});
 const gone=subs.filter((_,i)=>r[i]?.gone).map(s=>s.identity);
 if(gone.length)await db.deleteFrom("pushSubscriptions").where("userId","=",userId).where("identity","in",gone).execute();
}