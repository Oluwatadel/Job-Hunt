import { publish } from "@floot/realtime";

// Backend publish wrappers for the agent (the publish side). The channel-name
// REGISTRY (helpers/realtimeChannels) and the client come from the floot-realtime
// skill — load it and add the agent's channels there. These wrappers use the same
// channel names so publisher, subscriber, and the _realtime/token grant stay aligned.
//
// COARSE realtime: one whole message row per agent turn — never token-by-token.
// All wrappers are fire-and-forget try/catch; a failed publish must never break the
// agent loop.

export async function pushMessage(conversationId: number, msg: unknown): Promise<void> {
  try {
    await publish(`conversation:${conversationId}`, { type: "msg", msg });
  } catch (err) {
    console.error(`realtimePublish: pushMessage failed for ${conversationId}`, err);
  }
}

export async function pushDone(conversationId: number): Promise<void> {
  try {
    // Double-publish on purpose: 'done' on the thread channel AND an invalidate on
    // the sidebar list so the conversations list updates when a turn finishes.
    await Promise.all([
      publish(`conversation:${conversationId}`, { type: "done" }),
      publish("conversations:list", { type: "invalidate" }),
    ]);
  } catch (err) {
    console.error(`realtimePublish: pushDone failed for ${conversationId}`, err);
  }
}

// Publish a conversation status transition (e.g. -> 'processing' on claim, 'error'
// on failure). Double-publishes: the {type:'status'} event on the thread channel AND
// a conversations:list invalidate so the sidebar reflects it live.
export async function notifyConversationStatus(
  conversationId: number,
  status: string,
  errorMessage?: string | null,
): Promise<void> {
  try {
    await Promise.all([
      publish(`conversation:${conversationId}`, {
        type: "status",
        status,
        errorMessage: errorMessage ?? null,
      }),
      publish("conversations:list", { type: "invalidate" }),
    ]);
  } catch (err) {
    console.error(`realtimePublish: notifyConversationStatus failed for ${conversationId}`, err);
  }
}

export async function notifyConversationsList(): Promise<void> {
  try {
    await publish("conversations:list", { type: "invalidate" });
  } catch (err) {
    console.error("realtimePublish: notifyConversationsList failed", err);
  }
}

export async function notifyConversation(conversationId: number): Promise<void> {
  try {
    await publish(`conversation:${conversationId}`, { type: "invalidate" });
  } catch (err) {
    console.error(`realtimePublish: notifyConversation ${conversationId} failed`, err);
  }
}

// Per-feature collection invalidations. Sub-skills publish these after writes so
// their UI panels live-refresh. Grant the matching channels in _realtime/token.
export async function notifyMemories(): Promise<void> {
  try { await publish("memories", { type: "invalidate" }); }
  catch (err) { console.error("realtimePublish: notifyMemories failed", err); }
}
export async function notifyCollections(): Promise<void> {
  try { await publish("collections", { type: "invalidate" }); }
  catch (err) { console.error("realtimePublish: notifyCollections failed", err); }
}
export async function notifyRemoteAgents(): Promise<void> {
  try { await publish("remote-agents", { type: "invalidate" }); }
  catch (err) { console.error("realtimePublish: notifyRemoteAgents failed", err); }
}
export async function notifyTelegramChats(): Promise<void> {
  try { await publish("telegram-chats", { type: "invalidate" }); }
  catch (err) { console.error("realtimePublish: notifyTelegramChats failed", err); }
}
export async function notifyRecurringJobs(): Promise<void> {
  try { await publish("recurringJobs", { type: "invalidate" }); }
  catch (err) { console.error("realtimePublish: notifyRecurringJobs failed", err); }
}
