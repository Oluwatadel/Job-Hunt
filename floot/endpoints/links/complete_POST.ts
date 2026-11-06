// floot:external
import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";
import { schema } from "./complete_POST.schema";import superjson from "superjson";import { publish } from "@floot/realtime";import { channels } from "../../helpers/realtimeChannels";
export async function handle(request:Request){try{const u=await a.actor(request);const i=schema.parse(superjson.parse(await request.text()));
 if(i.resultDocId){const app=await db.selectFrom("applications").select("id").where("userId","=",u.id).where("docId","=",i.resultDocId).executeTakeFirst();if(!app)a.fail("Application not found.",404);}
 const r=await db.updateTable("submittedLinks").set({status:i.status,resultDocId:i.resultDocId??null,note:i.note??null,processedAt:new Date()}).where("id","=",String(i.id)).where("userId","=",u.id).returningAll().executeTakeFirst();
 if(!r)a.fail("Link not found.",404);await publish(channels.links(u.id),{type:"updated"});return a.json(r);
}catch(e){return a.error(e);}}