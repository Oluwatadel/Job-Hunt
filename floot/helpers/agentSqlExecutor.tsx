import postgres from "postgres";
import { notifyCollections } from "./realtimePublish";

// ============================================================================
// ⚠ FULL, ESSENTIALLY UNGUARDED DATABASE ACCESS.
// sql.unsafe(query) runs ARBITRARY agent-authored SQL: INSERT/UPDATE/DELETE/
// CREATE/ALTER/DROP all execute. The ONLY guardrails are a 30s timeout and the
// optional readOnly regex below. This is acceptable ONLY for an INTERNAL,
// single-trusted-owner agent. For an EXTERNAL-facing agent (public chat, support
// bot, anything a remote agent can drive) this is full data exfiltration and
// destruction — DO NOT expose run_sql / this executor to such an agent. Give it
// narrow, validated, allow-listed tools instead.
//
// Dedicated pool with prepare:false (load-bearing — required so generic /
// multi-statement SQL works). Separate from helpers/agentSql so a hung agent
// query can't starve the rest of the agent subsystem.
// ============================================================================
const sql = postgres(process.env.FLOOT_DATABASE_URL as string, {
  prepare: false,
  idle_timeout: 10,
  max: 2,
});

const WRITE_RE = /\b(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/;

export async function agentSqlExecutor(
  query: string,
  opts?: { readOnly?: boolean },
): Promise<{ rows?: any[]; rowCount?: number; error?: string; warnings?: string[] }> {
  try {
    if (opts?.readOnly && WRITE_RE.test(query.toLowerCase())) {
      return { error: "This agent has read-only database access. Write statements are blocked." };
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Query execution timed out after 30 seconds.")), 30000),
    );
    const result: any = await Promise.race([sql.unsafe(query), timeoutPromise]);

    const lowerQuery = query.toLowerCase();
    const warnings: string[] = [];

    // Post-write checks fire only when the statement writes AND mentions a
    // collection target (agent_views or a uc_ table). Cheap to skip otherwise.
    if (WRITE_RE.test(lowerQuery) && /\b(agent_views|uc_\w+)\b/.test(lowerQuery)) {
      // Refresh the /collections UI (collections are added by floot-agents-collections;
      // harmless no-op if that skill isn't loaded).
      notifyCollections().catch(console.error);

      // Warn for any CREATE TABLE uc_* that the agent forgot to register in
      // agent_views — an unregistered uc_ table is invisible in the Collections UI.
      // Checks childViews too, so sub-tables of a registered view don't false-warn.
      try {
        const createTableRegex = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(uc_\w+)"?/g;
        const createdTables = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = createTableRegex.exec(lowerQuery)) !== null) {
          createdTables.add(match[1]);
        }

        if (createdTables.size > 0) {
          const allViews = Array.from(await sql.unsafe(`SELECT table_name, view_config FROM agent_views`));
          const knownTables = new Set<string>();
          for (const view of allViews as any[]) {
            knownTables.add(view.table_name);
            const config = typeof view.view_config === "string" ? JSON.parse(view.view_config) : (view.view_config || {});
            if (Array.isArray(config.childViews)) {
              for (const child of config.childViews) {
                if (child && child.table) knownTables.add(child.table);
              }
            }
          }
          for (const t of createdTables) {
            if (!knownTables.has(t)) {
              warnings.push(
                `You created table '${t}' but it is not registered in agent_views, so it will NOT appear in the Collections UI at /collections. If the owner should be able to view or edit this data, register it now with INSERT INTO agent_views (name, table_name, description, view_config) VALUES (...). If this is an internal-only table, you can ignore this.`,
              );
            }
          }
        }
      } catch (err) {
        // agent_views may not exist until floot-agents-collections is loaded.
        console.error("agentSqlExecutor: unregistered-table validation failed", err);
      }
    }

    return {
      rows: Array.from(result as any[]),
      rowCount: (result as any).count ?? (result as any[]).length,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
