// helpers/widgetSession.tsx
//
// Auth for an EXTERNAL-facing agent surface (a public chat widget). This is a
// SEPARATE auth system from getServerUserSession (your internal cookie/session
// auth) — an external end-user never gets an internal session. The widget JWT is
// short-lived (30m), purpose-tagged, and carries only a principal identity, never
// a role or any internal grant.
//
// Two principal kinds:
//   - "anonymous": key is a client-generated random token. We trust it as a
//     throwaway identity ONLY. It is a bearer secret — scope every thread/data
//     read to principal.key so one anonymous visitor cannot read another's. Never
//     expose account-lookup or any cross-user tool to an anonymous principal.
//   - "identified": key is an externalUserId the embedding site VERIFIED via HMAC
//     (see verifyWidgetIdentity) before this session was minted. Only an identified
//     principal may drive a tool that reads that user's real data — and only keyed
//     off principal.key, never off a free-text field the user typed.
import { jwtVerify, SignJWT } from "jose";

const encoder = new TextEncoder();

export type WidgetPrincipal = {
  kind: "anonymous" | "identified";
  key: string; // anonymous: the client token; identified: the verified externalUserId
  name?: string;
  email?: string;
};

export class NotAuthenticatedWidgetError extends Error {
  constructor(message?: string) {
    super(message ?? "Not authenticated as widget");
    this.name = "NotAuthenticatedWidgetError";
  }
}

// Mints a new 30-minute JWT for a widget principal whose identity is already
// established (anonymous token accepted, or identified signature verified).
export async function mintWidgetSession(
  principal: WidgetPrincipal,
): Promise<string> {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is missing.");
  }

  const token = await new SignJWT({
    kind: principal.kind,
    key: principal.key,
    name: principal.name,
    email: principal.email,
    purpose: "widget",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(encoder.encode(secret));

  return token;
}

// The gate for every public widget endpoint. Verifies the Bearer JWT and returns
// the principal. Throws NotAuthenticatedWidgetError (-> 401) otherwise. The
// purpose check stops an internal token from being replayed on the widget surface.
export async function getWidgetPrincipal(
  request: Request,
): Promise<WidgetPrincipal> {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is missing.");
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new NotAuthenticatedWidgetError(
      "Missing or invalid Authorization header",
    );
  }

  const token = authHeader.substring(7).trim();

  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret));

    if (payload.purpose !== "widget") {
      throw new NotAuthenticatedWidgetError("Invalid token purpose");
    }

    return {
      kind: payload.kind as "anonymous" | "identified",
      key: payload.key as string,
      name: payload.name as string | undefined,
      email: payload.email as string | undefined,
    };
  } catch (error) {
    throw new NotAuthenticatedWidgetError("Token verification failed");
  }
}
