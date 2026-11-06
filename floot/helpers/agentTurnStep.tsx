import { sql } from "./agentSql";
import { pushMessage, pushDone } from "./realtimePublish";
import { flootAi, FlootAiOutOfCreditsError } from "@floot/ai";
import { queueTask } from "@floot/queueTask";
import { AGENT_TOOLS_OPENAI } from "./agentTools";
import { SYSTEM_INSTRUCTIONS, buildConversationContext } from "./agentSystemInstructions";
import { processRegularToolCall } from "./agentToolExecutor";
import {
  cleanupDanglingToolCalls,
  getConversationHistory,
  tryDequeueAndProcess,
  checkAndInjectInterrupt,
  markConversationError,
  formatToolResultsHistory,
} from "./agentCoreUtils";
import { checkAndInjectMemoryUpdates } from "./checkAndInjectMemoryUpdates";

// The model returns tool_calls in OpenAI Chat Completions shape: { id, function: { name, arguments(string) } }.
// `arguments` is sometimes invalid JSON (stray unescaped backslashes), so on
// a parse failure we re-escape stray backslashes and retry once (mirrors
// sanitizeToolCallArgsInHistory) before giving up and falling back to {}.
function normalizeToolCall(call: any) {
  let input: any = {};
  const raw: string | undefined = call.function?.arguments;
  if (raw) {
    try {
      input = JSON.parse(raw);
    } catch {
      try {
        const repaired = raw.replace(/\\./gs, (m: string) =>
          '"\\/bfnrtu'.includes(m[1]) ? m : "\\" + m,
        );
        input = JSON.parse(repaired);
      } catch {
        console.error("Failed to parse tool arguments (after re-escape retry):", raw);
      }
    }
  }
  return { id: call.id, name: call.function?.name, input };
}

