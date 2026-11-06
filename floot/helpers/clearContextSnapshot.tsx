import { sql } from "./agentSql";

// Clears the cached agent_conversations.context_snapshot so the next turn rebuilds
// it. Used after a standing instruction is saved or deleted (the context block
// renders the resolved standing instruction).
//
// - conversationId provided: only that conversation's snapshot is cleared.
// - conversationId undefined (a GLOBAL standing instruction): all conversations'
//   snapshots are cleared, since the global instruction is the fallback for any
//   thread without its own override.
//
// floot-agents-memory's standing-instructions save endpoint imports this from
// ../../helpers/clearContextSnapshot.
export async function clearContextSnapshotForConversations(
  conversationId?: number,
): Promise<void> {
  if (conversationId !== undefined) {
    await sql`UPDATE agent_conversations SET context_snapshot = NULL WHERE id = ${conversationId}`;
  } else {
    await sql`UPDATE agent_conversations SET context_snapshot = NULL`;
  }
}
