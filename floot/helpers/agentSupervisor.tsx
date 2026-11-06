// helpers/agentSupervisor.tsx
//
// ask_supervisor — the halt-and-resume escalation tool. The agent asks its human
// supervisor a free-text question; the conversation HALTS (the core loop's
// pending-approvals guard keeps it halted); the supervisor answers in the
// dashboard (endpoints/supervisor/*); the answer becomes the tool result and the
// loop resumes. This is the ask-and-wait shape of the approval engine: no
// re-executed action — the typed answer IS the result.
//
// Storage reuses agent_pending_approvals (tool_name='ask_supervisor',
// tool_args={question}, result=answer, status 'pending'|'answered'|'timed_out') so
// the core turn step's existing halt guard covers it with NO core edits, and so a
// mixed batch (an approval + a supervisor question) gates resume on the WHOLE
// batch exactly like floot-agents-telegram. If that skill is also loaded, both
// engines share the table safely — answer ask_supervisor rows ONLY via
// answerSupervisorQuestion (never approve/reject).
import { sql } from "./agentSql";
import { queueTask } from "@floot/queueTask";
import { publish } from "@floot/realtime";
import { enqueueUserMessage, checkAndInjectInterrupt, formatToolResultsHistory } from "./agentCoreUtils";
import { pushMessage, notifyConversation, notifyMemories } from "./realtimePublish";

// How long a question stays open before the agent is resumed WITHOUT an answer
// (with instructions to keep helping and promise a human follow-up). A late answer
// still reaches the agent via the [System] inject path below.
const SUPERVISOR_TIMEOUT_MS = 30 * 60 * 1000;

// Append this to AGENT_TOOLS in helpers/agentTools (AGENT_TOOLS_OPENAI derives
// automatically). It is defined here so the schema and the machinery ship together.
export const ASK_SUPERVISOR_TOOL = {
  name: "ask_supervisor",
  description:
    "Escalate to your human supervisor and wait. This is THE escalation tool — use it both when you need information, permission, or a decision you cannot make yourself (policy exceptions, refunds, anything outside your instructions) AND when the user asks to talk to a person or the request needs a human. The conversation pauses; the supervisor will either answer your question (the tool result is their answer — continue helping the user with it) or take over the conversation directly (you will not be resumed). If the result is a timeout instead, keep helping the user, tell them a human will follow up, and do not call this again for the same question.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The complete, self-contained question or handover summary for the supervisor. Include all context they need (who is asking, what was requested, relevant details) — they cannot see your reasoning.",
      },
    },
    required: ["question"],
  },
};

async function notifySupervisorQuestions(): Promise<void> {
  try {
    await publish("supervisor-questions", { type: "invalidate" });
  } catch (err) {
    console.error("agentSupervisor: publish failed", err);
  }
}

// Called from the turn step when the tool batch contains ask_supervisor call(s).
// Inserts the tracking row FIRST (role='tool', history_items = NULL — the async-child
// sentinel; an answer can never race ahead of the row the resume path needs), then
// one pending row per question, then a timeout task each. The caller HALTS
// (returns without re-queuing) after this resolves.
export async function holdForSupervisorQuestions(opts: {
  conversationId: number;
  parentMessageId: number;
  supervisorCalls: { id: string; name: string; input: any }[];
  executedResults: { call_id: string; output: string }[]; // sync siblings from the same batch
}): Promise<void> {
  const placeholders = opts.supervisorCalls.map((c) => ({ call_id: c.id, output: "pending_supervisor_answer" }));
  const trackingRows = await sql`
    INSERT INTO agent_messages (conversation_id, role, tool_results, history_items, metadata)
    VALUES (${opts.conversationId}, 'tool',
            ${sql.json([...opts.executedResults, ...placeholders] as any)}, NULL,
            ${sql.json({ preComputedToolResults: opts.executedResults } as any)})
    RETURNING *`;
  await pushMessage(opts.conversationId, trackingRows[0]);

  for (const call of opts.supervisorCalls) {
    const question = String(call.input?.question ?? "").slice(0, 8000);
    const inserted = await sql<{ id: number }[]>`
      INSERT INTO agent_pending_approvals
        (conversation_id, parent_message_id, call_id, tool_name, tool_args, status, source)
      VALUES (${opts.conversationId}, ${opts.parentMessageId}, ${call.id}, 'ask_supervisor',
              ${sql.json({ question } as any)}, 'pending', 'ask_supervisor')
      RETURNING id`;
    try {
      await queueTask("agentSupervisorTimeout", { questionId: inserted[0].id }, { delayMs: SUPERVISOR_TIMEOUT_MS });
    } catch (err) {
      console.error("Failed to schedule supervisor timeout:", err);
    }
  }
  await notifySupervisorQuestions();
  await notifyConversation(opts.conversationId);
}

