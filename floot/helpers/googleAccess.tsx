import { db } from "./db";
import { getGoogleAccessToken } from "@floot/google-integrations";
import { serverAccess as a } from "./serverAccess";
export const googleAccess = {
 async connection(userId:number){
 const c=await db.selectFrom("googleConnections").selectAll().where("userId","=",userId).executeTakeFirst();
 if(!c)a.fail("Connect your Google account first.",409);return c;
 },
 async token(userId:number){const c=await this.connection(userId);try{return {...await getGoogleAccessToken(db,c.email),connection:c};}catch{a.fail("Reconnect your Google account.",409);}},
 async file(userId:number,kind:string){
 const d=await db.selectFrom("userDocuments").selectAll().where("userId","=",userId).where("kind","=",kind).executeTakeFirst();if(!d)a.fail("Upload your "+kind+" PDF first.",409);
 const t=await this.token(userId);if(t.email!==d.googleEmail)a.fail("Reconnect the Google account holding this file.",409);
 const r=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(d.driveFileId)+"?alt=media",{headers:{Authorization:"Bearer "+t.access_token}});
 if(!r.ok)a.fail("The Drive file could not be read. Check Google connection and file access.",409);
 const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>3*1024*1024)a.fail("Use a PDF under 3MB.");
 return {document:d,bytes};
 },
 async upload(userId:number,kind:string,filename:string,bytes:Buffer){
 const t=await this.token(userId);let folder=t.connection.folderId;
 if(!folder){
 const r=await fetch("https://www.googleapis.com/drive/v3/files?fields=id",{method:"POST",headers:{Authorization:"Bearer "+t.access_token,"Content-Type":"application/json"},body:JSON.stringify({name:"Job Hunt documents",mimeType:"application/vnd.google-apps.folder"})});if(!r.ok)a.fail("Unable to create your Drive folder.");folder=(await r.json()).id;
 await db.updateTable("googleConnections").set({folderId:folder}).where("userId","=",userId).execute();
 }
 const boundary="jobhunt_"+crypto.randomUUID();
 const metadata={name:filename,mimeType:"application/pdf",parents:[folder]};
 const body=Buffer.concat([Buffer.from("--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify(metadata)+"\r\n--"+boundary+"\r\nContent-Type: application/pdf\r\n\r\n"),bytes,Buffer.from("\r\n--"+boundary+"--")]);
 const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",{method:"POST",headers:{Authorization:"Bearer "+t.access_token,"Content-Type":"multipart/related; boundary="+boundary},body});
 if(!r.ok)a.fail("Google Drive upload failed. Your previous document is unchanged.",409);
 const result=await r.json();if(!result.id)a.fail("Drive did not confirm the upload.");
 const values={userId,kind,googleEmail:t.email,driveFileId:result.id,filename,contentType:"application/pdf",sizeBytes:bytes.length,createdAt:new Date()};
 return db.insertInto("userDocuments").values(values).onConflict(oc=>oc.columns(["userId","kind"]).doUpdateSet(values)).returningAll().executeTakeFirstOrThrow();
 }
};