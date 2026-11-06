import { serverAccess as a } from "../../helpers/serverAccess";
import { saveApplication } from "../../helpers/saveApplication";
import { db } from "../../helpers/db";
import { z } from "zod";
import superjson from "superjson";
export async function handle(request:Request){try{
 const u=await a.current(request);const raw:any=superjson.parse(await request.text());const id=z.string().regex(/^\d+$/).parse(raw.id);
 const old=await db.selectFrom("applications").selectAll().where("userId","=",u.id).where("id","=",id).executeTakeFirst();
 if(!old)a.fail("Job not found.",404);
 return a.json(await saveApplication(u,{...old,...raw,docId:old.docId,company:old.company,role:old.role,dateApplied:undefined,lastContact:undefined}));
}catch(e){return a.error(e);}}