import { db } from "../../helpers/db";
import { createOAuthPopupResponseHtml } from "../../helpers/oauthPopupMessage";
import { getOAuthProvider } from "../../helpers/getOAuthProvider";
import { oauthProviders, type OAuthProviderType } from "../../helpers/OAuthProvider";
import { oauthBrowser as b } from "../../helpers/oauthBrowser";
import { serverAccess as a } from "../../helpers/serverAccess";
import { schema } from "./oauth_callback_GET.schema";
import { randomBytes } from "crypto";
import { sql } from "kysely";

export async function handle(request: Request) {
  let provider: OAuthProviderType = "floot";
  try {
    const input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const browser = b.cookie(request, "oauth_browser");
    if (!browser || !/^[a-f0-9]{64}$/.test(input.state)) throw new Error("Sign-in expired. Please start again from the app.");
    // Lock, validate the browser binding, and consume the state exactly once.
    const state = await db.transaction().execute(async tx => {
      const row = await tx.selectFrom("oauthStates").selectAll().where("state", "=", input.state).forUpdate().executeTakeFirst();
      if (!row || row.expiresAt <= new Date()) throw new Error("Sign-in expired. Please start again.");
      const data = JSON.parse(row.codeVerifier) as { pkce: string; linkUserId: number | null; browserHash: string };
      if (!b.same(data.browserHash, b.hash(browser))) throw new Error("Sign-in browser did not match. Start again from the app.");
      await tx.deleteFrom("oauthStates").where("id", "=", row.id).execute();
      return { ...row, data };
    });
    if (!oauthProviders.includes(state.provider as OAuthProviderType)) throw new Error("Unsupported sign-in provider.");
    provider = state.provider as OAuthProviderType;
    if (input.error || !input.code) throw new Error("Sign-in was cancelled or declined.");
    if (state.data.linkUserId !== null && (await a.current(request)).id !== state.data.linkUserId) throw new Error("Sign in to your existing account before linking this provider.");
    const p = getOAuthProvider(provider, state.redirectUrl);
    const tokens = await p.exchangeCodeForTokens(input.code, state.redirectUrl, state.data.pkce);
    const identity = p.mapUserData(await p.fetchUserInfo(tokens));
    identity.email = identity.email.trim().toLowerCase();
    if (!identity.providerUserId || !identity.email) throw new Error("A provider identity and email are required.");
    // Use immutable provider subject, never an email alone, to resolve an existing identity.
    const user = await db.transaction().execute(async tx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${provider + ":" + identity.providerUserId}))`.execute(tx);
      const linked = await tx.selectFrom("oauthAccounts").selectAll().where("provider", "=", provider).where("providerUserId", "=", identity.providerUserId).executeTakeFirst();
      let id: number;
      if (linked) {
        if (state.data.linkUserId !== null && linked.userId !== state.data.linkUserId) throw new Error("This provider is already linked to another account.");
        id = linked.userId;
      } else {
        if (state.data.linkUserId !== null) {
          id = state.data.linkUserId;
        } else {
          await sql`SELECT pg_advisory_xact_lock(hashtext(${identity.email}))`.execute(tx);
          const existing = await tx.selectFrom("users").select("id").where(sql<boolean>`lower(email) = ${identity.email}`).executeTakeFirst();
          if (existing) throw new Error("An account with this email already exists. Sign in with your current method, then link this provider from Profile.");
          const created = await tx.insertInto("users").values({ email: identity.email, displayName: identity.displayName, avatarUrl: identity.avatarUrl || null, role: "user", accessUntil: null, disabled: false }).returning("id").executeTakeFirstOrThrow();
          id = created.id;
        }
        await tx.insertInto("oauthAccounts").values({ userId: id, provider, providerUserId: identity.providerUserId, providerEmail: identity.email }).execute();
      }
      const u = await tx.selectFrom("users").selectAll().where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
      if (u.disabled) throw new Error("Your account is suspended. Contact support.");
      return u;
    });
    const token = randomBytes(32).toString("hex");
    await db.insertInto("oauthStates").values({ state: "exchange-" + b.hash(token), provider, redirectUrl: String(user.id), codeVerifier: b.hash(browser), expiresAt: new Date(Date.now() + 60000) }).execute();
    return new Response(createOAuthPopupResponseHtml({ type: "OAUTH_TOKEN_SUCCESS", provider, token }), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    return new Response(createOAuthPopupResponseHtml({ type: "OAUTH_ERROR", provider, error: { message: e instanceof Error ? e.message : "Unable to complete sign-in." } }), { status: 400, headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  }
}
