// floot:external
import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";
export async function handle(request:Request){try{const u=await a.actor(request);await db.updateTable("automationRequests").set({pending:false,fulfilledAt:new Date()}).where("userId","=",u.id).execute();return a.json({success:true});}catch(e){return a.error(e);}}