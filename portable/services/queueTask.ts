import { runtimeDb } from './config';
type Handler=(payload:any)=>Promise<unknown>;
let handlers:Record<string,Handler>={};
export function registerTasks(value:Record<string,Handler>){handlers=value;}
export async function queueTask(name:string,payload:unknown,options:{concurrency?:number;onError?:string}={}){
 if(!['searchUserJobs'].includes(name))throw new Error('Task is not registered for this deployment.');
 const rows=await runtimeDb()`INSERT INTO runtime_jobs(name,payload,error_handler) VALUES(${name},${runtimeDb().json(payload as any)},${options.onError||null}) RETURNING id`;
 return {ok:true,id:rows[0].id};
}
export function startWorker(){
 let active=0,stopped=false;
 async function tick(){
  if(stopped||active>=5)return;active++;
  try{
   const rows=await runtimeDb()`UPDATE runtime_jobs SET status='running',started_at=NOW(),attempts=attempts+1 WHERE id=(SELECT id FROM runtime_jobs WHERE (status='pending' OR (status='running' AND started_at<NOW()-INTERVAL '15 minutes')) AND attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
   const job=rows[0];if(!job)return;
   try{if(!handlers[job.name])throw new Error('Unknown task');await handlers[job.name](job.payload);await runtimeDb()`UPDATE runtime_jobs SET status='completed',finished_at=NOW() WHERE id=${job.id}`;}
   catch{if(job.error_handler&&handlers[job.error_handler])await handlers[job.error_handler]({payload:job.payload,error:'Background search failed.'}).catch(()=>{});await runtimeDb()`UPDATE runtime_jobs SET status='failed',finished_at=NOW() WHERE id=${job.id}`;console.error('A background search failed; see search history.');}
  }catch{console.error('Background queue database is unavailable.');}finally{active--;}
 }
 const timer=setInterval(()=>{void tick();},1000);timer.unref();void tick();return()=>{stopped=true;clearInterval(timer);};
}
