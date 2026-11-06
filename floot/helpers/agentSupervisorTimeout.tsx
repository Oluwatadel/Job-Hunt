// helpers/agentSupervisorTimeout.tsx
//
// queueTask handler (name === file basename === exported fn, per the core wiring
// contract). Fires SUPERVISOR_TIMEOUT_MS after a question is created: if it is
// still pending, resume the agent WITHOUT an answer so an external user is never
// wedged on a slow supervisor. The result text instructs the model to keep
// helping and promise a human follow-up; a late answer still arrives via
// answerSupervisorQuestion's [System] inject path.
import { sql } from "./agentSql";
import { notifyConversation } from "./realtimePublish";
import { resumeAfterSupervisorAnswers } from "./agentSupervisor";

export async function agentSupervisorTimeout({ questionId }: { questionId: number }) {
  const claimed = await sql<{ conversation_id: number; parent_message_id: number }[]>`
    UPDATE agent_pending_approvals
    SET status = 'timed_out',
        result = 'The supervisor has not answered yet. Do not keep waiting and do not ask again: continue helping the user as best you can, and let them know a human will follow up with an answer. You will be notified automatically if the supervisor answers later.',
        completed_at = now()
    WHERE id = ${questionId} AND status = 'pending'
    RETURNING conversation_id, parent_message_id`;
  const q = claimed[0];
  if (!q) return; // already answered — the answer path won the race

  await notifyConversation(q.conversation_id);
  const pending = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM agent_pending_approvals
    WHERE parent_message_id = ${q.parent_message_id} AND status = 'pending'`;
  if (Number(pending[0]?.count ?? 0) === 0) {
    await resumeAfterSupervisorAnswers(q.conversation_id, q.parent_message_id);
  }
}
