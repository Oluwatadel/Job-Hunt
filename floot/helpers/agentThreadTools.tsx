import { sql } from "./agentSql";
import { enqueueUserMessage } from "./agentCoreUtils";

// LOAD-BEARING label for cross-thread messages. floot-agents-remote parses this
// exact prefix to recover the originating thread, so keep the format stable
// (and identical to any copy in agentRemoteThreadTools).
export function crossThreadPrefix(sourceTitle: string, sourceConversationId: number): string {
  return `[Cross-thread from ${sourceTitle} (conversation ${sourceConversationId})]:`;
}

export interface ThreadToolArgs {
  thread_id?: number | string;
  thread_name?: string;
  message?: string;
  trigger_processing?: boolean;
  filter?: string;
}

// send_message_to_thread (internal): deliver a message to ANOTHER of the agent's
// threads. With trigger_processing (default true) it wakes that thread via the core
// enqueue/interrupt path — so you can kick off a thread on demand (e.g. start a
// recurring job's dedicated thread now instead of waiting for the first cron fire).
// With trigger_processing false it just drops a visible note without waking it.
// floot-agents-remote overrides this branch to also dispatch to remote-agent threads.
export async function executeSendMessageToThread(
  sourceConversationId: number,
  args: ThreadToolArgs,
): Promise<string> {
  if (!args.message) return "Error: message is required.";
  if (args.thread_id == null && !args.thread_name) {
    return "Error: provide thread_id (preferred) or thread_name.";
  }

  // Two complete, flat queries — never interpolate a nested sql`` fragment into the
  // WHERE. Under prepare:false (this pool) a nested parameterized fragment corrupts
  // $-parameter binding: the id mis-binds and the lookup matches 0 rows. Branch in JS.
  const targets = (
    args.thread_id != null
      ? ((await sql`
          SELECT id, title FROM agent_conversations
          WHERE id != ${sourceConversationId} AND id = ${Number(args.thread_id)}
          ORDER BY updated_at DESC
          LIMIT 1
        `) as unknown as Array<{ id: number; title: string | null }>)
      : ((await sql`
          SELECT id, title FROM agent_conversations
          WHERE id != ${sourceConversationId}
            AND lower(title) LIKE lower(${"%" + (args.thread_name ?? "") + "%"})
          ORDER BY updated_at DESC
          LIMIT 1
        `) as unknown as Array<{ id: number; title: string | null }>)
  );
  const target = targets[0];
  if (!target) {
    return `No thread found matching ${args.thread_id != null ? `id ${args.thread_id}` : `name "${args.thread_name}"`}.`;
  }

  const srcRows = (await sql`
    SELECT title FROM agent_conversations WHERE id = ${sourceConversationId} LIMIT 1
  `) as unknown as Array<{ title: string | null }>;
  const sourceTitle = srcRows[0]?.title || `Thread ${sourceConversationId}`;
  const prefixed = `${crossThreadPrefix(sourceTitle, sourceConversationId)} ${args.message}`;

  // Default to waking the target — the common case is "kick that thread off now".
  if (args.trigger_processing !== false) {
    // enqueueUserMessage claims the thread if idle, or injects as an interrupt if
    // it is mid-turn (core two-table staging handles both).
    await enqueueUserMessage(target.id, prefixed);
    return `Message sent to ${target.title ?? `Thread ${target.id}`} and processing triggered.`;
  }
  // Display-only: drop a visible row without waking the thread.
  await sql`
    INSERT INTO agent_messages (conversation_id, role, text, history_items)
    VALUES (${target.id}, 'model', ${prefixed}, ${sql.json([{ role: "assistant", content: prefixed }])})
  `;
  return `Message delivered to ${target.title ?? `Thread ${target.id}`} (no processing triggered).`;
}

// list_threads: enumerate the agent's threads so it can pick a target.
export async function executeListThreads(args: ThreadToolArgs): Promise<string> {
  // Two complete, flat queries (filtered vs not). Never interpolate a nested or empty
  // sql`` fragment into the middle: under prepare:false it corrupts parameter binding
  // (an empty fragment even produces a syntax error at "$1"). Branch in JS instead.
  type ThreadRow = {
    id: number;
    title: string | null;
    telegram_chat_id: string | null;
    is_main_thread: boolean;
    status: string;
  };
  const filter = args.filter && args.filter.trim();
  const threads = (
    filter
      ? ((await sql`
          SELECT id, title, telegram_chat_id, is_main_thread, status
          FROM agent_conversations
          WHERE lower(title) LIKE lower(${"%" + filter + "%"})
          ORDER BY updated_at DESC
          LIMIT 20
        `) as unknown as ThreadRow[])
      : ((await sql`
          SELECT id, title, telegram_chat_id, is_main_thread, status
          FROM agent_conversations
          ORDER BY updated_at DESC
          LIMIT 20
        `) as unknown as ThreadRow[])
  );

  // Thread "kind" is derived, not stored. The remote/recurring satellite tables only
  // exist when those sub-skills (floot-agents-remote / -scheduling) are loaded, so
  // probe with to_regclass and skip the lookup when absent — this keeps list_threads
  // correct, and surfaces the same type the model needs, regardless of what's loaded.
  const tableExists = async (name: string): Promise<boolean> => {
    const r = (await sql`SELECT to_regclass(${"public." + name}) IS NOT NULL AS present`) as unknown as Array<{ present: boolean }>;
    return !!(r[0] && r[0].present);
  };

  const remoteNames = new Map<number, string>();
  if (await tableExists("remote_agents")) {
    const rows = (await sql`
      SELECT local_conversation_id, name FROM remote_agents
      WHERE is_active = true AND local_conversation_id IS NOT NULL
    `) as unknown as Array<{ local_conversation_id: number; name: string }>;
    for (const r of rows) remoteNames.set(r.local_conversation_id, r.name);
  }

  const recurringIds = new Set<number>();
  if (await tableExists("agent_recurring_jobs")) {
    const rows = (await sql`
      SELECT DISTINCT conversation_id FROM agent_recurring_jobs WHERE is_active = true
    `) as unknown as Array<{ conversation_id: number }>;
    for (const r of rows) recurringIds.add(r.conversation_id);
  }

  return JSON.stringify(
    threads.map((t) => ({
      id: t.id,
      title: t.title || `Thread ${t.id}`,
      type: remoteNames.has(t.id)
        ? "remote_agent"
        : t.telegram_chat_id
          ? "telegram"
          : recurringIds.has(t.id)
            ? "recurring"
            : "regular",
      remote_agent_name: remoteNames.get(t.id) || null,
      is_main_thread: t.is_main_thread,
      status: t.status,
    })),
  );
}