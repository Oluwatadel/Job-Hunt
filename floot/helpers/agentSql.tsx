import postgres from "postgres";

// Dedicated raw postgres pool for the agent subsystem. This is intentionally
// SEPARATE from any Kysely/ORM connection: prepare:false is load-bearing —
// it lets agentSqlExecutor run generic/multi-statement agent-authored SQL and
// avoids prepared-statement conflicts. All agent_* table access goes through this.
//
// SQL uses snake_case column names. Map to camelCase in JS yourself.
//
// prepare:false footgun: never interpolate a NESTED sql`` fragment (or an empty
// sql``) into the middle of a query. Under prepare:false it corrupts $-parameter
// binding — a mis-bound id silently matches 0 rows, and an empty fragment is a
// syntax error at "$1". For a conditional/dynamic WHERE, branch in plain JS into
// complete flat queries, each with only top-level ${value} params. (Interpolating
// a scalar value is always fine; interpolating another sql`` template is not.)
// This includes the postgres.js sql(array) values-helper — `IN ${sql(ids)}` corrupts
// $-params the same way; use `col = ANY(${ids})` (one array param) for membership.
//
// jsonb footgun: pass JSON values as `${sql.json(value)}` — NEVER
// `${JSON.stringify(value)}::jsonb`. A plain string param is sent untyped;
// postgres.js describes the statement first, sees the server infer jsonb from
// the cast, and runs the value through its jsonb serializer (JSON.stringify)
// AGAIN — so the column receives a JSON *string* ("[\"a\"]"), not the array or
// object. Nothing errors at write time unless a CHECK constraint touches it
// (jsonb_array_length → "cannot get array length of a scalar"); otherwise the
// bad row is read back as a string and breaks whatever iterates it.
export const sql = postgres(process.env.FLOOT_DATABASE_URL as string, {
  prepare: false,
  idle_timeout: 20,
  max: 3,
});