// The supervisor's answer path (called by endpoints/supervisor/answer_POST).
// Atomically claims the question (conditional UPDATE ... RETURNING with the prior
// status captured FOR UPDATE — racing answerers / the timeout can't both win).
export async function answerSupervisorQuestion(
  questionId: number,
  answer: string,
): Promise<{ ok: boolean; message: string }> {
  const claimed = await sql<
    { conversation_id: number; parent_message_id: number; tool_args: any; prev_status: string }[]
  >`
    UPDATE agent_pending_approvals a
    SET status = 'answered', result = ${answer}, completed_at = now()
    FROM (SELECT id, status FROM agent_pending_approvals
          WHERE id = ${questionId} AND tool_name = 'ask_supervisor' FOR UPDATE) prev
    WHERE a.id = prev.id AND prev.status IN ('pending', 'timed_out')
    RETURNING a.conversation_id, a.parent_message_id, a.tool_args, prev.status AS prev_status`;
  const q = claimed[0];
  if (!q) return { ok: false, message: "Question not found or already answered." };

  await notifySupervisorQuestions();
  await notifyConversation(q.conversation_id);

  // LEARN from the answer: persist the Q→A pair as a child memory under a
  // "Supervisor guidance" index node, so the agent stops re-asking (the index is
  // in every turn's context; content is read on demand / broadcast when stale).
  // Deterministic and server-side — no extra LLM call, and no memory-write tool
  // needed on untrusted surfaces. Fire-and-forget: learning must never break the
  // resume path.
  try {
    const question = String(q.tool_args?.question ?? "");
    let parent = await sql<{ id: number }[]>`
      SELECT id FROM agent_memories WHERE title = 'Supervisor guidance' AND parent_memory_id IS NULL LIMIT 1`;
    if (!parent[0]) {
      parent = await sql<{ id: number }[]>`
        INSERT INTO agent_memories (title, content)
        VALUES ('Supervisor guidance', 'Answers from the human supervisor to past agent questions. Check here before asking the supervisor again.')
        RETURNING id`;
    }
    await sql`
      INSERT INTO agent_memories (title, content, parent_memory_id)
      VALUES (${question.slice(0, 120) || "Supervisor answer"},
              ${"Q: " + question + "\n\nA: " + answer}, ${parent[0].id})`;
    await notifyMemories();
  } catch (err) {
    console.error("agentSupervisor: learning write failed", err);
  }

  if (q.prev_status === "timed_out") {
    // The loop already resumed with a timeout result and consumed the tracking row.
    // Re-enter through the normal staging queue instead (the late-answer path).
    const question = String(q.tool_args?.question ?? "").slice(0, 500);
    await enqueueUserMessage(
      q.conversation_id,
      `[System] Your supervisor has now answered the earlier question "${question}". Answer: ${answer}`,
    );
    return { ok: true, message: "Question had timed out; the answer was injected as a new message." };
  }

  // Resume only when EVERY pending row sharing this batch is resolved (a mixed
  // batch with a telegram approval gates the same way — shared table, shared rule).
  const pending = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM agent_pending_approvals
    WHERE parent_message_id = ${q.parent_message_id} AND status = 'pending'`;
  if (Number(pending[0]?.count ?? 0) === 0) {
    await resumeAfterSupervisorAnswers(q.conversation_id, q.parent_message_id);
  }
  return { ok: true, message: "Answer delivered; the agent is resuming." };
}

// Merge preComputed sibling results + ALL resolved rows for the batch into the
// tracking row and re-queue the loop. Mirrors floot-agents-telegram's
// resumeAfterApprovals; the conditional history_items IS NULL claim means the two
// engines can coexist — exactly one resumer wins, the loser no-ops.
export async function resumeAfterSupervisorAnswers(
  conversationId: number,
  parentMessageId: number,
): Promise<void> {
  const rows = await sql<{ call_id: string; result: string | null }[]>`
    SELECT call_id, result FROM agent_pending_approvals WHERE parent_message_id = ${parentMessageId}`;
  const answerResults = rows.map((a) => ({ call_id: a.call_id, output: a.result ?? "No result" }));

  const tracking = await sql<{ id: number; metadata: any }[]>`
    SELECT id, metadata FROM agent_messages
    WHERE conversation_id = ${conversationId} AND role = 'tool' AND history_items IS NULL AND id > ${parentMessageId}
    ORDER BY id ASC LIMIT 1`;
  if (!tracking[0]) return; // already resumed, or no tracking row
  const preComputedRaw: any[] = tracking[0].metadata?.preComputedToolResults ?? [];
  const preComputed = preComputedRaw.map((p) => ({ call_id: p.call_id ?? p.callId, output: p.output }));

  const combined = [...preComputed, ...answerResults];
  const historyItems = formatToolResultsHistory(combined);

  const claimedRows = await sql<any[]>`
    UPDATE agent_messages
    SET tool_results = ${sql.json(combined as any)}, history_items = ${sql.json(historyItems as any)}
    WHERE id = ${tracking[0].id} AND history_items IS NULL
    RETURNING *`;
  if (!claimedRows[0]) return; // another resolver already resumed this batch

  await pushMessage(conversationId, claimedRows[0]);
  await checkAndInjectInterrupt(conversationId);
  try {
    await queueTask("agentBackgroundStep", { conversationId, iteration: 0 });
  } catch (err) {
    console.error("Failed to re-queue agent step after supervisor answer:", err);
  }
}
