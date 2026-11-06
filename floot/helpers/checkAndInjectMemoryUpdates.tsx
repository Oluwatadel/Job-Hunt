import { sql } from "./agentSql";
import { pushMessage } from "./realtimePublish";
import { formatUserMessageHistory } from "./agentCoreUtils";

function formatRelativeTime(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ============================================================================
// Cross-thread / cross-session memory freshness (owned by core). agentTurnStep
// calls this BEFORE getConversationHistory so the [Memory Update] row it inserts
// is picked up by the same turn's history load. Two tiers:
//
// Tier A (full-content): memories this conversation HAS read (a row in
//   conversation_memory_reads) whose am.updated_at > cmr.read_at. Surfaced inline
//   with their latest content — so the agent need not re-call read_memory — and
//   read_at is bumped for them.
//
// Tier B (name-only broadcast): memories updated since this conversation's
//   watermark (agent_conversations.last_memory_broadcast_at) that this
//   conversation has NEVER read (NOT EXISTS in conversation_memory_reads).
//   Surfaced TITLE-only with a "call read_memory(id)" nudge. NOT marked read; the
//   watermark is always advanced to checkTime so the nudge does not repeat. They
//   flow through Tier A once the agent actually reads them.
//
// The NOT EXISTS clause makes the two sets mutually exclusive (Tier A requires a
// read-row; Tier B requires none), so no extra dedup is needed.
//
// Requires agent_conversations.last_memory_broadcast_at (TIMESTAMPTZ) — it lives on
// the core agent_conversations table. The agent_memories / conversation_memory_reads
// tables are also core-owned (their DDL ships in this skill's setup guidance).
// Returns the injected history items (or null if nothing was stale/new).
// ============================================================================
export async function checkAndInjectMemoryUpdates(
  conversationId: number,
): Promise<unknown[] | null> {
  // Snapshot the check time once: it bounds the Tier-B query and becomes the new watermark.
  const checkTime = new Date();

  // (A) Full-content set: memories this conversation HAS read but are now stale.
  let stale: { id: number; title: string; content: string; updated_at: Date }[] = [];
  let watermark: Date = new Date(0);
  let newUnread: { id: number; title: string; updated_at: Date }[] = [];

  try {
    stale = (await sql`
      SELECT am.id, am.title, am.content, am.updated_at
      FROM conversation_memory_reads cmr
      JOIN agent_memories am ON cmr.memory_id = am.id
      WHERE cmr.conversation_id = ${conversationId}
        AND am.updated_at > cmr.read_at
    `) as any;

    // (B) Watermark for the name-only broadcast (NULL => epoch => broadcast all unread once).
    const convRows = await sql`
      SELECT last_memory_broadcast_at FROM agent_conversations WHERE id = ${conversationId}
    `;
    watermark = convRows[0]?.last_memory_broadcast_at
      ? new Date(convRows[0].last_memory_broadcast_at as unknown as string)
      : new Date(0);

    // (C) Name-only set: updated since the watermark (and at/older than checkTime) and NEVER
    // read by this conversation. NOT EXISTS makes this mutually exclusive with Tier A above.
    newUnread = (await sql`
      SELECT am.id, am.title, am.updated_at
      FROM agent_memories am
      WHERE am.updated_at > ${watermark}
        AND am.updated_at <= ${checkTime}
        AND NOT EXISTS (
          SELECT 1 FROM conversation_memory_reads cmr
          WHERE cmr.conversation_id = ${conversationId}
            AND cmr.memory_id = am.id
        )
      ORDER BY am.updated_at DESC
    `) as any;
  } catch {
    // agent_memories / conversation_memory_reads exist once the memory DDL is run;
    // until then this is a harmless no-op.
    return null;
  }

  // (D) Always advance the watermark so name-only nudges are not repeated every turn.
  await sql`
    UPDATE agent_conversations
    SET last_memory_broadcast_at = ${checkTime}
    WHERE id = ${conversationId}
  `;

  if (stale.length === 0 && newUnread.length === 0) return null;

  const lines: string[] = [];
  const memoryIds: number[] = [];

  if (stale.length > 0) {
    lines.push(
      `[Memory Update: The following memories were updated since you last read them. ` +
        `This is the latest content — no need to call read_memory again for these.]`,
    );
    for (const row of stale) {
      memoryIds.push(row.id);
      const rel = formatRelativeTime(new Date(row.updated_at));
      lines.push(`\nTitle: ${row.title} (id: ${row.id}) — Updated: ${rel}`);
      lines.push(`Content: ${row.content}`);
    }
  }

  if (newUnread.length > 0) {
    lines.push(
      `\n[Memory Update: These memories were created or updated and you have NOT read them. ` +
        `Their content is not shown here — call read_memory(id) for any that are relevant to your current task.]`,
    );
    for (const row of newUnread) {
      const rel = formatRelativeTime(new Date(row.updated_at));
      lines.push(`- ${row.title} (id: ${row.id}) — Updated: ${rel}`);
    }
  }

  const text = lines.join("\n");
  const historyItems = formatUserMessageHistory(text);

  const inserted = await sql`
    INSERT INTO agent_messages (conversation_id, role, text, history_items, metadata)
    VALUES (
      ${conversationId}, 'user', ${text},
      ${sql.json(historyItems as any)}, ${sql.json({ type: "memory_update" })}
    )
    RETURNING id
  `;

  // Only bump read_at for the Tier-A (already-read) memories. Tier-B memories are
  // intentionally NOT marked read — the watermark dedups them, and they should still
  // flow through the Tier-A path once the agent actually reads them.
  if (memoryIds.length > 0) {
    await sql`
      UPDATE conversation_memory_reads
      SET read_at = NOW()
      WHERE conversation_id = ${conversationId}
        AND memory_id = ANY(${memoryIds})
    `;
  }

  await pushMessage(conversationId, {
    id: inserted[0]?.id,
    conversation_id: conversationId,
    role: "user",
    text,
  });

  return historyItems;
}