export async function agentTurnStep({
  conversationId,
  iteration,
}: {
  conversationId: number;
  iteration: number;
}) {
  // 1. Heartbeat (updated_at = now) so a reactivation can tell this turn ran.
  await sql`UPDATE agent_conversations SET updated_at = NOW() WHERE id = ${conversationId}`;

  // 2. HALT (return WITHOUT re-queuing) if any async child is outstanding.
  //    The child's completion callback re-queues this step. Re-queuing here
  //    while a child runs would double-drive the conversation.
  //    Sub-skills add these tables: subagents, approvals, run_code.
  try {
    const halt = await sql`
      SELECT 1 FROM agent_subagent_runs
        WHERE conversation_id = ${conversationId} AND status = 'running' LIMIT 1
    `;
    if (halt.length > 0) return;
  } catch { /* table may not exist until floot-agents-subagents is loaded */ }
  try {
    const halt = await sql`
      SELECT 1 FROM agent_pending_approvals
        WHERE conversation_id = ${conversationId} AND status = 'pending' LIMIT 1
    `;
    if (halt.length > 0) return;
  } catch { /* table added by floot-agents-telegram */ }

  // 3. Everything from here on (history/context build through the LLM call and
  //    persistence) is inside the main try so a failure in ANY of these steps —
  //    not just the LLM call — hits the catch and calls markConversationError,
  //    instead of leaving the conversation wedged in 'processing'.
  try {
    await cleanupDanglingToolCalls(conversationId);

    // Cross-thread memory broadcast: insert any [Memory Update] rows BEFORE loading
    // history so the freshly-inserted rows are picked up by getConversationHistory.
    await checkAndInjectMemoryUpdates(conversationId);

    const { history, lastCompactionId, compactionSummary } =
      await getConversationHistory(conversationId);

    // Cached system context: rebuild only when missing or stale vs compaction.
    const convRows = await sql`
      SELECT context_snapshot, snapshot_compaction_id FROM agent_conversations WHERE id = ${conversationId}
    `;
    let contextSnapshot: string | null = convRows[0]?.context_snapshot ?? null;
    const snapshotCompactionId = convRows[0]?.snapshot_compaction_id ?? 0;
    if (!contextSnapshot || (lastCompactionId > 0 && lastCompactionId !== snapshotCompactionId)) {
      contextSnapshot = await buildConversationContext(conversationId);
      await sql`
        UPDATE agent_conversations
        SET context_snapshot = ${contextSnapshot}, snapshot_compaction_id = ${lastCompactionId}
        WHERE id = ${conversationId}
      `;
    }

    // 4. EXACTLY ONE LLM call, raced against a 600s timeout. Large-context
    // calls (~90k tokens) can legitimately take 4-5 min, and @floot/ai
    // compaction only kicks in near 200k tokens — keep this well above that
    // window but under the Lambda budget (900s minus tool-execution headroom).
    const LLM_TIMEOUT_MS = 600_000;
    const r: any = await Promise.race([
      flootAi.chat({
        model: "glm-5",
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTIONS + "\n\n" + contextSnapshot },
          ...(compactionSummary ? [{ role: "system", content: compactionSummary }] : []),
          ...history,
        ] as any,
        tools: AGENT_TOOLS_OPENAI as any,
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: 32000,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("LLM call timed out after 10 minutes.")), LLM_TIMEOUT_MS),
      ),
    ]);

    // Compaction: when @floot/ai auto-compacts, mark a historical row so future
    // history loads slice from there. (Full marker-placement logic lives in
    // floot-agents-loop-internals; this minimal version marks the oldest recent turn.)
    if (r.flootCompaction?.applied && r.flootCompaction.summaryMessage?.content) {
      const recent = await sql`
        SELECT id, metadata FROM agent_messages
        WHERE conversation_id = ${conversationId} AND role IN ('user','model')
        ORDER BY id DESC LIMIT 20
      `;
      const oldest = recent[recent.length - 1];
      if (oldest) {
        const merged = { ...(typeof oldest.metadata === "object" && oldest.metadata ? oldest.metadata : {}), compactionSummary: r.flootCompaction.summaryMessage.content };
        await sql`UPDATE agent_messages SET has_compaction = true, metadata = ${sql.json(merged)} WHERE id = ${oldest.id}`;
      }
    }

    // 5. INVARIANT 2 — re-read status AFTER the slow call. If a stop/reactivate
    //    flipped it away from 'processing', abort WITHOUT persisting.
    const statusRows = await sql`SELECT status FROM agent_conversations WHERE id = ${conversationId}`;
    if (statusRows[0]?.status !== "processing") {
      console.log(`Turn aborted: conversation ${conversationId} status=${statusRows[0]?.status}`);
      return;
    }

    const message = r.choices?.[0]?.message;
    if (!message) throw new Error("No message returned from model");

    const textOutput = (message.content || "").trim();
    const rawToolCalls = message.tool_calls || [];
    const normalizedToolCalls = rawToolCalls.map(normalizeToolCall);
    // Some models emit complete_exchange — rename to end_conversation_round.
    for (const c of normalizedToolCalls) {
      if (c.name === "complete_exchange") c.name = "end_conversation_round";
    }

    // Persist the assistant turn as ONE row + push it (coarse, one row per turn).
    const insertedRows = await sql`
      INSERT INTO agent_messages (conversation_id, role, text, thinking, tool_calls, history_items)
      VALUES (
        ${conversationId}, 'model', ${textOutput || null}, ${message.reasoning || null},
        ${normalizedToolCalls.length ? sql.json(normalizedToolCalls as any) : null},
        ${sql.json([{ role: "assistant", content: textOutput || null,
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
          ...(rawToolCalls.length ? { tool_calls: rawToolCalls } : {}) }] as any)}
      )
      RETURNING *
    `;
    const insertedModelMsg = insertedRows[0];
    await pushMessage(conversationId, insertedModelMsg);

    // 6a. NO tool calls -> the loop ENDS. Go idle, signal done, drain any queue.
    if (normalizedToolCalls.length === 0) {
      await sql`UPDATE agent_conversations SET status = 'idle', updated_at = NOW() WHERE id = ${conversationId}`;
      await pushDone(conversationId);
      await tryDequeueAndProcess(conversationId);
      return;
    }

    // 6b. Tool calls present. (Dangerous/async tools — subagents, run_code,
    //     approvals — are partitioned out and HALT the loop in their sub-skills.
    //     This core path runs regular tools in parallel and re-queues.)
    const executedResults = await Promise.all(
      normalizedToolCalls.map((call: any) => processRegularToolCall(call, conversationId)),
    );
    const resultHistoryItems = formatToolResultsHistory(executedResults);

    const toolRows = await sql`
      INSERT INTO agent_messages (conversation_id, role, tool_results, history_items)
      VALUES (${conversationId}, 'tool', ${sql.json(executedResults as any)}, ${sql.json(resultHistoryItems as any)})
      RETURNING *
    `;
    await pushMessage(conversationId, toolRows[0]);

    await checkAndInjectInterrupt(conversationId);

    // INVARIANT 1 — re-queue the NEXT turn. iteration is informational.
    await queueTask("agentBackgroundStep", { conversationId, iteration: iteration + 1 });
  } catch (error) {
    if (error instanceof FlootAiOutOfCreditsError) {
      await markConversationError(conversationId, "AI features are temporarily unavailable. Please check credits.");
    } else {
      console.error("Agent turn error:", String((error as any)?.message || error));
      await markConversationError(conversationId, String((error as any)?.message || error));
    }
  }
}
