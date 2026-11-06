import { sql } from "./agentSql";
import { queueTask } from "@floot/queueTask";
import { publish } from "@floot/realtime";
import { pushMessage, notifyConversationsList, notifyConversationStatus } from "./realtimePublish";

export type ChatMessage = { role: string; content: any; [k: string]: any };

// ---- history formatting ---------------------------------------------------

export function formatToolResultsHistory(
  results: { call_id: string; output: string; richContent?: any[] }[],
): ChatMessage[] {
  return results.map((tr) => ({
    role: "tool",
    tool_call_id: tr.call_id,
    content: tr.richContent || tr.output,
  }));
}

// Default timezone for timestamps shown to the model. Do not hardcode a real
// timezone here — capture the user's IANA timezone (e.g. from the browser) and
// persist it, then thread it through. See the Timezone note in the floot-agents skill.
const DEFAULT_TZ = "UTC";

export function formatUserMessageHistory(text: string, imageUrls?: string[], timezone: string = DEFAULT_TZ): ChatMessage[] {
  const currentTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(new Date());
  const textWithTime = `[Current time: ${currentTime}]\n\n${text}`;

  if (imageUrls && imageUrls.length > 0) {
    // glm-5 is text-only — pass image URLs as text and let the agent call the
    // view_image tool (vision via glm-5-flash) to actually see one. Do NOT send
    // image_url content parts to a text-only main model.
    const imageList = imageUrls.map((url, i) => `[Image ${i + 1}: ${url}]`).join("\n");
    return [{ role: "user", content: `${textWithTime}\n\n${imageList}\n\n(Use the view_image tool to analyze any of these images.)` }];
  }
  return [{ role: "user", content: textWithTime }];
}

// OpenAI Chat Completions tool-call arguments arrive as a string that may be invalid JSON.
// Re-escape stray backslashes before the provider replays history, or it rejects it.
export function sanitizeToolCallArgsInHistory(history: any[]): any[] {
  for (const item of history) {
    if (Array.isArray(item.tool_calls)) {
      for (const call of item.tool_calls) {
        if (call.function && typeof call.function.arguments === "string") {
          try {
            JSON.parse(call.function.arguments);
          } catch {
            call.function.arguments = call.function.arguments.replace(/\\./gs, (m: string) =>
              '"\\/bfnrtu'.includes(m[1]) ? m : "\\" + m,
            );
          }
        }
      }
    }
  }
  return history;
}

// Strips provider-hosted-tool blocks (server_tool_use / web_search_tool_result /
// code_execution_tool_result) from assistant content before replaying history.
// A no-op for a loop with no hosted tools, but correct + future-proof if you
// later route a turn through a hosted-tool provider. floot-agents-subagents imports
// this to clean its forked history.
export function filterServerSideBlocks(history: any[]): any[] {
  let filteredCount = 0;
  const newHistory: any[] = [];

  for (const item of history) {
    if (item.role === "assistant" && Array.isArray(item.content)) {
      const newContent = item.content.filter((block: any) => {
        const isServerSide = [
          "server_tool_use",
          "web_search_tool_result",
          "code_execution_tool_result",
        ].includes(block.type);
        if (isServerSide) {
          filteredCount++;
          return false;
        }
        return true;
      });
      if (newContent.length > 0) newHistory.push({ ...item, content: newContent });
    } else {
      newHistory.push(item);
    }
  }

  if (filteredCount > 0) {
    console.log(`Filtered ${filteredCount} server-side blocks from history replay`);
  }
  return newHistory;
}

// Recursively rewrites camelCase object keys back to snake_case. Used to normalize
// history items that an ORM/serializer may have camelCased before replay.
// floot-agents-subagents imports this to normalize its forked history.
export function restoreSnakeCaseKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(restoreSnakeCaseKeys);
  } else if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        newObj[snakeKey] = restoreSnakeCaseKeys(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}

// ---- conversation status helpers ------------------------------------------

