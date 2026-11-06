// helpers/requireRole.tsx
//
// The server-side role gate. Call it at the TOP of every privileged endpoint:
//
//   export async function handle(request: Request) {
//     const { user } = await requireRole(request, ["admin"]);  // throws -> 403
//     ...
//   }
//
// Why this exists: a client-side route guard (an <AdminRoute> wrapper that hides
// the admin UI from non-admins) is UX only. It does NOT protect the endpoint — a
// lower-tier user with a valid session can call the API directly. The boundary
// MUST be enforced here, server-side, on every privileged endpoint. The common
// failure is open-coding `if (user.role !== "admin")` in each handler and then
// forgetting it in some of them; route all privileged endpoints through this one
// helper so the check can't be skipped.
//
// Prerequisite: your users table has a `role` column (an app schema addition —
// the seed cannot create it; see this skill's setup guidance) and your existing
// getServerUserSession selects it onto `user.role`.
import { getServerUserSession } from "./getServerUserSession";

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireRole<R extends string>(
  request: Request,
  allowedRoles: readonly R[],
): Promise<Awaited<ReturnType<typeof getServerUserSession>>> {
  // getServerUserSession already throws if the caller is not authenticated.
  const session = await getServerUserSession(request);
  const role = (session.user as { role?: string }).role;
  if (!role || !allowedRoles.includes(role as R)) {
    throw new ForbiddenError(
      `This action requires one of: ${allowedRoles.join(", ")}`,
    );
  }
  return session;
}
