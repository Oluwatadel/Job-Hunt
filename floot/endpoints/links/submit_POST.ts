import { db } from "../../helpers/db";
import { serverAccess as a } from "../../helpers/serverAccess";
import { publish } from "@floot/realtime";
import { channels } from "../../helpers/realtimeChannels";
import { z } from "zod";import superjson from "superjson";
export async function handle(request:Request){try{const u=await a.current(request);const i=z.object({url:z.string().url().refine(v=>new URL(v).protocol==="https:"),note:z.string().max(3000).nullish()}).parse(superjson.parse(await request.text()));
 const count=await db.selectFrom("submittedLinks").select(db.fn.countAll().as("n")).where("userId","=",u.id).where("status","=","pending").executeTakeFirstOrThrow();if(Number(count.n)>=20)a.fail("You already have 20 queued links. Process those first.",429);
 const r=await db.insertInto("submittedLinks").values({userId:u.id,url:i.url,note:i.note??null,status:"pending"}).returningAll().executeTakeFirstOrThrow();
 await publish(channels.links(u.id),{type:"created"});return a.json(r);
}catch(e){return a.error(e);}}