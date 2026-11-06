// helpers/agentHandoff.tsx
//
// HUMAN TAKEOVER — the supervisor-side half of escalation. The model-facing tool
// is ONLY ask_supervisor (helpers/agentSupervisor): the agent asks and halts; the
// SUPERVISOR picks the shape in the dashboard:
//   - Answer (supervisor/answer): the answer becomes the tool result, the agent
//     resumes and keeps handling the user — and the Q→A pair is saved to memory
//     so the agent learns for next time (see agentSupervisor).
//   - Take over (supervisor/reply, or supervisor/handoff status 'human'): the
//     human joins the thread and chats with the user DIRECTLY. The agent's
//     pending round (everything since the last user message) is cancelled and
//     removed, pending questions are superseded, and the send-endpoint gate
//     mutes the agent until the thread is handed back.
//
// State: agent_conversations.handoff_status (setup DDL): 'ai' | 'human' |// handoffStatus: 'ai' (AI replies) | 'human' (a person replies) | 'closed'.
// "Needs attention" in the dashboard is a pending ask_supervisor question, not a
// separate status. The mute lives in the send endpoints — no turn-step edits.
import { sql } from "./agentSql";
import { publish } from "@floot/realtime";
import { pushMessage, pushDone, notifyConversation } from "./realtimePublish";
import { enqueueUserMessage, formatUserMessageHistory } from "./agentCoreUtils";

export type HandoffStatus = "ai" | "human" | "closed";

async function notifyHandoff(): Promise<void> {
  try {
    await publish("handoff-requests", { type: "invalidate" });
  } catch (err) {
    console.error("agentHandoff: publish failed", err);
  }
}

// The send-endpoint gate: where should an inbound user message go?
// Missing column (pre-migration) -> 'ai' for compat. While an ask_supervisor
// question is pending the gate still says 'ai' — enqueueUserMessage stages the
// message as a normal interrupt, delivered when the agent resumes.
export async function getHandoffGate(conversationId: number): Promise<"ai" | "record_only" | "closed"> {
  try {
    const rows = await sql<{ handoff_status: string | null }[]>`
      SELECT handoff_status FROM agent_conversations WHERE id = ${conversationId} LIMIT 1`;
    const s = rows[0]?.handoff_status;
    if (s === "closed") return "closed";
    if (s === "human") return "record_only";
    return "ai";
  } catch {
    return "ai";
  }
}

// Store a user message WITHOUT waking the agent (the muted path). Uses the same
// history formatting as enqueueUserMessage (incl. [Image N: url] lines), so if
// the thread is handed back to the AI it replays the human-handled stretch
// naturally, attachments included.
export async function recordUserMessageWithoutAgent(
  conversationId: number,
  text: string,
  opts?: { imageUrls?: string[]; metadata?: Record<string, unknown> },
): Promise<void> {
  const historyItems = formatUserMessageHistory(text, opts?.imageUrls);
  const rows = await sql`
    INSERT INTO agent_messages (conversation_id, role, text, history_items, image_urls, metadata)
    VALUES (${conversationId}, 'user', ${text}, ${sql.json(historyItems as any)},
            ${opts?.imageUrls?.length ? sql.json(opts.imageUrls as any) : null},
            ${opts?.metadata ? sql.json(opts.metadata as any) : null})
    RETURNING *`;
  await sql`UPDATE agent_conversations SET updated_at = NOW() WHERE id = ${conversationId}`;
  await pushMessage(conversationId, rows[0]);
  await notifyConversation(conversationId);
  await notifyHandoff(); // dashboard ordering/unread hints
}

