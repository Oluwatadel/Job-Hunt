/** New document uploads use each user's Google Drive. Legacy Floot storage must be migrated separately. */
export async function getUrl(_params:unknown){return {ok:false as const,url:'',error:{message:'This legacy Floot file was not migrated. Upload its PDF to your own connected Google Drive.'}};}
export async function remove(_params:unknown){return {ok:false,error:{message:'Legacy Floot storage is managed in Floot.'}};}
