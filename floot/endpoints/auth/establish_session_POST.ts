import { db } from "../../helpers/db";
import { schema } from "./establish_session_POST.schema";
import { setServerSession, SessionExpirationSeconds } from "../../helpers/getSetServerSession";
import { oauthBrowser as b } from "../../helpers/oauthBrowser";
import { randomBytes } from "crypto";
import superjson from "superjson";

export async function handle(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Cross-site request refused.");
    const { tempToken } = schema.parse(superjson.parse(await request.text()));
    const browser = b.cookie(request, "oauth_browser");
    if (!browser || !/^[a-f0-9]{64}$/.test(tempToken)) throw new Error("Invalid or expired sign-in.");
    const now = new Date(), id = randomBytes(32).toString("hex");
    const user = await db.transaction().execute(async tx => {
      const state = await tx.selectFrom("oauthStates").selectAll().where("state", "=", "exchange-" + b.hash(tempToken)).forUpdate().executeTakeFirst();
      if (!state || state.expiresAt <= now || !b.same(state.codeVerifier, b.hash(browser))) throw new Error("Invalid or expired sign-in.");
      const user = await tx.selectFrom("users").select(["id", "email", "displayName", "avatarUrl", "role", "disabled"]).where("id", "=", Number(state.redirectUrl)).forUpdate().executeTakeFirstOrThrow();
      if (user.disabled) throw new Error("Your account is suspended.");
      await tx.deleteFrom("oauthStates").where("id", "=", state.id).execute();
      await tx.insertInto("sessions").values({ id, userId: user.id, createdAt: now, lastAccessed: now, expiresAt: new Date(now.getTime() + SessionExpirationSeconds * 1000) }).execute();
      return { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, role: user.role };
    });
    const response = new Response(superjson.stringify({ user, success: true }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": b.cookieValue("", 0) } });
    await setServerSession(response, { id, createdAt: now.getTime(), lastAccessed: now.getTime() });
    response.headers.append("Set-Cookie", b.cookieValue("", 0));
    return response;
  } catch (e) { return new Response(superjson.stringify({ error: e instanceof Error ? e.message : "Unable to complete sign-in." }), { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
}