// Put a human in charge, cancelling the agent's in-flight round. Idempotent —
// safe to call when already taken over. Refuses owner threads: takeover (and its
// round-DELETE) is for principal-owned support/staff threads only — an admin
// must never yank the owner's personal agent mid-turn.
export async function takeOverConversation(conversationId: number): Promise<void> {
  const conv = await sql<{ principal_kind: string | null }[]>`
    SELECT principal_kind FROM agent_conversations WHERE id = ${conversationId} LIMIT 1`;
  if (!conv[0]) throw new Error("Conversation not found");
  if (conv[0].principal_kind == null) {
    throw new Error("Cannot take over an owner thread — takeover is for principal-owned (support/staff) conversations only.");
  }
  // 1. Supersede pending questions. Their timeout task will no-op (it claims
  //    status='pending' only) and a racing answer loses its conditional claim.
  const superseded = await sql<{ id: number }[]>`
    UPDATE agent_pending_approvals
    SET status = 'superseded', result = 'A human agent took over the conversation.', completed_at = now()
    WHERE conversation_id = ${conversationId} AND status = 'pending' AND tool_name = 'ask_supervisor'
    RETURNING id`;

  // 2. Abort + release the loop. Flipping status away from 'processing' makes a
  //    mid-flight turn abort at its post-LLM re-check (core invariant 2), and
  //    releases the lock so a later hand-back can claim the thread again.
  await sql`
    UPDATE agent_conversations SET status = 'idle', handoff_status = 'human', updated_at = NOW()
    WHERE id = ${conversationId}`;

  // 3. Remove the PENDING AI round: model/tool rows after the last user message.
  //    Only when a round is actually unresolved (a question was just superseded,
  //    or a NULL-history tracking row exists) — a COMPLETED round is history, not
  //    pending; leave it. Deleting the whole round (not just the tracking row)
  //    keeps replayed history valid: no assistant tool_calls without results.
  //    (The user's UI may have already displayed the removed assistant text; it
  //    disappears on the next full history fetch.)
  const lastUser = await sql<{ id: number }[]>`
    SELECT id FROM agent_messages
    WHERE conversation_id = ${conversationId} AND role = 'user'
    ORDER BY id DESC LIMIT 1`;
  if (lastUser[0]) {
    const tracking = await sql<{ id: number }[]>`
      SELECT id FROM agent_messages
      WHERE conversation_id = ${conversationId} AND role = 'tool' AND history_items IS NULL
        AND id > ${lastUser[0].id} LIMIT 1`;
    if (superseded.length > 0 || tracking[0]) {
      await sql`
        DELETE FROM agent_messages
        WHERE conversation_id = ${conversationId} AND id > ${lastUser[0].id}
          AND role IN ('model', 'tool')`;
    }
  }

  // 4. Surface user messages still stuck in the staging queue (sent while the
  //    question was pending) so the human sees them; the agent stays asleep.
  const queued = await sql<{ text: string | null; image_urls: any; metadata: any }[]>`
    DELETE FROM agent_message_queue WHERE conversation_id = ${conversationId}
    RETURNING text, image_urls, metadata`;
  for (const q of queued) {
    if (q.text) {
      await recordUserMessageWithoutAgent(conversationId, q.text, {
        imageUrls: Array.isArray(q.image_urls) ? q.image_urls : undefined,
        metadata: q.metadata ?? undefined,
      });
    }
  }

  await pushDone(conversationId);
  await notifyHandoff();
  await notifyConversation(conversationId);
}

// A human agent's reply. Takes over first (cancels any pending AI round), then
// inserts the reply as role 'model' + assistant history (if the AI later
// resumes, human replies read as the assistant's own voice — one continuous
// support persona), tagged metadata.senderType='human_agent' so display shows
// the person's name.
export async function adminReplyToConversation(
  conversationId: number,
  text: string,
  senderName?: string | null,
): Promise<void> {
  const conv = await sql<{ handoff_status: string | null }[]>`
    SELECT handoff_status FROM agent_conversations WHERE id = ${conversationId} LIMIT 1`;
  if (conv[0]?.handoff_status !== "human") {
    await takeOverConversation(conversationId);
  }
  const rows = await sql`
    INSERT INTO agent_messages (conversation_id, role, text, history_items, metadata)
    VALUES (${conversationId}, 'model', ${text},
            ${sql.json([{ role: "assistant", content: text }] as any)},
            ${sql.json({ senderType: "human_agent", senderName: senderName ?? null } as any)})
    RETURNING *`;
  await sql`UPDATE agent_conversations SET updated_at = NOW() WHERE id = ${conversationId}`;
  await pushMessage(conversationId, rows[0]);
  await notifyConversation(conversationId);
  await notifyHandoff();
}

// Supervisor dashboard status control: take over ('human' — full round-cancel),
// close ('closed'), or hand BACK to the AI ('ai' — injects a [System] note so
// the agent picks up context from the replayed history and wakes it).
export async function setHandoffStatus(conversationId: number, status: HandoffStatus): Promise<void> {
  if (status === "human") {
    await takeOverConversation(conversationId);
    return;
  }
  await sql`
    UPDATE agent_conversations SET handoff_status = ${status}, updated_at = NOW()
    WHERE id = ${conversationId}`;
  await notifyHandoff();
  await notifyConversation(conversationId);
  if (status === "ai") {
    await enqueueUserMessage(
      conversationId,
      "[System] A human agent handled this conversation until now and has handed it back to you. Read the recent messages above for context and continue helping the user seamlessly. Do not mention the handoff mechanics.",
    );
  }
}
