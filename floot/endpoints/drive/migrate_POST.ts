import { db } from "../../helpers/db";import { serverAccess as a } from "../../helpers/serverAccess";import { googleAccess } from "../../helpers/googleAccess";import { getUrl,remove } from "@floot/storage";
export async function handle(request:Request){try{const u=await a.current(request);const old=await db.selectFrom("resumeFile").selectAll().where("userId","=",u.id).executeTakeFirst();if(!old)a.fail("No previous document to move.");
 const signed=await getUrl({visibility:"private",filename:old.storageKey,expiresInSeconds:60});if(!signed.ok)a.fail("Unable to read the existing document.");const r=await fetch(signed.url);if(!r.ok)a.fail("Unable to download existing file.");
 const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>3*1024*1024||bytes.subarray(0,5).toString()!=="%PDF-")a.fail("Use a PDF under 3MB.");
 const doc=await googleAccess.upload(u.id,"resume",old.originalFilename,bytes);
 await db.deleteFrom("resumeFile").where("userId","=",u.id).execute();await remove({visibility:"private",filename:old.storageKey});
 return a.json(doc);
}catch(e){return a.error(e);}}