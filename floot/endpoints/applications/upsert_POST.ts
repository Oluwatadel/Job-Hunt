// floot:external — authenticated automation and the signed-in user's workspace.
import { serverAccess as a } from "../../helpers/serverAccess";
import { saveApplication } from "../../helpers/saveApplication";
import superjson from "superjson";
export async function handle(request:Request){try{return a.json(await saveApplication(await a.actor(request),superjson.parse(await request.text())));}catch(e){return a.error(e);}}