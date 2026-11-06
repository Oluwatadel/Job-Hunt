import { createHmac,timingSafeEqual } from "crypto";
// Server-only worker credential derived from the managed JWT secret.
// No credential is embedded in source. Existing embedded worker keys are retired.
export function isAuthorizedIngestRequest(request:Request):boolean {
 const root=process.env.JWT_SECRET;
 const value=request.headers.get("x-ingest-secret");
 if(!root||!value)return false;
 const expected=createHmac("sha256",root).update("job-hunt-ingest-v1").digest("hex");
 const a=Buffer.from(value),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
