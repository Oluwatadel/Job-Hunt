import { agentCore } from "./agentCore";

// queueTask handler. The platform routes the string "agentBackgroundStep"
// (passed to queueTask(...)) to THIS file's export of the same name. There is
// no registry in server.ts (server.ts is generated) — the file basename + the
// exported function name being identical to the task name IS the wiring.
export async function agentBackgroundStep(payload: {
  conversationId: number;
  iteration?: number;
}) {
  await agentCore.agentBackgroundStep({
    conversationId: payload.conversationId,
    iteration: payload.iteration ?? 0,
  });
}
