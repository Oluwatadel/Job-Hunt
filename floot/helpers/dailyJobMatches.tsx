import { db } from "./db";
import { queueTask } from "@floot/queueTask";
import { serverAccess } from "./serverAccess";
export async function dailyJobMatches(){
 const users=await db.selectFrom("searchProfiles").innerJoin("users","users.id","searchProfiles.userId").select(["users.id","users.accessUntil"]).where("dailyEnabled","=",true).where("disabled","=",false).execute();
 for(const user of users)if(await serverAccess.paid(user))await queueTask("searchUserJobs",{userId:user.id},{concurrency:5,onError:"searchUserFailed"});
}
