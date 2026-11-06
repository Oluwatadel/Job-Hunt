import { db } from "../helpers/db";
import { serverAccess as a } from "../helpers/serverAccess";
export async function handle(request:Request){try{
 const user=await a.actor(request);
 return a.json(await db.selectFrom("applications").selectAll().where("userId","=",user.id).orderBy("updatedAt","desc").execute());
}catch(e){return a.error(e);}}