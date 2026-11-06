import { sql } from "./agentSql";
import { queueTask } from "@floot/queueTask";
import { formatToolResultsHistory, markConversationError } from "./agentCoreUtils";

// Stall recovery is MANUAL. updated_at is a heartbeat, but nothing automatically
// sweeps stale 'processing' rows. Recovery runs only when a user clicks
// 'Reactivate' (shown on error status). We inspect outstanding async children,
// cancel dead ones with synthesized tool results, re-derive iteration by counting
// model messages, set processing, and re-queue.
export async function reactivateStalledAgent(conversationId: number) {
  await sql`
    UPDATE agent_conversations SET status = 'processing', error_message = NULL, updated_at = NOW()
    WHERE id = ${conversationId}
  `;

  // If subagents are 'running', resume them (handled by floot-agents-subagents).
  let runningSubagents: any[] = [];
  try {
    runningSubagents = await sql`
      SELECT id FROM agent_subagent_runs WHERE conversation_id = ${conversationId} AND status = 'running'
    `;
  } catch { /* table not present */ }

  if (runningSubagents.length > 0) {
    for (const run of runningSubagents) {
      const iterRes = await sql`
        SELECT count(id)::int AS count FROM agent_subagent_messages WHERE run_id = ${run.id} AND role = 'model'
      `;
      try {
        await queueTask("agentSubagentStep", { runId: run.id, iteration: Number(iterRes[0]?.count || 0) });
      } catch (err) {
        console.error("Failed to reactivate subagent:", err);
      }
    }
    return;
  }

  // If a run_code execution is wedged 'running', cancel it, synthesize its tool
  // result, and resume the main loop. (run_code tables come from the runCode skill.)
  let stalledRunCode: any[] = [];
  try {
    stalledRunCode = await sql`
      SELECT * FROM agent_run_code_executions WHERE conversation_id = ${conversationId} AND status = 'running'
    `;
  } catch { /* table not present */ }

  if (stalledRunCode.length > 0) {
    const parentMsgId = stalledRunCode[0].parent_message_id;
    await sql`
      UPDATE agent_run_code_executions
      SET status = 'error', error = 'Execution stalled and cancelled', completed_at = NOW()
      WHERE conversation_id = ${conversationId} AND status = 'running'
    `;
    if (parentMsgId) {
      const allTasks = await sql`SELECT * FROM agent_run_code_executions WHERE parent_message_id = ${parentMsgId}`;
      const toolResults = allTasks.map((t: any) => ({ call_id: t.call_id, output: t.result || String(t.error) }));

      const trackingRows = await sql`
        SELECT metadata FROM agent_messages
        WHERE conversation_id = ${conversationId} AND role = 'tool' AND history_items IS NULL AND id > ${parentMsgId}
        ORDER BY id ASC LIMIT 1
      `;
      let preComputed: any[] = [];
      const meta = trackingRows[0]?.metadata;
      if (meta && typeof meta === "object" && "preComputedToolResults" in meta) {
        preComputed = (meta as any).preComputedToolResults || [];
      }
      const normalizedPre = preComputed.map((p: any) => ({ call_id: p.call_id || p.callId, output: p.output }));
      const combined = [...normalizedPre, ...toolResults];
      const historyItems = formatToolResultsHistory(combined);
      await sql`
        INSERT INTO agent_messages (conversation_id, role, tool_results, history_items)
        VALUES (${conversationId}, 'tool', ${sql.json(combined as any)}, ${sql.json(historyItems as any)})
      `;
    }
    try {
      await queueTask("agentBackgroundStep", { conversationId, iteration: 0 });
    } catch (err) {
      await markConversationError(conversationId, "Failed to reactivate run_code: " + String(err));
    }
    return;
  }

  // No outstanding children: re-derive iteration by counting model messages
  // (the original counter is lost) and re-queue a fresh turn.
  const iterRes = await sql`
    SELECT count(id)::int AS count FROM agent_messages WHERE conversation_id = ${conversationId} AND role = 'model'
  `;
  try {
    await queueTask("agentBackgroundStep", { conversationId, iteration: Number(iterRes[0]?.count || 0) });
  } catch (err) {
    await markConversationError(conversationId, "Failed to reactivate: " + String(err));
  }
}
