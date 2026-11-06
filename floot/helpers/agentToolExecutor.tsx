import { sql } from "./agentSql";
import { agentSqlExecutor } from "./agentSqlExecutor";
import { notifyMemories } from "./realtimePublish";
import { executeSendMessageToThread, executeListThreads } from "./agentThreadTools";

// Strips injected mode markers ([SUBAGENT MODE] / <subagent-mode/>) from the front
// of a task string. floot-agents-subagents imports this to clean a delegated task
// before handing it to a sub-run.
export function sanitizeSubagentTask(task: string): string {
  if (typeof task !== "string") return String(task || "");
  let current = task;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/^\[SUBAGENT MODE\]\s*/i, "");
    current = current.replace(/^<subagent-mode\s*\/>\s*/i, "");
  }
  return current;
}

// Returns the contract the turn loop expects. richContent lets a tool return
// image blocks (data URLs) the model can see; output is the text fallback.
export async function processRegularToolCall(
  call: { id: string; name: string; input: any },
  conversationId: number,
): Promise<{ call_id: string; output: string; richContent?: any[] }> {
  try {
    const args = call.input || {};

    const executeRegularTool = async (): Promise<string> => {
      if (call.name === "run_sql") {
        // INTERNAL agents only. agentSqlExecutor has NO allow/deny list.
        const res = await agentSqlExecutor(args.query);
        return JSON.stringify(res);
      }

      if (call.name === "create_memory") {
        const inserted = await sql`
          INSERT INTO agent_memories (title, content, parent_memory_id)
          VALUES (${args.title}, ${args.content}, ${args.parent_id || null}) RETURNING id
        `;
        const memoryId = inserted[0].id;
        // Read-tracking upsert keeps cross-thread memory freshness consistent
        // (see floot-agents-memory). Requires UNIQUE(conversation_id, memory_id).
        await sql`
          INSERT INTO conversation_memory_reads (conversation_id, memory_id, read_at)
          VALUES (${conversationId}, ${memoryId}, NOW())
          ON CONFLICT (conversation_id, memory_id) DO UPDATE SET read_at = NOW()
        `;
        await notifyMemories();
        return `Memory #${memoryId} created.`;
      }

      if (call.name === "read_memory") {
        const rows = await sql`SELECT * FROM agent_memories WHERE id = ${args.id}`;
        const mem = rows[0];
        if (!mem) return `Memory #${args.id} not found.`;
        const children = await sql`SELECT id, title FROM agent_memories WHERE parent_memory_id = ${args.id}`;
        await sql`
          INSERT INTO conversation_memory_reads (conversation_id, memory_id, read_at)
          VALUES (${conversationId}, ${args.id}, NOW())
          ON CONFLICT (conversation_id, memory_id) DO UPDATE SET read_at = NOW()
        `;
        return JSON.stringify({ id: mem.id, title: mem.title, content: mem.content, parent_id: mem.parent_memory_id, children });
      }

      if (call.name === "update_memory") {
        await sql`
          UPDATE agent_memories
          SET title = COALESCE(${args.title ?? null}, title),
              content = COALESCE(${args.content ?? null}, content),
              updated_at = NOW()
          WHERE id = ${args.id}
        `;
        await sql`
          UPDATE conversation_memory_reads SET read_at = NOW()
          WHERE memory_id = ${args.id} AND conversation_id = ${conversationId}
        `;
        await notifyMemories();
        return `Memory #${args.id} updated.`;
      }

      if (call.name === "delete_memory") {
        // Single-row delete; children removed by the self-FK ON DELETE CASCADE.
        await sql`DELETE FROM agent_memories WHERE id = ${args.id}`;
        await notifyMemories();
        return `Memory #${args.id} deleted.`;
      }

      if (call.name === "search_memories") {
        const q = `%${(args.query ?? "").trim()}%`;
        const rows = await sql`
          SELECT id, title, parent_memory_id, left(content, 200) AS snippet
          FROM agent_memories
          WHERE title ILIKE ${q} OR content ILIKE ${q}
          ORDER BY (parent_memory_id IS NULL) DESC, updated_at DESC
          LIMIT 25
        `;
        return JSON.stringify(rows);
      }

      if (call.name === "move_memory") {
        const newParent = args.parent_id ?? null;
        if (newParent !== null) {
          if (Number(newParent) === Number(args.id)) return "Error: a memory cannot be its own parent.";
          const cycle = await sql`
            WITH RECURSIVE sub AS (
              SELECT id FROM agent_memories WHERE id = ${args.id}
              UNION ALL
              SELECT m.id FROM agent_memories m JOIN sub ON m.parent_memory_id = sub.id
            )
            SELECT 1 FROM sub WHERE id = ${newParent} LIMIT 1
          `;
          if (cycle.length > 0) return "Error: cannot move a memory under one of its own descendants.";
        }
        const moved = await sql`
          UPDATE agent_memories SET parent_memory_id = ${newParent}, updated_at = NOW()
          WHERE id = ${args.id} RETURNING id
        `;
        if (moved.length === 0) return `Error: memory #${args.id} not found.`;
        await notifyMemories();
        return `Memory #${args.id} moved ${newParent === null ? "to top level" : "under #" + newParent}.`;
      }

      if (call.name === "update_standing_instructions") {
        const content = (args.content || "").slice(0, 4000);
        const convId: number | null = args.thread_id ? Number(args.thread_id) : null;
        if (content === "") {
          if (convId === null) await sql`DELETE FROM standing_instructions WHERE conversation_id IS NULL`;
          else await sql`DELETE FROM standing_instructions WHERE conversation_id = ${convId}`;
          // Force the cached context snapshot to rebuild on the next turn.
          if (convId === null) await sql`UPDATE agent_conversations SET context_snapshot = NULL`;
          else await sql`UPDATE agent_conversations SET context_snapshot = NULL WHERE id = ${convId}`;
          return "Standing instructions cleared.";
        }
        // check-then-upsert (no unique constraint on conversation_id by default).
        const existing = convId === null
          ? await sql`SELECT id FROM standing_instructions WHERE conversation_id IS NULL LIMIT 1`
          : await sql`SELECT id FROM standing_instructions WHERE conversation_id = ${convId} LIMIT 1`;
        if (existing[0]) {
          await sql`UPDATE standing_instructions SET content = ${content}, updated_at = NOW() WHERE id = ${existing[0].id}`;
        } else {
          await sql`INSERT INTO standing_instructions (conversation_id, content) VALUES (${convId}, ${content})`;
        }
        if (convId === null) await sql`UPDATE agent_conversations SET context_snapshot = NULL`;
        else await sql`UPDATE agent_conversations SET context_snapshot = NULL WHERE id = ${convId}`;
        return convId === null ? "Updated global standing instructions." : `Updated standing instructions for thread ${convId}.`;
      }

      if (call.name === "list_threads") {
        return await executeListThreads(args);
      }
      if (call.name === "send_message_to_thread") {
        return await executeSendMessageToThread(conversationId, args);
      }
      if (call.name === "view_image") {
        // glm-5 (the main model) is text-only; delegate image understanding to a
        // vision-capable model (glm-5-flash) and return its description.
        const instruction = args.instruction || "Describe what you see in this image in detail.";
        try {
          const { flootAi, FlootAiOutOfCreditsError } = await import("@floot/ai");
          try {
            const r: any = await Promise.race([
              flootAi.chat({
                model: "glm-5-flash",
                messages: [{ role: "user", content: [
                  { type: "text", text: instruction },
                  { type: "image_url", image_url: { url: args.url } },
                ] }] as any,
                // glm-5-flash always thinks first — leave room for the description.
                max_tokens: 16384,
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Image analysis timed out")), 55000)),
            ]);
            return r.choices?.[0]?.message?.content || "No description returned from the vision model.";
          } catch (err) {
            if (err instanceof FlootAiOutOfCreditsError) return "Image analysis is temporarily unavailable (AI credits).";
            throw err;
          }
        } catch (err) {
          return `Failed to analyze image: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      if (call.name === "view_pdf") {
        // glm-5 (the main model) is text-only and can't read documents; route the PDF
        // to gpt-6-luna (Responses API `input_file`, native PDF reading) and return its answer.
        const instruction = args.instruction || "Summarize this document and extract its key information.";
        try {
          const { flootAi, FlootAiOutOfCreditsError } = await import("@floot/ai");
          try {
            const r: any = await Promise.race([
              flootAi.chat({
                model: "gpt-6-luna",
                input: [{ type: "message", role: "user", content: [
                  { type: "input_file", file_url: args.url },
                  { type: "input_text", text: instruction },
                ] }],
              } as any),
              new Promise((_, reject) => setTimeout(() => reject(new Error("PDF analysis timed out")), 55000)),
            ]);
            const text = (r.output ?? [])
              .filter((o: any) => o.type === "message")
              .flatMap((o: any) => o.content ?? [])
              .filter((c: any) => c.type === "output_text" && typeof c.text === "string")
              .map((c: any) => c.text).join("\n").trim();
            return text || "No content returned from the document model.";
          } catch (err) {
            if (err instanceof FlootAiOutOfCreditsError) return "PDF analysis is temporarily unavailable (AI credits).";
            throw err;
          }
        } catch (err) {
          return `Failed to analyze PDF: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      return "Tool executed.";
    };

    // Each tool branch is bounded by a 60s timeout.
    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("Tool execution timed out")), 60000),
    );
    const result = await Promise.race([executeRegularTool(), timeoutPromise]);
    return { call_id: call.id, output: result };
  } catch (err) {
    return { call_id: call.id, output: JSON.stringify({ error: String(err) }) };
  }
}