export async function markConversationError(conversationId: number, message: string) {
  await sql`
    UPDATE agent_conversations
    SET status = 'error', error_message = ${message}, updated_at = NOW()
    WHERE id = ${conversationId}
  `;
  try {
    await publish(`conversation:${conversationId}`, { type: "status", status: "error", errorMessage: message });
  } catch (err) {
    console.error(`Failed to publish error status for ${conversationId}:`, err);
  }
  await notifyConversationsList();
}

async function generateTitleIfNeeded(conversationId: number, firstText: string) {
  const rows = await sql`SELECT title FROM agent_conversations WHERE id = ${conversationId}`;
  const conv = rows[0];
  if (conv && !conv.title) {
    const newTitle = firstText.length > 40 ? firstText.slice(0, 40) + "..." : firstText;
    await sql`UPDATE agent_conversations SET title = ${newTitle} WHERE id = ${conversationId}`;
    await notifyConversationsList();
  }
}

// ---- INVARIANT 3: two-table staging entry point ---------------------------
// EVERY inbound path (user msg, schedule, telegram, cross-thread, remote) calls
// this. It stages into agent_message_queue, then tries to claim the conversation.
export async function enqueueUserMessage(
  conversationId: number,
  text: string,
  opts?: { imageUrls?: string[]; metadata?: Record<string, unknown>; role?: "user" | "model" },
): Promise<void> {
  const imageUrls = opts?.imageUrls;
  const metadata = opts?.metadata ?? null;
  const role = opts?.role ?? "user";
  const historyItems = formatUserMessageHistory(text, imageUrls);

  await generateTitleIfNeeded(conversationId, text);

  await sql`
    INSERT INTO agent_message_queue (conversation_id, role, text, history_items, image_urls, metadata)
    VALUES (
      ${conversationId}, ${role}, ${text},
      ${sql.json(historyItems as any)},
      ${imageUrls ? sql.json(imageUrls as any) : null},
      ${metadata ? sql.json(metadata as any) : null}
    )
  `;

  await tryDequeueAndProcess(conversationId);
}

