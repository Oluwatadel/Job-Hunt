import { sql } from "./agentSql";

// ============================================================================
// PLACEHOLDER PERSONA — REPLACE THIS ENTIRE STRING for your app.
// This is a single giant template literal: persona + every behavioral rule.
// It is NOT composed from the tool list, so keep tool descriptions and these
// rules in sync by hand. The memory carve-out (never run_sql on agent_memories)
// and the no-markdown-tables rule are load-bearing; keep their intent.
// ============================================================================
export const SYSTEM_INSTRUCTIONS = `You are a helpful personal assistant agent. Check your memories for the user's detailed preferences. You maintain a lightweight memory hierarchy: top-level memories act as an index (shown in context), and linked memories hold detail (reached via the read_memory tool).

## Response
Always start with a brief text acknowledgment alongside your first round of tool calls so the user gets immediate feedback (e.g., 'Let me look into that!').

## Interrupts
Messages marked with [Interrupt: ...] are user messages sent while you were working. Address the interrupt first. If the user says stop, finish immediately. Otherwise handle it and continue your previous work.

## Memory Organization & Hygiene
Use the dedicated memory tools: create_memory, read_memory, update_memory, move_memory, search_memories, delete_memory. Do NOT use run_sql for memory operations.
- Memories form a tree: a memory without a parent is top-level (shown in context). A memory with a parent_id is a child.
- Top-level memories act as category indexes; their titles and IDs are shown in context.
- To see a top-level memory's content and its children, use read_memory.
- Before creating a new memory, use search_memories to find any existing or duplicate memory, and prefer updating it (or move_memory to reorganize) over creating a duplicate.
- Deleting a memory automatically deletes all its children.

## Standing Instructions
You have standing instructions — permanent behavioral rules always in your context. Use update_standing_instructions to set or update them. Global instructions apply everywhere; per-thread instructions override the global for a specific thread. Pass empty content to clear.

## Database Access
(INTERNAL agents only) Full read/write access via run_sql (use snake_case). Do NOT use run_sql for the agent_memories table; use the dedicated memory tools instead.

## Formatting
Do NOT use markdown tables — they don't render well in all channels.`;

export async function getMainThreadId(): Promise<number | null> {
  const rows = await sql`SELECT id FROM agent_conversations WHERE is_main_thread = true LIMIT 1`;
  return rows[0]?.id ?? null;
}

// Builds the cached [Context Update] block. Renders the resolved standing
// instruction (per-thread row if present, else global) then ONLY the titles+ids
// of top-level memories (the INDEX — never their content). Sub-skills append
// their own sections here (recurring tasks, follow-ups, remote agents, collections).
export async function buildConversationContext(conversationId: number): Promise<string> {
  let context = `[Context Update]\n`;

  // Standing instruction: per-thread overrides global (NULL conversation_id).
  let si = await sql`SELECT content FROM standing_instructions WHERE conversation_id = ${conversationId} LIMIT 1`;
  if (si.length === 0) {
    si = await sql`SELECT content FROM standing_instructions WHERE conversation_id IS NULL LIMIT 1`;
  }
  if (si[0]?.content) {
    context += `\n## Standing Instructions\n${si[0].content}\n`;
  }

  // Top-level memory INDEX: titles + ids ONLY. The agent calls read_memory for content.
  const topLevel = await sql`
    SELECT id, title FROM agent_memories WHERE parent_memory_id IS NULL ORDER BY title ASC
  `;
  if (topLevel.length > 0) {
    context += `\n## Your Memories\nThese are your top-level memories; they act as an index. Use read_memory to view contents and children.\n`;
    for (const m of topLevel) context += `- ${m.title} (id: ${m.id})\n`;
  }

  return context.trim();
}
