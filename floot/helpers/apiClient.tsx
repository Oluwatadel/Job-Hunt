import superjson from "superjson";
export async function apiClient<T=any>(path:string,body?:unknown):Promise<T>{
 const r=await fetch("/_api/"+path,{method:body===undefined?"GET":"POST",credentials:"same-origin",headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:superjson.stringify(body)});
 const data=superjson.parse<any>(await r.text());if(!r.ok)throw Object.assign(new Error(data.error||data.message||"Request failed"),{code:data.code,status:r.status});return data;
}