// ---- INVARIANT 2: atomic claim. ONE transaction. ---------------------------
export async function tryDequeueAndProcess(conversationId: number): Promise<void> {
  let shouldQueue = false;

  try {
    await sql.begin(async (tx) => {
      // 1. Claim ONE queued message exclusively (SKIP LOCKED so concurrent
      //    sends never grab the same row).
      const claimed = await tx`
        SELECT id FROM agent_message_queue
        WHERE conversation_id = ${conversationId}
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (claimed.length === 0) return;
      const queuedMsgId = claimed[0].id;

      // 2. Atomically flip status idle/error -> processing. 0 rows = BUSY:
      //    a turn is already running, leave the message queued (interrupt).
      const flipped = await tx`
        UPDATE agent_conversations
        SET status = 'processing', updated_at = NOW(), error_message = NULL
        WHERE id = ${conversationId} AND status IN ('idle', 'error')
        RETURNING id
      `;
      if (flipped.length === 0) throw new Error("CONVERSATION_BUSY");

      // 3. Promote the staged row into real history (INSERT ... SELECT).
      await tx`
        INSERT INTO agent_messages (conversation_id, role, text, history_items, image_urls, metadata)
        SELECT conversation_id, role, text, history_items, image_urls, metadata
        FROM agent_message_queue WHERE id = ${queuedMsgId}
      `;

      // 4. Delete from the queue.
      await tx`DELETE FROM agent_message_queue WHERE id = ${queuedMsgId}`;

      shouldQueue = true;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONVERSATION_BUSY") return; // stays queued
    throw error;
  }

  if (shouldQueue) {
    // We just won the claim — tell the thread + sidebar the conversation is busy.
    await notifyConversationStatus(conversationId, "processing");
    const latest = await sql`
      SELECT * FROM agent_messages
      WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT 1
    `;
    if (latest[0]) await pushMessage(conversationId, latest[0]);
    try {
      // newChain: this turn is its own task tree with the full budget, not a
      // child of whoever woke it (another thread's tool call, the previous
      // turn draining the queue). As a child it would get a share of that
      // caller's leftover budget, and a thread woken late in a chain of
      // hand-offs would fail with "budget exhausted" after a few steps. The
      // turn's own next steps stay ordinary children (INVARIANT 1).
      await queueTask("agentBackgroundStep", { conversationId, iteration: 0 }, { newChain: true });
    } catch (err) {
      await markConversationError(conversationId, "Failed to queue agent task: " + String(err));
    }
  }
}

// ---- interrupt injection (drain queue AFTER a tool batch) -------------------
// Inserts each queued interrupt as a real history row, then pushMessages each so
// the injected interrupt streams to the client like any other turn message.
export async function checkAndInjectInterrupt(conversationId: number): Promise<boolean> {
  let injected = false;
  const insertedInterruptMsgs: any[] = [];

  await sql.begin(async (tx) => {
    const queued = await tx`
      SELECT id, text, image_urls, metadata FROM agent_message_queue
      WHERE conversation_id = ${conversationId}
      ORDER BY id ASC FOR UPDATE SKIP LOCKED
    `;
    for (const msg of queued) {
      const prefix =
        "[Interrupt: The user sent a new message while you were working. Address it first. If the user wants you to stop, finish immediately. Otherwise handle their message and then continue your previous task if appropriate.]\n\n";
      const newText = prefix + msg.text;
      const historyItems = formatUserMessageHistory(newText);
      const insertedRows = await tx`
        INSERT INTO agent_messages (conversation_id, role, text, history_items, image_urls, metadata)
        VALUES (${conversationId}, 'user', ${newText}, ${sql.json(historyItems as any)},
                ${msg.image_urls ? sql.json(msg.image_urls) : null},
                ${msg.metadata ? sql.json(msg.metadata) : null})
        RETURNING *
      `;
      insertedInterruptMsgs.push(insertedRows[0]);
      await tx`DELETE FROM agent_message_queue WHERE id = ${msg.id}`;
      injected = true;
    }
  });

  for (const m of insertedInterruptMsgs) {
    await pushMessage(conversationId, m);
  }

  return injected;
}

// ---- history load (slice from last compaction marker) ----------------------
export async function getConversationHistory(conversationId: number): Promise<{
  history: ChatMessage[];
  lastCompactionId: number;
  compactionSummary: string | null;
}> {
  const compactionRows = await sql`
    SELECT id, metadata FROM agent_messages
    WHERE conversation_id = ${conversationId} AND has_compaction = true
    ORDER BY id DESC LIMIT 1
  `;
  const lastCompaction = compactionRows[0];
  const fromId = lastCompaction?.id ?? 0;

  let compactionSummary: string | null = null;
  const meta = lastCompaction?.metadata;
  if (meta && typeof meta === "object" && "compactionSummary" in meta) {
    compactionSummary = (meta as any).compactionSummary || null;
  }

  const messages = await sql`
    SELECT * FROM agent_messages
    WHERE conversation_id = ${conversationId} AND id >= ${fromId}
    ORDER BY id ASC
  `;

  // history_items IS NULL = a 'tracking' tool row whose async child hasn't
  // resolved yet — skip it (it is not replayable to the model).
  const history: ChatMessage[] = [];
  for (const m of messages) {
    if (!m.history_items) continue;
    const items = m.history_items;
    if (Array.isArray(items)) history.push(...items);
    else history.push(items);
  }

  return {
    // filterServerSideBlocks is a no-op without hosted tools but keeps history
    // replay correct if a turn ever runs through a hosted-tool provider.
    history: sanitizeToolCallArgsInHistory(filterServerSideBlocks(history)),
    lastCompactionId: fromId,
    compactionSummary,
  };
}

// Remove a trailing model row that has tool_calls but no following tool results
// (a half-finished prior turn) before starting a new turn.
export async function cleanupDanglingToolCalls(conversationId: number): Promise<void> {
  const rows = await sql`
    SELECT id, role, tool_calls FROM agent_messages
    WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT 1
  `;
  const last = rows[0];
  if (last?.role === "model" && Array.isArray(last.tool_calls) && last.tool_calls.length > 0) {
    await sql`DELETE FROM agent_messages WHERE id = ${last.id}`;
  }
}
