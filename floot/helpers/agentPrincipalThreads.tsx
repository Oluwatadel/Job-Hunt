// helpers/agentPrincipalThreads.tsx
//
// The TENANCY layer: which principal owns which conversation. One mechanism for
// both multi-user shapes — internal logged-in users (kind 'user', key = the app
// user id) and widget end-users (kind 'widget', key = the verified widget
// principal key). Only the front-door auth differs; everything here is shared.
//
// Columns (see setup DDL): agent_conversations.principal_kind / principal_key.
// NULL principal = the owner's own internal threads (the pre-existing scaffold
// shape) — they are invisible to every scoped query below.
//
// The rule every endpoint must follow: the principal comes from the VERIFIED
// auth context (getServerUserSession / getWidgetPrincipal), never from a request
// field. All reads and writes here are scoped WHERE principal matches — this
// helper is what turns the "scope everything to principal.key" guidance into code.
import { sql } from "./agentSql";
import type { AgentSurface } from "./agentSurfaces";

export type ThreadPrincipal = { kind: "user" | "widget"; key: string };

export class ConversationAccessError extends Error {
  constructor(message = "Conversation not found") {
    super(message); // same message whether missing or not owned — don't leak existence
    this.name = "ConversationAccessError";
  }
}

export async function createConversationFor(
  principal: ThreadPrincipal,
  surface: AgentSurface,
  title?: string | null,
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO agent_conversations (status, title, surface, principal_kind, principal_key)
    VALUES ('idle', ${title ?? null}, ${surface}, ${principal.kind}, ${principal.key})
    RETURNING id`;
  return Number(rows[0].id);
}

// Most-recent existing thread for this principal, else a new one. The surface is
// set at creation and never changes — it comes from the endpoint's auth context.
export async function findOrCreateConversationFor(
  principal: ThreadPrincipal,
  surface: AgentSurface,
  title?: string | null,
): Promise<number> {
  const existing = await sql<{ id: number }[]>`
    SELECT id FROM agent_conversations
    WHERE principal_kind = ${principal.kind} AND principal_key = ${principal.key}
    ORDER BY id DESC LIMIT 1`;
  if (existing[0]) return Number(existing[0].id);
  return createConversationFor(principal, surface, title);
}

export async function assertConversationOwnedBy(
  principal: ThreadPrincipal,
  conversationId: number,
): Promise<void> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM agent_conversations
    WHERE id = ${conversationId}
      AND principal_kind = ${principal.kind} AND principal_key = ${principal.key}
    LIMIT 1`;
  if (!rows[0]) throw new ConversationAccessError();
}

export async function listConversationsFor(principal: ThreadPrincipal): Promise<
  { id: number; title: string | null; status: string; createdAt: Date; updatedAt: Date }[]
> {
  const rows = await sql<
    { id: number; title: string | null; status: string; created_at: Date; updated_at: Date }[]
  >`
    SELECT id, title, status, created_at, updated_at FROM agent_conversations
    WHERE principal_kind = ${principal.kind} AND principal_key = ${principal.key}
    ORDER BY updated_at DESC LIMIT 100`;
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
  }));
}

export type DisplayMessage = {
  id: number;
  // 'user' = the principal; 'assistant' = the AI; 'human_agent' = a human
  // (admin/supervisor) reply inserted via the handoff path — show senderName.
  sender: "user" | "assistant" | "human_agent";
  senderName: string | null;
  text: string;
  // Uploaded files on this message (private presigned URLs, ~24h — fine for an
  // active session; render images inline, PDFs as a link).
  attachments: { url: string; type: "image" | "pdf" }[];
  createdAt: Date;
};

// The shared display query — NO ownership check (callers gate). Deliberately narrow:
//   - only user/model rows with text — never tool_calls, tool_results, thinking,
//     or tracking rows (those expose internals, including supervisor questions)
//   - internal plumbing rows ([Cross-thread ...] steering from the master thread,
//     [Memory Update]/[System] injections) are filtered out
// sinceId makes polling cheap: pass the last id you have, get only newer rows.
export async function queryDisplayMessages(
  conversationId: number,
  sinceId = 0,
): Promise<{ status: string; handoffStatus: string; messages: DisplayMessage[] }> {
  const conv = await sql<{ status: string; handoff_status?: string }[]>`
    SELECT * FROM agent_conversations WHERE id = ${conversationId}`;
  const rows = await sql<
    { id: number; role: string; text: string; image_urls: any; metadata: any; created_at: Date }[]
  >`
    SELECT id, role, text, image_urls, metadata, created_at FROM agent_messages
    WHERE conversation_id = ${conversationId}
      AND id > ${sinceId}
      AND role IN ('user', 'model')
      AND text IS NOT NULL AND text <> ''
      AND text NOT LIKE '[Cross-thread%'
      AND text NOT LIKE '[Memory Update%'
      AND text NOT LIKE '[System]%'
    ORDER BY id ASC LIMIT 500`;
  return {
    status: conv[0]?.status ?? "idle",
    handoffStatus: conv[0]?.handoff_status ?? "ai",
    messages: rows.map((r) => {
      const attachments: { url: string; type: "image" | "pdf" }[] = [];
      if (Array.isArray(r.image_urls)) {
        for (const url of r.image_urls) attachments.push({ url: String(url), type: "image" });
      }
      const privateFiles: any[] = Array.isArray(r.metadata?.privateFiles) ? r.metadata.privateFiles : [];
      for (const f of privateFiles) {
        if (f?.type === "pdf" && f?.url) attachments.push({ url: String(f.url), type: "pdf" });
      }
      return {
        id: r.id,
        sender:
          r.role === "user" ? ("user" as const)
          : r.metadata?.senderType === "human_agent" ? ("human_agent" as const)
          : ("assistant" as const),
        senderName: r.metadata?.senderType === "human_agent" ? (r.metadata?.senderName ?? null) : null,
        text: r.text,
        attachments,
        createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      };
    }),
  };
}

// The principal-scoped wrapper the chat/widget history endpoints use. Also returns
// the conversation status (typing indicator) and handoffStatus (AI vs human mode).
export async function getDisplayMessagesFor(
  principal: ThreadPrincipal,
  conversationId: number,
  sinceId = 0,
): Promise<{ status: string; handoffStatus: string; messages: DisplayMessage[] }> {
  await assertConversationOwnedBy(principal, conversationId);
  return queryDisplayMessages(conversationId, sinceId);
}
