import { db } from "../helpers/db";
import { serverAccess as a } from "../helpers/serverAccess";
export async function handle(request:Request){try{const u=await a.actor(request);return a.json(await db.selectFrom("submittedLinks").selectAll().where("userId","=",u.id).orderBy("createdAt","desc").execute());}catch(e){return a.error(e);}}