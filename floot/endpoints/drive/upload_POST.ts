import { serverAccess as a } from "../../helpers/serverAccess";import { googleAccess } from "../../helpers/googleAccess";import { z } from "zod";
export async function handle(request:Request){try{const u=await a.current(request);const form=await request.formData();const kind=z.enum(["cv","resume"]).parse(form.get("kind"));const file=form.get("file");
 if(!(file instanceof File)||file.size<5||file.size>3*1024*1024)a.fail("Choose a PDF under 3MB.");
 const bytes=Buffer.from(await file.arrayBuffer());if(bytes.subarray(0,5).toString()!=="%PDF-")a.fail("Only PDF documents are supported.");
 return a.json(await googleAccess.upload(u.id,kind,file.name.slice(0,200),bytes));
}catch(e){return a.error(e);}}