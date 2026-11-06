import { finalizeGoogleConnection,renderConnectionPopup } from "@floot/google-integrations";
import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";
export async function handle(request:Request){try{
 const user=await a.current(request);const url=new URL(request.url);const code=url.searchParams.get("connection_code");if(!code)throw new Error("Connection canceled.");
 const c=await finalizeGoogleConnection(db,{code});
 const existing=await db.selectFrom("googleConnections").selectAll().where("email","=",c.email).executeTakeFirst();
 if(existing&&existing.userId!==user.id)throw new Error("This Google account is already connected to another workspace.");
 const own=await db.selectFrom("googleConnections").selectAll().where("userId","=",user.id).executeTakeFirst();
 if(own&&own.email!==c.email)throw new Error("Disconnect your current Google account before connecting a different one.");
 await db.insertInto("googleConnections").values({userId:user.id,email:c.email,scopes:c.scopes}).onConflict(oc=>oc.column("userId").doUpdateSet({email:c.email,scopes:c.scopes})).execute();
 return renderConnectionPopup({type:"GOOGLE_INTEGRATION_SUCCESS",email:c.email,scopes:c.scopes});
 }catch(e){return renderConnectionPopup({type:"GOOGLE_INTEGRATION_ERROR",error:e instanceof Error?e.message:"Connection failed."});}}