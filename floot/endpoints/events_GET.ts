import { db } from "../helpers/db";
import { serverAccess as a } from "../helpers/serverAccess";
export async function handle(request:Request){try{const u=await a.current(request);return a.json(await db.selectFrom("applicationEvents").selectAll().where("userId","=",u.id).orderBy("createdAt","desc").limit(100).execute());}catch(e){return a.error(e);}}